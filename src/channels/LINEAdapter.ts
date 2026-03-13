/**
 * AstraOS — LINEAdapter.ts
 * LINE Messaging API adapter. Webhook-based with signature verification.
 * Uses https://api.line.me/v2/bot for messaging.
 */

import * as crypto from "crypto";
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

interface LINEWebhookEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId: string; groupId?: string; roomId?: string };
  message?: { type: string; id: string; text?: string };
  timestamp: number;
}

interface LINEWebhookBody {
  destination: string;
  events: LINEWebhookEvent[];
}

export class LINEAdapter implements ChannelAdapter {
  name = "line";
  private channelAccessToken: string;
  private channelSecret: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private readonly API_BASE = "https://api.line.me/v2/bot";

  constructor() {
    this.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
    this.channelSecret = process.env.LINE_CHANNEL_SECRET || "";
  }

  async initialize(): Promise<void> {
    if (!this.channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured");
    if (!this.channelSecret) throw new Error("LINE_CHANNEL_SECRET not configured");
    console.log("[AstraOS] LINE adapter initialized (webhook mode)");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  /**
   * Handles incoming LINE webhook requests.
   * Expects the raw body (Buffer) and x-line-signature header for verification.
   */
  async handleWebhook(body: Record<string, unknown>, headers?: Record<string, string>): Promise<unknown> {
    // Verify signature if headers are provided
    if (headers) {
      const signature = headers["x-line-signature"];
      const bodyStr = JSON.stringify(body);
      if (signature && !this.verifySignature(bodyStr, signature)) {
        return { error: "Invalid signature", status: 403 };
      }
    }

    const payload = body as unknown as LINEWebhookBody;
    const events = payload.events || [];

    for (const event of events) {
      if (event.type === "message" && event.message?.type === "text" && event.message.text) {
        const channelId = event.source.groupId || event.source.roomId || event.source.userId;

        const incoming: IncomingMessage = {
          channelType: "line",
          channelId,
          userId: event.source.userId,
          text: event.message.text,
          metadata: {
            replyToken: event.replyToken,
            messageId: event.message.id,
            sourceType: event.source.type,
            timestamp: event.timestamp,
          },
        };

        if (this.messageHandler && event.replyToken) {
          try {
            const response = await this.messageHandler(incoming);
            await this.replyMessage(event.replyToken, response);
          } catch (err) {
            console.error("[AstraOS] LINE message handler error:", err);
          }
        }
      }
    }

    return { ok: true };
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    // Push message (for sending outside of webhook reply window)
    const body = {
      to: msg.channelId,
      messages: [{ type: "text", text: msg.text }],
    };

    const resp = await fetch(`${this.API_BASE}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] LINE push message failed:", resp.status, errBody);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.API_BASE}/info`, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async replyMessage(replyToken: string, text: string): Promise<void> {
    const body = {
      replyToken,
      messages: [{ type: "text", text }],
    };

    const resp = await fetch(`${this.API_BASE}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] LINE reply failed:", resp.status, errBody);
    }
  }

  private verifySignature(body: string, signature: string): boolean {
    const hash = crypto
      .createHmac("SHA256", this.channelSecret)
      .update(body)
      .digest("base64");
    const hashBuf = Buffer.from(hash);
    const sigBuf = Buffer.from(signature);
    if (hashBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, sigBuf);
  }
}
