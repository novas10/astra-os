/**
 * AstraOS — TwitchAdapter.ts
 * Twitch chat adapter via TMI (Twitch Messaging Interface) over WebSocket.
 * Connects to irc.chat.twitch.tv:443 using WSS.
 */

import WebSocket from "ws";
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class TwitchAdapter implements ChannelAdapter {
  name = "twitch";
  private accessToken: string;
  private channels: string[];
  private botUsername: string;
  private ws: WebSocket | null = null;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private connected = false;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;

  constructor() {
    this.accessToken = process.env.TWITCH_ACCESS_TOKEN || "";
    this.channels = (process.env.TWITCH_CHANNELS || "").split(",").map((c) => c.trim().toLowerCase().replace(/^#/, ""));
    this.botUsername = (process.env.TWITCH_BOT_USERNAME || "AstraBot").toLowerCase();
  }

  async initialize(): Promise<void> {
    if (!this.accessToken) throw new Error("TWITCH_ACCESS_TOKEN not configured");
    if (!this.channels.length || !this.channels[0]) throw new Error("TWITCH_CHANNELS not configured");
    await this.connect();
    console.log(`[AstraOS] Twitch adapter initialized — channels: ${this.channels.join(", ")}`);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const channel = msg.channelId.startsWith("#") ? msg.channelId : `#${msg.channelId}`;
    // Twitch has a 500-char message limit; split if necessary
    const lines = msg.text.split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const chunks = this.chunkMessage(line, 490);
        for (const chunk of chunks) {
          this.ws.send(`PRIVMSG ${channel} :${chunk}`);
        }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

      const timeout = setTimeout(() => {
        reject(new Error("Twitch WebSocket connection timeout"));
      }, 15000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        // Authenticate with TMI
        this.ws!.send(`PASS oauth:${this.accessToken}`);
        this.ws!.send(`NICK ${this.botUsername}`);
        // Request capabilities for tags and commands
        this.ws!.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        // Join channels
        for (const channel of this.channels) {
          this.ws!.send(`JOIN #${channel}`);
        }
        this.connected = true;
        this.startPingLoop();
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        const raw = data.toString();
        const lines = raw.split("\r\n");
        for (const line of lines) {
          if (line.trim()) this.handleLine(line);
        }
      });

      this.ws.on("error", (err) => {
        console.error("[AstraOS] Twitch WebSocket error:", err.message);
        if (!this.connected) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.scheduleReconnect();
      });
    });
  }

  private handleLine(line: string): void {
    // Handle PING from Twitch
    if (line.startsWith("PING")) {
      this.ws?.send("PONG :tmi.twitch.tv");
      return;
    }

    // Parse TMI PRIVMSG — format: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
    const privmsgMatch = line.match(
      /(?:@(\S+)\s+)?:(\w+)!\w+@\w+\.tmi\.twitch\.tv\s+PRIVMSG\s+(#\w+)\s+:(.*)/,
    );

    if (!privmsgMatch) return;

    const [, tagsRaw, username, channel, text] = privmsgMatch;

    // Ignore messages from self
    if (username.toLowerCase() === this.botUsername) return;

    // Parse tags into metadata
    const metadata: Record<string, unknown> = {};
    if (tagsRaw) {
      for (const tag of tagsRaw.split(";")) {
        const [key, value] = tag.split("=");
        if (key && value !== undefined) {
          metadata[key] = value;
        }
      }
    }

    const incoming: IncomingMessage = {
      channelType: "twitch",
      channelId: channel.replace(/^#/, ""),
      userId: metadata["user-id"] as string || username,
      username,
      text,
      metadata: {
        ...metadata,
        badges: metadata["badges"],
        color: metadata["color"],
        subscriber: metadata["subscriber"] === "1",
        moderator: metadata["mod"] === "1",
      },
    };

    if (this.messageHandler) {
      this.messageHandler(incoming)
        .then((response) => this.sendMessage({ channelId: incoming.channelId, text: response }))
        .catch((err) => console.error("[AstraOS] Twitch message handler error:", err));
    }
  }

  private startPingLoop(): void {
    // Send PING every 4 minutes to keep connection alive
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("PING :tmi.twitch.tv");
      }
    }, 240000);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        console.log("[AstraOS] Twitch reconnecting...");
        await this.connect();
      } catch (err) {
        console.error("[AstraOS] Twitch reconnect failed:", err);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  private chunkMessage(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.substring(i, i + maxLen));
    }
    return chunks;
  }
}
