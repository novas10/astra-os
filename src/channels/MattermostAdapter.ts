/**
 * AstraOS — MattermostAdapter.ts
 * Mattermost adapter using WebSocket for real-time events and REST API for posting.
 */

import WebSocket from "ws";
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

interface MattermostPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  root_id?: string;
  create_at: number;
  props?: Record<string, unknown>;
}

interface MattermostWSEvent {
  event: string;
  data: {
    post?: string; // JSON-encoded MattermostPost
    channel_id?: string;
    user_id?: string;
    [key: string]: unknown;
  };
  broadcast: { channel_id?: string; team_id?: string };
  seq: number;
}

export class MattermostAdapter implements ChannelAdapter {
  name = "mattermost";
  private serverUrl: string;
  private token: string;
  private teamId: string;
  private ws: WebSocket | null = null;
  private botUserId: string | null = null;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private connected = false;
  private reconnectTimer?: NodeJS.Timeout;
  private seqNum = 1;

  constructor() {
    this.serverUrl = (process.env.MATTERMOST_URL || "").replace(/\/+$/, "");
    this.token = process.env.MATTERMOST_TOKEN || "";
    this.teamId = process.env.MATTERMOST_TEAM_ID || "";
  }

  async initialize(): Promise<void> {
    if (!this.serverUrl) throw new Error("MATTERMOST_URL not configured");
    if (!this.token) throw new Error("MATTERMOST_TOKEN not configured");

    // Get bot user ID
    await this.fetchBotUserId();
    // Connect WebSocket
    await this.connectWebSocket();
    console.log(`[AstraOS] Mattermost adapter initialized — ${this.serverUrl}`);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const post: Record<string, unknown> = {
      channel_id: msg.channelId,
      message: msg.text,
    };

    if (msg.replyToId) {
      post.root_id = msg.replyToId;
    }

    const resp = await fetch(`${this.serverUrl}/api/v4/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(post),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[AstraOS] Mattermost post failed:", resp.status, errBody);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.serverUrl}/api/v4/system/ping`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!resp.ok) return false;
      const data = (await resp.json()) as { status: string };
      return data.status === "OK";
    } catch {
      return false;
    }
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private async fetchBotUserId(): Promise<void> {
    const resp = await fetch(`${this.serverUrl}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!resp.ok) {
      throw new Error(`Mattermost auth failed: ${resp.status}`);
    }

    const user = (await resp.json()) as { id: string; username: string };
    this.botUserId = user.id;
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = this.serverUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:");

      this.ws = new WebSocket(`${wsUrl}/api/v4/websocket`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      const timeout = setTimeout(() => {
        reject(new Error("Mattermost WebSocket connection timeout"));
      }, 15000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        // Authenticate over WebSocket
        this.ws!.send(
          JSON.stringify({
            seq: this.seqNum++,
            action: "authentication_challenge",
            data: { token: this.token },
          }),
        );
        this.connected = true;
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as MattermostWSEvent;
          this.handleEvent(event);
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on("error", (err) => {
        console.error("[AstraOS] Mattermost WebSocket error:", err.message);
        if (!this.connected) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.scheduleReconnect();
      });
    });
  }

  private async handleEvent(event: MattermostWSEvent): Promise<void> {
    if (event.event !== "posted" || !event.data.post) return;

    let post: MattermostPost;
    try {
      post = JSON.parse(event.data.post) as MattermostPost;
    } catch {
      return;
    }

    // Ignore bot's own messages
    if (post.user_id === this.botUserId) return;

    // Skip system messages
    if (post.props?.from_webhook === "true") return;

    const incoming: IncomingMessage = {
      channelType: "mattermost",
      channelId: post.channel_id,
      userId: post.user_id,
      text: post.message,
      threadId: post.root_id || post.id,
      metadata: {
        postId: post.id,
        teamId: event.broadcast.team_id,
        createAt: post.create_at,
      },
    };

    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(incoming);
        await this.sendMessage({
          channelId: post.channel_id,
          text: response,
          replyToId: post.root_id || post.id,
        });
      } catch (err) {
        console.error("[AstraOS] Mattermost message handler error:", err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        console.log("[AstraOS] Mattermost reconnecting...");
        await this.connectWebSocket();
      } catch (err) {
        console.error("[AstraOS] Mattermost reconnect failed:", err);
        this.scheduleReconnect();
      }
    }, 5000);
  }
}
