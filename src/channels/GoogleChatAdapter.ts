/**
 * AstraOS — GoogleChatAdapter.ts
 * Google Chat (Workspace) adapter via webhook and Bot API
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class GoogleChatAdapter implements ChannelAdapter {
  name = "google_chat";
  private serviceAccountKey: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.serviceAccountKey = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT || "";
  }

  async initialize(): Promise<void> {
    console.log("[AstraOS] Google Chat adapter initialized");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async handleWebhook(body: Record<string, unknown>): Promise<unknown> {
    const type = body.type as string;

    if (type === "ADDED_TO_SPACE") {
      return { text: "AstraOS agent is ready! Send me a message." };
    }

    if (type === "MESSAGE") {
      const message = body.message as Record<string, unknown>;
      const sender = body.user as Record<string, unknown>;
      const space = body.space as Record<string, unknown>;

      const msg: IncomingMessage = {
        channelType: "google_chat",
        channelId: (space?.name as string) || "",
        userId: (sender?.name as string) || "",
        username: (sender?.displayName as string) || "",
        text: (message?.text as string) || (message?.argumentText as string) || "",
        metadata: {
          spaceName: space?.name,
          threadName: (message as Record<string, unknown>)?.thread
            ? ((message as Record<string, unknown>).thread as Record<string, unknown>)?.name
            : undefined,
        },
      };

      if (this.messageHandler) {
        const response = await this.messageHandler(msg);
        return { text: response };
      }
    }

    return { text: "" };
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const token = await this.getAccessToken();
    await fetch(`https://chat.googleapis.com/v1/${msg.channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: msg.text }),
    });
  }

  private async getAccessToken(): Promise<string> {
    // In production, use google-auth-library for service account JWT
    return process.env.GOOGLE_CHAT_TOKEN || "";
  }

  async healthCheck(): Promise<boolean> {
    return !!this.serviceAccountKey || !!process.env.GOOGLE_CHAT_TOKEN;
  }
}
