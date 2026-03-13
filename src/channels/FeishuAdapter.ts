/**
 * AstraOS — FeishuAdapter.ts
 * Feishu/Lark (ByteDance) adapter via Event Subscription and Bot API.
 * Uses https://open.feishu.cn/open-apis for messaging.
 */

import * as crypto from "crypto";
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

interface FeishuEventBody {
  // Webhook verification
  challenge?: string;
  type?: string;
  token?: string;
  // Event callback v2
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
  };
  event?: {
    sender?: { sender_id?: { open_id?: string; user_id?: string }; sender_type?: string };
    message?: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      content: string;
      message_type: string;
    };
  };
}

export class FeishuAdapter implements ChannelAdapter {
  name = "feishu";
  private appId: string;
  private appSecret: string;
  private verificationToken: string;
  private encryptKey: string;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private readonly API_BASE = "https://open.feishu.cn/open-apis";
  private processedEvents = new Set<string>();

  constructor() {
    this.appId = process.env.FEISHU_APP_ID || "";
    this.appSecret = process.env.FEISHU_APP_SECRET || "";
    this.verificationToken = process.env.FEISHU_VERIFICATION_TOKEN || "";
    this.encryptKey = process.env.FEISHU_ENCRYPT_KEY || "";
  }

  async initialize(): Promise<void> {
    if (!this.appId) throw new Error("FEISHU_APP_ID not configured");
    if (!this.appSecret) throw new Error("FEISHU_APP_SECRET not configured");
    await this.refreshToken();
    console.log("[AstraOS] Feishu/Lark adapter initialized (webhook mode)");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async handleWebhook(body: Record<string, unknown>): Promise<unknown> {
    const payload = body as unknown as FeishuEventBody;

    // URL verification challenge
    if (payload.type === "url_verification" && payload.challenge) {
      return { challenge: payload.challenge };
    }

    // Event callback v2
    if (payload.schema === "2.0" && payload.header && payload.event) {
      // Verify token
      if (this.verificationToken && payload.header.token !== this.verificationToken) {
        return { error: "Invalid verification token", status: 403 };
      }

      // Deduplicate events
      const eventId = payload.header.event_id;
      if (this.processedEvents.has(eventId)) {
        return { ok: true };
      }
      this.processedEvents.add(eventId);
      // Prevent memory leak: cap set size
      if (this.processedEvents.size > 10000) {
        const entries = Array.from(this.processedEvents);
        for (let i = 0; i < 5000; i++) {
          this.processedEvents.delete(entries[i]);
        }
      }

      if (payload.header.event_type === "im.message.receive_v1") {
        await this.handleMessage(payload);
      }
    }

    return { ok: true };
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    await this.ensureToken();

    const body = {
      receive_id: msg.channelId,
      msg_type: "text",
      content: JSON.stringify({ text: msg.text }),
    };

    const resp = await fetch(
      `${this.API_BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.tenantAccessToken}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] Feishu send message failed:", resp.status, errBody);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureToken();
      return this.tenantAccessToken !== null;
    } catch {
      return false;
    }
  }

  private async handleMessage(payload: FeishuEventBody): Promise<void> {
    const event = payload.event!;
    const message = event.message;
    const sender = event.sender;

    if (!message || !sender) return;

    // Ignore bot's own messages
    if (sender.sender_type === "bot") return;

    // Parse message content (JSON string)
    let text = "";
    try {
      if (message.message_type === "text") {
        const content = JSON.parse(message.content);
        text = content.text || "";
      } else {
        // Skip non-text messages
        return;
      }
    } catch {
      text = message.content;
    }

    if (!text.trim()) return;

    const incoming: IncomingMessage = {
      channelType: "feishu",
      channelId: message.chat_id,
      userId: sender.sender_id?.open_id || sender.sender_id?.user_id || "unknown",
      text,
      metadata: {
        messageId: message.message_id,
        chatType: message.chat_type,
        eventId: payload.header?.event_id,
      },
    };

    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(incoming);
        // Reply in the same chat
        await this.replyToMessage(message.message_id, response);
      } catch (err) {
        console.error("[AstraOS] Feishu message handler error:", err);
      }
    }
  }

  private async replyToMessage(messageId: string, text: string): Promise<void> {
    await this.ensureToken();

    const body = {
      msg_type: "text",
      content: JSON.stringify({ text }),
    };

    const resp = await fetch(
      `${this.API_BASE}/im/v1/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.tenantAccessToken}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] Feishu reply failed:", resp.status, errBody);
    }
  }

  private async refreshToken(): Promise<void> {
    const resp = await fetch(
      `${this.API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      },
    );

    if (!resp.ok) {
      throw new Error(`Feishu token refresh failed: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      code: number;
      tenant_access_token: string;
      expire: number;
    };

    if (data.code !== 0) {
      throw new Error(`Feishu token error: code=${data.code}`);
    }

    this.tenantAccessToken = data.tenant_access_token;
    // Refresh 5 minutes before expiry
    this.tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.tenantAccessToken || Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
  }
}
