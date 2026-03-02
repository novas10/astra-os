/**
 * AstraOS — SlackAdapter.ts
 * Slack channel adapter using Bolt SDK patterns
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class SlackAdapter implements ChannelAdapter {
  name = "slack";
  private botToken: string;
  private signingSecret: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN || "";
    this.signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  }

  async initialize(): Promise<void> {
    if (!this.botToken) throw new Error("SLACK_BOT_TOKEN not configured");
    console.log("[AstraOS] Slack adapter initialized");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async handleWebhook(body: Record<string, unknown>): Promise<unknown> {
    // URL verification challenge
    if (body.type === "url_verification") {
      return { challenge: body.challenge };
    }

    if (body.type === "event_callback") {
      const event = body.event as Record<string, unknown>;
      if (event.type === "message" && !event.bot_id && event.text) {
        const msg: IncomingMessage = {
          channelType: "slack",
          channelId: event.channel as string,
          userId: event.user as string,
          text: event.text as string,
          threadId: (event.thread_ts as string) || (event.ts as string),
          metadata: { team: body.team_id, eventTs: event.ts },
        };

        if (this.messageHandler) {
          const response = await this.messageHandler(msg);
          await this.sendMessage({ channelId: msg.channelId, text: response, replyToId: msg.threadId });
        }
      }
    }

    return { ok: true };
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const body: Record<string, unknown> = {
      channel: msg.channelId,
      text: msg.text,
    };

    if (msg.replyToId) {
      body.thread_ts = msg.replyToId;
    }

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${this.botToken}` },
      });
      const data = (await resp.json()) as { ok: boolean };
      return data.ok;
    } catch {
      return false;
    }
  }
}
