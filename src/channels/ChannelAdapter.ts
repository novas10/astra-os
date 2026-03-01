/**
 * AstraOS — ChannelAdapter.ts
 * Base interface for all channel adapters. 10+ platforms supported.
 */

export interface IncomingMessage {
  channelType: string;
  channelId: string;
  userId: string;
  username?: string;
  text: string;
  mediaUrl?: string;
  replyToId?: string;
  threadId?: string;
  metadata: Record<string, unknown>;
}

export interface OutgoingMessage {
  channelId: string;
  text: string;
  replyToId?: string;
  mediaUrl?: string;
  format?: "text" | "markdown" | "html";
}

export interface ChannelAdapter {
  name: string;
  initialize(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void;
  healthCheck(): Promise<boolean>;
}
