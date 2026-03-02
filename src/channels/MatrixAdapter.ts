/**
 * AstraOS — MatrixAdapter.ts
 * Matrix protocol adapter for decentralized messaging
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class MatrixAdapter implements ChannelAdapter {
  name = "matrix";
  private homeserverUrl: string;
  private accessToken: string;
  private userId: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private pollInterval?: NodeJS.Timeout;
  private syncToken?: string;

  constructor() {
    this.homeserverUrl = process.env.MATRIX_HOMESERVER_URL || "https://matrix.org";
    this.accessToken = process.env.MATRIX_ACCESS_TOKEN || "";
    this.userId = process.env.MATRIX_USER_ID || "";
  }

  async initialize(): Promise<void> {
    if (!this.accessToken) throw new Error("MATRIX_ACCESS_TOKEN not configured");
    this.pollInterval = setInterval(() => this.sync(), 3000);
    console.log("[AstraOS] Matrix adapter initialized");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  private async sync(): Promise<void> {
    try {
      let url = `${this.homeserverUrl}/_matrix/client/r0/sync?timeout=3000`;
      if (this.syncToken) url += `&since=${this.syncToken}`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      const data = (await resp.json()) as {
        next_batch: string;
        rooms?: {
          join?: Record<string, {
            timeline: { events: Array<{ type: string; sender: string; content: { body?: string; msgtype?: string }; event_id: string }> };
          }>;
        };
      };

      this.syncToken = data.next_batch;

      const joinedRooms = data.rooms?.join || {};
      for (const [roomId, room] of Object.entries(joinedRooms)) {
        for (const event of room.timeline.events) {
          if (event.type !== "m.room.message" || event.sender === this.userId) continue;
          if (event.content.msgtype !== "m.text" || !event.content.body) continue;

          const msg: IncomingMessage = {
            channelType: "matrix",
            channelId: roomId,
            userId: event.sender,
            text: event.content.body,
            metadata: { eventId: event.event_id },
          };

          if (this.messageHandler) {
            const response = await this.messageHandler(msg);
            await this.sendMessage({ channelId: roomId, text: response });
          }
        }
      }
    } catch { /* sync failure is non-fatal */ }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const txnId = `astra_${Date.now()}`;
    await fetch(
      `${this.homeserverUrl}/_matrix/client/r0/rooms/${encodeURIComponent(msg.channelId)}/send/m.room.message/${txnId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          msgtype: msg.format === "html" ? "m.text" : "m.text",
          body: msg.text,
          ...(msg.format === "html" ? { format: "org.matrix.custom.html", formatted_body: msg.text } : {}),
        }),
      }
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.homeserverUrl}/_matrix/client/r0/account/whoami`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
