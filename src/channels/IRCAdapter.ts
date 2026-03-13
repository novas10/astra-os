/**
 * AstraOS — IRCAdapter.ts
 * IRC protocol adapter using Node.js net/tls modules.
 * Supports PING/PONG keepalive, PRIVMSG, JOIN/PART, and TLS connections.
 */

import * as net from "net";
import * as tls from "tls";
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class IRCAdapter implements ChannelAdapter {
  name = "irc";
  private server: string;
  private port: number;
  private nick: string;
  private channels: string[];
  private useTls: boolean;
  private socket: net.Socket | tls.TLSSocket | null = null;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private buffer = "";
  private reconnectTimer?: NodeJS.Timeout;
  private connected = false;

  constructor() {
    this.server = process.env.IRC_SERVER || "irc.libera.chat";
    this.port = parseInt(process.env.IRC_PORT || "6697", 10);
    this.nick = process.env.IRC_NICK || "AstraBot";
    this.channels = (process.env.IRC_CHANNELS || "#astra").split(",").map((c) => c.trim());
    this.useTls = process.env.IRC_USE_TLS !== "false";
  }

  async initialize(): Promise<void> {
    if (!this.server) throw new Error("IRC_SERVER not configured");
    await this.connect();
    console.log(`[AstraOS] IRC adapter initialized — ${this.server}:${this.port} as ${this.nick}`);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this.socket || !this.connected) return;
    const target = msg.channelId;
    const lines = msg.text.split("\n");
    for (const line of lines) {
      if (line.trim()) {
        this.raw(`PRIVMSG ${target} :${line}`);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.connected && this.socket !== null && !this.socket.destroyed;
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.raw("QUIT :AstraOS shutting down");
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        this.connected = true;
        this.raw(`NICK ${this.nick}`);
        this.raw(`USER ${this.nick} 0 * :AstraOS Bot`);
        resolve();
      };

      try {
        if (this.useTls) {
          this.socket = tls.connect(
            { host: this.server, port: this.port, rejectUnauthorized: false },
            onConnect,
          );
        } else {
          this.socket = net.createConnection({ host: this.server, port: this.port }, onConnect);
        }

        this.socket.setEncoding("utf-8");
        this.socket.on("data", (data: string) => this.onData(data));
        this.socket.on("error", (err) => {
          console.error("[AstraOS] IRC socket error:", err.message);
          if (!this.connected) reject(err);
        });
        this.socket.on("close", () => {
          this.connected = false;
          this.scheduleReconnect();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private raw(line: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(line + "\r\n");
    }
  }

  private onData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\r\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    // PING/PONG keepalive
    if (line.startsWith("PING")) {
      this.raw("PONG" + line.substring(4));
      return;
    }

    // Parse IRC message: :prefix COMMAND params :trailing
    const match = line.match(/^:(\S+)\s+(\S+)\s+(.*)/);
    if (!match) return;

    const [, prefix, command, params] = match;

    switch (command) {
      case "001": // RPL_WELCOME — join channels after registration
        for (const channel of this.channels) {
          this.raw(`JOIN ${channel}`);
        }
        break;

      case "PRIVMSG":
        this.handlePrivmsg(prefix, params);
        break;

      case "433": // ERR_NICKNAMEINUSE
        this.nick += "_";
        this.raw(`NICK ${this.nick}`);
        break;
    }
  }

  private async handlePrivmsg(prefix: string, params: string): Promise<void> {
    // :nick!user@host PRIVMSG #channel :message text
    const nickMatch = prefix.match(/^([^!]+)/);
    const sender = nickMatch ? nickMatch[1] : prefix;

    const spaceIdx = params.indexOf(" :");
    if (spaceIdx === -1) return;

    const target = params.substring(0, spaceIdx);
    const text = params.substring(spaceIdx + 2);

    // Ignore messages from self
    if (sender === this.nick) return;

    // Determine reply target: if sent to a channel, reply there; if DM, reply to sender
    const replyTarget = target.startsWith("#") ? target : sender;

    const incoming: IncomingMessage = {
      channelType: "irc",
      channelId: replyTarget,
      userId: sender,
      username: sender,
      text,
      metadata: { target, prefix, isDirect: !target.startsWith("#") },
    };

    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(incoming);
        await this.sendMessage({ channelId: replyTarget, text: response });
      } catch (err) {
        console.error("[AstraOS] IRC message handler error:", err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        console.log("[AstraOS] IRC reconnecting...");
        await this.connect();
      } catch (err) {
        console.error("[AstraOS] IRC reconnect failed:", err);
        this.scheduleReconnect();
      }
    }, 5000);
  }
}
