/**
 * AstraOS — BedrockProvider.ts
 * AWS Bedrock LLM provider (Claude, Titan, Llama models via Bedrock Converse API)
 * Uses SigV4 signing with Node.js crypto — no external AWS SDK dependency.
 */

import * as crypto from "crypto";
import type { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "../LLMProvider";

export class BedrockProvider implements LLMProvider {
  name = "bedrock";
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;
  private sessionToken: string;

  constructor(opts?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    sessionToken?: string;
  }) {
    this.accessKeyId = opts?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || "";
    this.secretAccessKey = opts?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "";
    this.region = opts?.region || process.env.AWS_REGION || "us-east-1";
    this.sessionToken = opts?.sessionToken || process.env.AWS_SESSION_TOKEN || "";
  }

  async chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
    toolResults?: Array<{ tool_use_id: string; content: string }>;
  }): Promise<LLMResponse> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error("BedrockProvider: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
    }

    // Build Converse API request body
    const converseMessages: Array<{
      role: string;
      content: Array<{ text?: string; toolUse?: unknown; toolResult?: unknown }>;
    }> = [];

    for (const m of params.messages) {
      if (m.role === "system") continue; // system handled separately
      converseMessages.push({
        role: m.role,
        content: [{ text: m.content }],
      });
    }

    // Append tool results if present
    if (params.toolResults && params.toolResults.length > 0) {
      converseMessages.push({
        role: "user",
        content: params.toolResults.map((tr) => ({
          toolResult: {
            toolUseId: tr.tool_use_id,
            content: [{ text: tr.content }],
          },
        })),
      });
    }

    const body: Record<string, unknown> = {
      messages: converseMessages,
      inferenceConfig: {
        maxTokens: params.maxTokens ?? 4096,
      },
    };

    if (params.system) {
      body.system = [{ text: params.system }];
    }

    if (params.tools && params.tools.length > 0) {
      body.toolConfig = {
        tools: params.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: {
              json: t.input_schema,
            },
          },
        })),
      };
    }

    const modelId = params.model;
    const host = `bedrock-runtime.${this.region}.amazonaws.com`;
    const path = `/model/${encodeURIComponent(modelId)}/converse`;
    const url = `https://${host}${path}`;
    const payload = JSON.stringify(body);

    const headers = this.signRequest("POST", host, path, payload, "bedrock");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BedrockProvider API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      output?: {
        message?: {
          role: string;
          content: Array<{
            text?: string;
            toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> };
          }>;
        };
      };
      stopReason?: string;
      usage?: { inputTokens: number; outputTokens: number };
    };

    // Parse text content
    let text = "";
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    if (data.output?.message?.content) {
      for (const block of data.output.message.content) {
        if (block.text) {
          text += block.text;
        }
        if (block.toolUse) {
          toolCalls.push({
            id: block.toolUse.toolUseId,
            name: block.toolUse.name,
            input: block.toolUse.input,
          });
        }
      }
    }

    let stopReason: LLMResponse["stopReason"] = "end_turn";
    if (data.stopReason === "tool_use") stopReason = "tool_use";
    else if (data.stopReason === "max_tokens") stopReason = "max_tokens";
    else if (data.stopReason === "end_turn") stopReason = "end_turn";
    else if (data.stopReason === "stop") stopReason = "stop";

    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        input: data.usage?.inputTokens ?? 0,
        output: data.usage?.outputTokens ?? 0,
      },
    };
  }

  /**
   * AWS SigV4 request signing using Node.js crypto.
   */
  private signRequest(
    method: string,
    host: string,
    path: string,
    payload: string,
    service: string,
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").substring(0, 15) + "Z";
    // amzDate format: YYYYMMDDTHHMMSSZ — rebuild to ensure correct format
    const dateStamp = amzDate.substring(0, 8);

    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;

    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

    // Canonical headers — must include host and x-amz-date, sorted
    const headersToSign: Record<string, string> = {
      host,
      "x-amz-date": amzDate,
    };

    if (this.sessionToken) {
      headersToSign["x-amz-security-token"] = this.sessionToken;
    }

    headersToSign["x-amz-content-sha256"] = payloadHash;

    const sortedHeaderKeys = Object.keys(headersToSign).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      path,
      "", // query string (empty)
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const canonicalRequestHash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");

    // Derive signing key
    const kDate = this.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, service);
    const kSigning = this.hmac(kService, "aws4_request");

    const signature = crypto
      .createHmac("sha256", kSigning)
      .update(stringToSign)
      .digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const result: Record<string, string> = {
      Authorization: authorization,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
    };

    if (this.sessionToken) {
      result["X-Amz-Security-Token"] = this.sessionToken;
    }

    return result;
  }

  private hmac(key: string | Buffer, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest();
  }
}
