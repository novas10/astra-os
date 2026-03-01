/**
 * AstraOS — ZaloAdapter.ts
 * Zalo messaging channel adapter (popular in Vietnam — 75M+ users).
 * Uses Zalo Official Account API (OA API v3).
 */

import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";
import { logger } from "../utils/logger";

export class ZaloAdapter implements ChannelAdapter {
  name = "zalo";
  private appId: string;
  private appSecret: string;
  private accessToken: string;
  private handler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.appId = process.env.ZALO_APP_ID || "";
    this.appSecret = process.env.ZALO_APP_SECRET || "";
    this.accessToken = process.env.ZALO_OA_ACCESS_TOKEN || "";
  }

  async initialize(): Promise<void> {
    if (!this.accessToken) {
      logger.warn("[ZaloAdapter] ZALO_OA_ACCESS_TOKEN not set — adapter disabled");
      return;
    }
    logger.info("[ZaloAdapter] Zalo OA adapter initialized");
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const payload = {
      recipient: { user_id: msg.channelId },
      message: { text: msg.text },
    };

    const resp = await fetch("https://openapi.zalo.me/v3.0/oa/message/cs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: this.accessToken,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      throw new Error(`Zalo send failed: ${resp.status} ${await resp.text()}`);
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.handler = handler;
  }

  async handleWebhook(body: Record<string, unknown>): Promise<string | null> {
    if (!this.handler) return null;

    const event = body as {
      event_name: string;
      sender: { id: string };
      message: { text: string; msg_id: string };
      timestamp: string;
    };

    if (event.event_name !== "user_send_text") return null;

    const incoming: IncomingMessage = {
      channelType: "zalo",
      channelId: event.sender.id,
      userId: event.sender.id,
      text: event.message.text,
      metadata: { msgId: event.message.msg_id, timestamp: event.timestamp },
    };

    return this.handler(incoming);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.accessToken) return false;
    try {
      const resp = await fetch("https://openapi.zalo.me/v3.0/oa/getoa", {
        headers: { access_token: this.accessToken },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
