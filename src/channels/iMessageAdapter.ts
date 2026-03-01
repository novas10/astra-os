/**
 * AstraOS — iMessageAdapter.ts
 * iMessage adapter via BlueBubbles server API
 */

import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class iMessageAdapter implements ChannelAdapter {
  name = "imessage";
  private serverUrl: string;
  private password: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private pollInterval?: NodeJS.Timeout;
  private lastTimestamp = Date.now();

  constructor() {
    this.serverUrl = process.env.BLUEBUBBLES_SERVER_URL || "http://localhost:1234";
    this.password = process.env.BLUEBUBBLES_PASSWORD || "";
  }

  async initialize(): Promise<void> {
    if (!this.password) throw new Error("BLUEBUBBLES_PASSWORD not configured");
    this.pollInterval = setInterval(() => this.pollMessages(), 3000);
    console.log("[AstraOS] iMessage (BlueBubbles) adapter initialized");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  private async pollMessages(): Promise<void> {
    try {
      const resp = await fetch(`${this.serverUrl}/api/v1/message?password=${this.password}&after=${this.lastTimestamp}&limit=50&sort=asc`);
      const data = (await resp.json()) as {
        data: Array<{
          guid: string;
          text: string;
          isFromMe: boolean;
          handle?: { address: string; firstName?: string; lastName?: string };
          chats?: Array<{ guid: string; chatIdentifier: string }>;
          dateCreated: number;
        }>;
      };

      for (const msg of data.data) {
        if (msg.isFromMe || !msg.text) continue;

        this.lastTimestamp = Math.max(this.lastTimestamp, msg.dateCreated + 1);

        const incoming: IncomingMessage = {
          channelType: "imessage",
          channelId: msg.chats?.[0]?.guid || msg.handle?.address || "",
          userId: msg.handle?.address || "",
          username: [msg.handle?.firstName, msg.handle?.lastName].filter(Boolean).join(" ") || undefined,
          text: msg.text,
          metadata: { messageGuid: msg.guid, chatIdentifier: msg.chats?.[0]?.chatIdentifier },
        };

        if (this.messageHandler) {
          const response = await this.messageHandler(incoming);
          await this.sendMessage({ channelId: incoming.userId, text: response });
        }
      }
    } catch {}
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    await fetch(`${this.serverUrl}/api/v1/message/text?password=${this.password}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatGuid: `iMessage;-;${msg.channelId}`,
        message: msg.text,
        method: "private-api",
      }),
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.serverUrl}/api/v1/server/info?password=${this.password}`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
