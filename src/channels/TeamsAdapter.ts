/**
 * AstraOS — TeamsAdapter.ts
 * Microsoft Teams channel adapter via Bot Framework
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "./ChannelAdapter";

export class TeamsAdapter implements ChannelAdapter {
  name = "teams";
  private appId: string;
  private appPassword: string;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;

  constructor() {
    this.appId = process.env.TEAMS_APP_ID || "";
    this.appPassword = process.env.TEAMS_APP_PASSWORD || "";
  }

  async initialize(): Promise<void> {
    if (!this.appId) throw new Error("TEAMS_APP_ID not configured");
    console.log("[AstraOS] Teams adapter initialized");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async handleWebhook(body: Record<string, unknown>): Promise<unknown> {
    if (body.type === "message" && body.text) {
      const from = body.from as Record<string, unknown>;
      const conversation = body.conversation as Record<string, unknown>;

      const msg: IncomingMessage = {
        channelType: "teams",
        channelId: conversation?.id as string || "",
        userId: from?.id as string || "",
        username: from?.name as string,
        text: body.text as string,
        metadata: {
          serviceUrl: body.serviceUrl,
          replyToId: body.id,
          channelData: body.channelData,
        },
      };

      if (this.messageHandler) {
        const response = await this.messageHandler(msg);
        await this.sendReply(body, response);
      }
    }

    return { status: 200 };
  }

  private async sendReply(activity: Record<string, unknown>, text: string): Promise<void> {
    const serviceUrl = activity.serviceUrl as string;
    const conversationId = (activity.conversation as Record<string, unknown>)?.id as string;

    const token = await this.getToken();
    await fetch(`${serviceUrl}/v3/conversations/${conversationId}/activities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "message",
        text,
        replyToId: activity.id,
      }),
    });
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const token = await this.getToken();
    const serviceUrl = process.env.TEAMS_SERVICE_URL || "https://smba.trafficmanager.net/teams";

    await fetch(`${serviceUrl}/v3/conversations/${msg.channelId}/activities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type: "message", text: msg.text }),
    });
  }

  private async getToken(): Promise<string> {
    const resp = await fetch("https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.appId,
        client_secret: this.appPassword,
        scope: "https://api.botframework.com/.default",
      }),
    });
    const data = (await resp.json()) as { access_token: string };
    return data.access_token;
  }

  async healthCheck(): Promise<boolean> {
    return !!this.appId && !!this.appPassword;
  }
}
