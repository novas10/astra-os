/**
 * AstraOS — PhoneAdapter.ts
 * Phone call channel adapter — real phone conversations with AI agents.
 * Uses Telnyx Programmable Voice API for inbound/outbound calls.
 */

import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";
import { logger } from "../utils/logger";

interface CallSession {
  callControlId: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  startedAt: number;
  state: "ringing" | "active" | "ended";
}

export class PhoneAdapter implements ChannelAdapter {
  name = "phone";
  private apiKey: string;
  private connectionId: string;
  private phoneNumber: string;
  private baseUrl = "https://api.telnyx.com/v2";
  private calls: Map<string, CallSession> = new Map();
  private handler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.apiKey = process.env.TELNYX_API_KEY || "";
    this.connectionId = process.env.TELNYX_CONNECTION_ID || "";
    this.phoneNumber = process.env.TELNYX_PHONE_NUMBER || "";
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      logger.warn("[PhoneAdapter] TELNYX_API_KEY not set — adapter disabled");
      return;
    }
    logger.info(`[PhoneAdapter] Phone adapter ready — ${this.phoneNumber || "no number configured"}`);
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    // For phone, "sending" means speaking via TTS during an active call
    const call = this.calls.get(msg.channelId);
    if (!call || call.state !== "active") return;

    await this.telnyxRequest(`/calls/${call.callControlId}/actions/speak`, {
      payload: msg.text,
      voice: "female",
      language: "en-US",
    });
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.handler = handler;
  }

  // Handle Telnyx webhooks for call events
  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    const data = body.data as Record<string, unknown>;
    const eventType = (data?.event_type as string) || "";
    const payload = data?.payload as Record<string, unknown>;

    if (!payload) return;

    switch (eventType) {
      case "call.initiated": {
        const callControlId = payload.call_control_id as string;
        const session: CallSession = {
          callControlId,
          from: payload.from as string,
          to: payload.to as string,
          direction: (payload.direction as "inbound" | "outbound") || "inbound",
          startedAt: Date.now(),
          state: "ringing",
        };
        this.calls.set(callControlId, session);

        // Auto-answer inbound calls
        if (session.direction === "inbound") {
          await this.telnyxRequest(`/calls/${callControlId}/actions/answer`, {});
        }
        break;
      }

      case "call.answered": {
        const ccId = payload.call_control_id as string;
        const call = this.calls.get(ccId);
        if (call) {
          call.state = "active";
          // Greet and start listening
          await this.telnyxRequest(`/calls/${ccId}/actions/speak`, {
            payload: "Hello! I'm Astra, your AI assistant. How can I help you today?",
            voice: "female",
            language: "en-US",
          });
        }
        break;
      }

      case "call.speak.ended": {
        const ccId = payload.call_control_id as string;
        // After speaking, start gathering speech input
        await this.telnyxRequest(`/calls/${ccId}/actions/gather_using_speak`, {
          payload: "",
          voice: "female",
          language: "en-US",
          minimum_digits: 1,
          maximum_digits: 128,
          timeout_millis: 10000,
        });
        break;
      }

      case "call.gather.ended": {
        const ccId = payload.call_control_id as string;
        const speech = (payload.speech as Record<string, string>)?.result || "";
        const digits = payload.digits as string || "";
        const userInput = speech || digits;

        if (userInput && this.handler) {
          const call = this.calls.get(ccId);
          const incoming: IncomingMessage = {
            channelType: "phone",
            channelId: ccId,
            userId: call?.from || "unknown",
            text: userInput,
            metadata: { direction: call?.direction, phoneNumber: call?.from },
          };

          const response = await this.handler(incoming);
          await this.telnyxRequest(`/calls/${ccId}/actions/speak`, {
            payload: response,
            voice: "female",
            language: "en-US",
          });
        }
        break;
      }

      case "call.hangup": {
        const ccId = payload.call_control_id as string;
        this.calls.delete(ccId);
        logger.info(`[PhoneAdapter] Call ended: ${ccId}`);
        break;
      }
    }
  }

  // Make an outbound call
  async makeCall(toNumber: string): Promise<string> {
    const resp = await this.telnyxRequest("/calls", {
      connection_id: this.connectionId,
      to: toNumber,
      from: this.phoneNumber,
    });

    const data = resp.data as Record<string, unknown>;
    const callControlId = data.call_control_id as string;

    this.calls.set(callControlId, {
      callControlId,
      from: this.phoneNumber,
      to: toNumber,
      direction: "outbound",
      startedAt: Date.now(),
      state: "ringing",
    });

    return callControlId;
  }

  // Transfer call
  async transferCall(callControlId: string, toNumber: string): Promise<void> {
    await this.telnyxRequest(`/calls/${callControlId}/actions/transfer`, {
      to: toNumber,
    });
  }

  // Hang up
  async hangUp(callControlId: string): Promise<void> {
    await this.telnyxRequest(`/calls/${callControlId}/actions/hangup`, {});
    this.calls.delete(callControlId);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/phone_numbers`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  getActiveCalls(): number {
    return this.calls.size;
  }

  private async telnyxRequest(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Telnyx API error: ${resp.status} ${await resp.text()}`);
    }

    return (await resp.json()) as Record<string, unknown>;
  }
}
