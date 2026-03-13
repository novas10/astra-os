/**
 * AstraOS — NextcloudAdapter.ts
 * Nextcloud Talk adapter using long-polling for messages and OCS REST API for replies.
 * API: https://{server}/ocs/v2.php/apps/spreed/api/v1
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

interface NextcloudMessage {
  id: number;
  token: string;
  actorType: string;
  actorId: string;
  actorDisplayName: string;
  message: string;
  messageType: string;
  timestamp: number;
  systemMessage: string;
  referenceId?: string;
}

interface NextcloudOCSResponse {
  ocs: {
    meta: { status: string; statuscode: number; message: string };
    data: NextcloudMessage[];
  };
}

export class NextcloudAdapter implements ChannelAdapter {
  name = "nextcloud";
  private serverUrl: string;
  private username: string;
  private token: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private lastKnownMessageId: Map<string, number> = new Map();
  private monitoredRooms: string[] = [];
  private running = false;

  constructor() {
    this.serverUrl = (process.env.NEXTCLOUD_URL || "").replace(/\/+$/, "");
    this.username = process.env.NEXTCLOUD_USER || "";
    this.token = process.env.NEXTCLOUD_TOKEN || "";
    // Rooms to monitor, comma-separated conversation tokens
    this.monitoredRooms = (process.env.NEXTCLOUD_ROOMS || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  }

  async initialize(): Promise<void> {
    if (!this.serverUrl) throw new Error("NEXTCLOUD_URL not configured");
    if (!this.username) throw new Error("NEXTCLOUD_USER not configured");
    if (!this.token) throw new Error("NEXTCLOUD_TOKEN not configured");

    this.running = true;

    // If no rooms specified, fetch joined conversations
    if (this.monitoredRooms.length === 0) {
      await this.fetchJoinedRooms();
    }

    // Start polling each room
    for (const room of this.monitoredRooms) {
      this.startPolling(room);
    }

    console.log(
      `[AstraOS] Nextcloud Talk adapter initialized — ${this.serverUrl} (${this.monitoredRooms.length} rooms)`,
    );
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const body: Record<string, unknown> = {
      message: msg.text,
      actorDisplayName: this.username,
    };

    if (msg.replyToId) {
      body.replyTo = parseInt(msg.replyToId, 10);
    }

    const resp = await fetch(
      `${this.serverUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${msg.channelId}`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
          "OCS-APIRequest": "true",
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] Nextcloud send failed:", resp.status, errBody);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(
        `${this.serverUrl}/ocs/v2.php/apps/spreed/api/v4/room`,
        {
          headers: {
            ...this.authHeaders(),
            "OCS-APIRequest": "true",
            Accept: "application/json",
          },
        },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.running = false;
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();
  }

  private async fetchJoinedRooms(): Promise<void> {
    try {
      const resp = await fetch(
        `${this.serverUrl}/ocs/v2.php/apps/spreed/api/v4/room`,
        {
          headers: {
            ...this.authHeaders(),
            "OCS-APIRequest": "true",
            Accept: "application/json",
          },
        },
      );

      if (resp.ok) {
        const data = (await resp.json()) as {
          ocs: { data: Array<{ token: string; type: number }> };
        };
        this.monitoredRooms = data.ocs.data.map((r) => r.token);
      }
    } catch (err) {
      console.error("[AstraOS] Nextcloud room fetch failed:", err);
    }
  }

  private startPolling(roomToken: string): void {
    const poll = async () => {
      if (!this.running) return;

      try {
        await this.pollRoom(roomToken);
      } catch {
        // Polling failure is non-fatal
      }

      if (this.running) {
        const timer = setTimeout(poll, 3000);
        this.pollTimers.set(roomToken, timer);
      }
    };

    // Initial poll after short delay
    const timer = setTimeout(poll, 1000);
    this.pollTimers.set(roomToken, timer);
  }

  private async pollRoom(roomToken: string): Promise<void> {
    const lastId = this.lastKnownMessageId.get(roomToken) || 0;
    const params = new URLSearchParams({
      lookIntoFuture: "1",
      limit: "50",
      timeout: "10",
      setReadMarker: "0",
      includeLastKnown: "0",
    });

    if (lastId > 0) {
      params.set("lastKnownMessageId", lastId.toString());
    }

    const resp = await fetch(
      `${this.serverUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${roomToken}?${params}`,
      {
        headers: {
          ...this.authHeaders(),
          "OCS-APIRequest": "true",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
      },
    );

    // 304 = no new messages (long-poll timeout)
    if (resp.status === 304) return;
    if (!resp.ok) return;

    const data = (await resp.json()) as NextcloudOCSResponse;
    const messages = data.ocs?.data || [];

    for (const message of messages) {
      // Track latest message ID
      if (message.id > (this.lastKnownMessageId.get(roomToken) || 0)) {
        this.lastKnownMessageId.set(roomToken, message.id);
      }

      // Skip system messages, deleted messages, and own messages
      if (message.systemMessage) continue;
      if (message.messageType === "system" || message.messageType === "command") continue;
      if (message.actorId === this.username && message.actorType === "users") continue;
      if (!message.message.trim()) continue;

      const incoming: IncomingMessage = {
        channelType: "nextcloud",
        channelId: roomToken,
        userId: message.actorId,
        username: message.actorDisplayName,
        text: message.message,
        metadata: {
          messageId: message.id,
          actorType: message.actorType,
          timestamp: message.timestamp,
        },
      };

      if (this.messageHandler) {
        try {
          const response = await this.messageHandler(incoming);
          await this.sendMessage({
            channelId: roomToken,
            text: response,
            replyToId: message.id.toString(),
          });
        } catch (err) {
          console.error("[AstraOS] Nextcloud message handler error:", err);
        }
      }
    }
  }

  private authHeaders(): Record<string, string> {
    const encoded = Buffer.from(`${this.username}:${this.token}`).toString("base64");
    return {
      Authorization: `Basic ${encoded}`,
    };
  }
}
