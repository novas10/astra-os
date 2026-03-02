/**
 * AstraOS — SignalAdapter.ts
 * Signal messenger adapter via signal-cli REST API
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class SignalAdapter implements ChannelAdapter {
  name = "signal";
  private apiUrl: string;
  private phoneNumber: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private pollInterval?: NodeJS.Timeout;

  constructor() {
    this.apiUrl = process.env.SIGNAL_CLI_REST_URL || "http://localhost:8080";
    this.phoneNumber = process.env.SIGNAL_PHONE_NUMBER || "";
  }

  async initialize(): Promise<void> {
    if (!this.phoneNumber) throw new Error("SIGNAL_PHONE_NUMBER not configured");
    // Start polling for messages
    this.pollInterval = setInterval(() => this.pollMessages(), 2000);
    console.log("[AstraOS] Signal adapter initialized (polling mode)");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  private async pollMessages(): Promise<void> {
    try {
      const resp = await fetch(`${this.apiUrl}/v1/receive/${this.phoneNumber}`);
      const messages = (await resp.json()) as Array<{
        envelope: {
          source: string;
          sourceName?: string;
          dataMessage?: { message: string; timestamp: number; groupInfo?: { groupId: string } };
        };
      }>;

      for (const msg of messages) {
        const data = msg.envelope.dataMessage;
        if (!data?.message || !this.messageHandler) continue;

        const incoming: IncomingMessage = {
          channelType: "signal",
          channelId: data.groupInfo?.groupId || msg.envelope.source,
          userId: msg.envelope.source,
          username: msg.envelope.sourceName,
          text: data.message,
          metadata: { timestamp: data.timestamp, isGroup: !!data.groupInfo },
        };

        const response = await this.messageHandler(incoming);
        await this.sendMessage({ channelId: incoming.channelId, text: response });
      }
    } catch { /* polling failure is non-fatal */ }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const isGroup = msg.channelId.length > 20; // Group IDs are longer

    const body: Record<string, unknown> = {
      message: msg.text,
      number: this.phoneNumber,
    };

    if (isGroup) {
      body.recipients = []; // Group message
      (body as Record<string, unknown>).group_id = msg.channelId;
    } else {
      body.recipients = [msg.channelId];
    }

    await fetch(`${this.apiUrl}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.apiUrl}/v1/about`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
