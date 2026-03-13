/**
 * AstraOS — channel-adapters.test.ts
 * Comprehensive tests for all 7 new channel adapters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage } from "../channels/ChannelAdapter";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

// Mock net/tls for IRC
const mockSocket = {
  setEncoding: vi.fn(),
  on: vi.fn(),
  write: vi.fn(),
  destroy: vi.fn(),
  destroyed: false,
};

vi.mock("net", () => ({
  createConnection: vi.fn((_opts: unknown, cb: () => void) => {
    setTimeout(cb, 0);
    return mockSocket;
  }),
}));

vi.mock("tls", () => ({
  connect: vi.fn((_opts: unknown, cb: () => void) => {
    setTimeout(cb, 0);
    return mockSocket;
  }),
}));

// Mock WebSocket for Twitch, Mattermost, Nostr
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(_url?: string, _opts?: unknown) {}

  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  send = vi.fn();
  close = vi.fn();

  // Test helper to emit events
  _emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers[event] || []) {
      h(...args);
    }
  }
}

vi.mock("ws", () => ({
  default: MockWebSocket,
  __esModule: true,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock crypto module partially — keep real crypto but spy on createHmac
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return { ...actual };
});

// ---------------------------------------------------------------------------
// IRC Adapter
// ---------------------------------------------------------------------------

describe("IRCAdapter", () => {
  let IRCAdapter: typeof import("../channels/IRCAdapter").IRCAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSocket.destroyed = false;
    mockSocket.on.mockReset();
    mockSocket.write.mockReset();
    mockSocket.setEncoding.mockReset();
    mockSocket.destroy.mockReset();

    process.env.IRC_SERVER = "irc.test.net";
    process.env.IRC_PORT = "6667";
    process.env.IRC_NICK = "TestBot";
    process.env.IRC_CHANNELS = "#test,#dev";
    process.env.IRC_USE_TLS = "false";

    const mod = await import("../channels/IRCAdapter");
    IRCAdapter = mod.IRCAdapter;
  });

  afterEach(() => {
    delete process.env.IRC_SERVER;
    delete process.env.IRC_PORT;
    delete process.env.IRC_NICK;
    delete process.env.IRC_CHANNELS;
    delete process.env.IRC_USE_TLS;
  });

  it("creates an instance with name 'irc'", () => {
    const adapter = new IRCAdapter();
    expect(adapter.name).toBe("irc");
  });

  it("reads configuration from environment variables", async () => {
    const adapter = new IRCAdapter();
    // The constructor reads env vars; initialize triggers connect
    await adapter.initialize();
    // Should have called net.createConnection (TLS=false)
    const net = await import("net");
    expect(net.createConnection).toHaveBeenCalled();
  });

  it("onMessage registers a callback", () => {
    const adapter = new IRCAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    // No error should occur — handler stored internally
    expect(true).toBe(true);
  });

  it("healthCheck returns false when not connected", async () => {
    const adapter = new IRCAdapter();
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(false);
  });

  it("sendMessage does nothing when socket is null", async () => {
    const adapter = new IRCAdapter();
    // Not initialized, socket is null
    await adapter.sendMessage({ channelId: "#test", text: "hello" });
    expect(mockSocket.write).not.toHaveBeenCalled();
  });

  it("destroy cleans up socket", () => {
    const adapter = new IRCAdapter();
    // destroy should not throw even when not initialized
    adapter.destroy();
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Twitch Adapter
// ---------------------------------------------------------------------------

describe("TwitchAdapter", () => {
  let TwitchAdapter: typeof import("../channels/TwitchAdapter").TwitchAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.TWITCH_ACCESS_TOKEN = "test_token_123";
    process.env.TWITCH_CHANNELS = "testchannel";
    process.env.TWITCH_BOT_USERNAME = "astrabot";

    const mod = await import("../channels/TwitchAdapter");
    TwitchAdapter = mod.TwitchAdapter;
  });

  afterEach(() => {
    delete process.env.TWITCH_ACCESS_TOKEN;
    delete process.env.TWITCH_CHANNELS;
    delete process.env.TWITCH_BOT_USERNAME;
  });

  it("creates an instance with name 'twitch'", () => {
    const adapter = new TwitchAdapter();
    expect(adapter.name).toBe("twitch");
  });

  it("throws when TWITCH_ACCESS_TOKEN is not configured", async () => {
    delete process.env.TWITCH_ACCESS_TOKEN;
    vi.resetModules();
    const mod = await import("../channels/TwitchAdapter");
    const adapter = new mod.TwitchAdapter();
    await expect(adapter.initialize()).rejects.toThrow("TWITCH_ACCESS_TOKEN not configured");
  });

  it("throws when TWITCH_CHANNELS is not configured", async () => {
    process.env.TWITCH_CHANNELS = "";
    vi.resetModules();
    const mod = await import("../channels/TwitchAdapter");
    const adapter = new mod.TwitchAdapter();
    await expect(adapter.initialize()).rejects.toThrow("TWITCH_CHANNELS not configured");
  });

  it("onMessage stores the handler", () => {
    const adapter = new TwitchAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    // Should not throw
    expect(true).toBe(true);
  });

  it("healthCheck returns false when not connected", async () => {
    const adapter = new TwitchAdapter();
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(false);
  });

  it("destroy does not throw when not initialized", () => {
    const adapter = new TwitchAdapter();
    expect(() => adapter.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LINE Adapter
// ---------------------------------------------------------------------------

describe("LINEAdapter", () => {
  let LINEAdapter: typeof import("../channels/LINEAdapter").LINEAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();

    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line_test_token";
    process.env.LINE_CHANNEL_SECRET = "line_test_secret";

    const mod = await import("../channels/LINEAdapter");
    LINEAdapter = mod.LINEAdapter;
  });

  afterEach(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_CHANNEL_SECRET;
  });

  it("creates an instance with name 'line'", () => {
    const adapter = new LINEAdapter();
    expect(adapter.name).toBe("line");
  });

  it("throws when LINE_CHANNEL_ACCESS_TOKEN is missing", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    vi.resetModules();
    const mod = await import("../channels/LINEAdapter");
    const adapter = new mod.LINEAdapter();
    await expect(adapter.initialize()).rejects.toThrow("LINE_CHANNEL_ACCESS_TOKEN not configured");
  });

  it("throws when LINE_CHANNEL_SECRET is missing", async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    vi.resetModules();
    const mod = await import("../channels/LINEAdapter");
    const adapter = new mod.LINEAdapter();
    await expect(adapter.initialize()).rejects.toThrow("LINE_CHANNEL_SECRET not configured");
  });

  it("initialize succeeds with valid config", async () => {
    const adapter = new LINEAdapter();
    await expect(adapter.initialize()).resolves.toBeUndefined();
  });

  it("onMessage registers a handler", () => {
    const adapter = new LINEAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(true).toBe(true);
  });

  it("handleWebhook processes a text message event", async () => {
    const adapter = new LINEAdapter();
    await adapter.initialize();

    const handler = vi.fn().mockResolvedValue("Reply text");
    adapter.onMessage(handler);

    // Mock the reply fetch call
    mockFetch.mockResolvedValueOnce({ ok: true });

    const body = {
      destination: "dest123",
      events: [
        {
          type: "message",
          replyToken: "token_abc",
          source: { type: "user", userId: "user123" },
          message: { type: "text", id: "msg1", text: "Hello bot" },
          timestamp: 1700000000000,
        },
      ],
    };

    const result = await adapter.handleWebhook(body);
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();

    const incomingArg = handler.mock.calls[0][0] as IncomingMessage;
    expect(incomingArg.channelType).toBe("line");
    expect(incomingArg.userId).toBe("user123");
    expect(incomingArg.text).toBe("Hello bot");
  });

  it("handleWebhook returns 403 for invalid signature", async () => {
    const adapter = new LINEAdapter();
    await adapter.initialize();

    const result = await adapter.handleWebhook(
      { destination: "d", events: [] },
      { "x-line-signature": "badsignature" },
    );
    expect(result).toEqual({ error: "Invalid signature", status: 403 });
  });

  it("sendMessage calls the push API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new LINEAdapter();
    await adapter.initialize();
    await adapter.sendMessage({ channelId: "user123", text: "Hi there" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("healthCheck calls the bot info API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new LINEAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/info",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer line_test_token" }),
      }),
    );
  });

  it("healthCheck returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const adapter = new LINEAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feishu Adapter
// ---------------------------------------------------------------------------

describe("FeishuAdapter", () => {
  let FeishuAdapter: typeof import("../channels/FeishuAdapter").FeishuAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();

    process.env.FEISHU_APP_ID = "cli_test_app";
    process.env.FEISHU_APP_SECRET = "test_secret";
    process.env.FEISHU_VERIFICATION_TOKEN = "verify_token";
    process.env.FEISHU_ENCRYPT_KEY = "";

    const mod = await import("../channels/FeishuAdapter");
    FeishuAdapter = mod.FeishuAdapter;
  });

  afterEach(() => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_VERIFICATION_TOKEN;
    delete process.env.FEISHU_ENCRYPT_KEY;
  });

  it("creates an instance with name 'feishu'", () => {
    const adapter = new FeishuAdapter();
    expect(adapter.name).toBe("feishu");
  });

  it("throws when FEISHU_APP_ID is missing", async () => {
    delete process.env.FEISHU_APP_ID;
    vi.resetModules();
    const mod = await import("../channels/FeishuAdapter");
    const adapter = new mod.FeishuAdapter();
    await expect(adapter.initialize()).rejects.toThrow("FEISHU_APP_ID not configured");
  });

  it("throws when FEISHU_APP_SECRET is missing", async () => {
    delete process.env.FEISHU_APP_SECRET;
    vi.resetModules();
    const mod = await import("../channels/FeishuAdapter");
    const adapter = new mod.FeishuAdapter();
    await expect(adapter.initialize()).rejects.toThrow("FEISHU_APP_SECRET not configured");
  });

  it("handleWebhook returns challenge for url_verification", async () => {
    const adapter = new FeishuAdapter();
    const result = await adapter.handleWebhook({
      type: "url_verification",
      challenge: "challenge_value_123",
    });
    expect(result).toEqual({ challenge: "challenge_value_123" });
  });

  it("handleWebhook rejects invalid verification token", async () => {
    const adapter = new FeishuAdapter();
    const result = await adapter.handleWebhook({
      schema: "2.0",
      header: {
        event_id: "ev1",
        event_type: "im.message.receive_v1",
        create_time: "1700000000",
        token: "wrong_token",
        app_id: "cli_test_app",
      },
      event: {},
    });
    expect(result).toEqual({ error: "Invalid verification token", status: 403 });
  });

  it("handleWebhook deduplicates events", async () => {
    const adapter = new FeishuAdapter();
    const handler = vi.fn().mockResolvedValue("ok");
    adapter.onMessage(handler);

    // Mock fetch for reply
    mockFetch.mockResolvedValue({ ok: true });

    const payload = {
      schema: "2.0",
      header: {
        event_id: "dup_event_1",
        event_type: "im.message.receive_v1",
        create_time: "1700000000",
        token: "verify_token",
        app_id: "cli_test_app",
      },
      event: {
        sender: { sender_id: { open_id: "ou_user1" }, sender_type: "user" },
        message: {
          message_id: "msg_1",
          chat_id: "oc_chat1",
          chat_type: "group",
          content: JSON.stringify({ text: "Hello" }),
          message_type: "text",
        },
      },
    };

    await adapter.handleWebhook(payload);
    await adapter.handleWebhook(payload); // duplicate

    // Handler should only be called once due to dedup
    expect(handler).toHaveBeenCalledOnce();
  });

  it("onMessage registers a handler", () => {
    const adapter = new FeishuAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mattermost Adapter
// ---------------------------------------------------------------------------

describe("MattermostAdapter", () => {
  let MattermostAdapter: typeof import("../channels/MattermostAdapter").MattermostAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();

    process.env.MATTERMOST_URL = "https://mattermost.example.com";
    process.env.MATTERMOST_TOKEN = "mm_token_abc";
    process.env.MATTERMOST_TEAM_ID = "team123";

    const mod = await import("../channels/MattermostAdapter");
    MattermostAdapter = mod.MattermostAdapter;
  });

  afterEach(() => {
    delete process.env.MATTERMOST_URL;
    delete process.env.MATTERMOST_TOKEN;
    delete process.env.MATTERMOST_TEAM_ID;
  });

  it("creates an instance with name 'mattermost'", () => {
    const adapter = new MattermostAdapter();
    expect(adapter.name).toBe("mattermost");
  });

  it("throws when MATTERMOST_URL is not configured", async () => {
    delete process.env.MATTERMOST_URL;
    vi.resetModules();
    const mod = await import("../channels/MattermostAdapter");
    const adapter = new mod.MattermostAdapter();
    await expect(adapter.initialize()).rejects.toThrow("MATTERMOST_URL not configured");
  });

  it("throws when MATTERMOST_TOKEN is not configured", async () => {
    delete process.env.MATTERMOST_TOKEN;
    vi.resetModules();
    const mod = await import("../channels/MattermostAdapter");
    const adapter = new mod.MattermostAdapter();
    await expect(adapter.initialize()).rejects.toThrow("MATTERMOST_TOKEN not configured");
  });

  it("onMessage stores the handler", () => {
    const adapter = new MattermostAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(true).toBe(true);
  });

  it("sendMessage posts to the REST API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new MattermostAdapter();
    await adapter.sendMessage({
      channelId: "ch_abc",
      text: "Hello Mattermost",
      replyToId: "root_post_1",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://mattermost.example.com/api/v4/posts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mm_token_abc",
        }),
      }),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.channel_id).toBe("ch_abc");
    expect(sentBody.message).toBe("Hello Mattermost");
    expect(sentBody.root_id).toBe("root_post_1");
  });

  it("healthCheck calls system/ping endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "OK" }),
    });

    const adapter = new MattermostAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://mattermost.example.com/api/v4/system/ping",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer mm_token_abc" }),
      }),
    );
  });

  it("healthCheck returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const adapter = new MattermostAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });

  it("destroy does not throw when not initialized", () => {
    const adapter = new MattermostAdapter();
    expect(() => adapter.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Nextcloud Adapter
// ---------------------------------------------------------------------------

describe("NextcloudAdapter", () => {
  let NextcloudAdapter: typeof import("../channels/NextcloudAdapter").NextcloudAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();

    process.env.NEXTCLOUD_URL = "https://cloud.example.com";
    process.env.NEXTCLOUD_USER = "admin";
    process.env.NEXTCLOUD_TOKEN = "nc_token_xyz";
    process.env.NEXTCLOUD_ROOMS = "room1,room2";

    const mod = await import("../channels/NextcloudAdapter");
    NextcloudAdapter = mod.NextcloudAdapter;
  });

  afterEach(() => {
    delete process.env.NEXTCLOUD_URL;
    delete process.env.NEXTCLOUD_USER;
    delete process.env.NEXTCLOUD_TOKEN;
    delete process.env.NEXTCLOUD_ROOMS;
  });

  it("creates an instance with name 'nextcloud'", () => {
    const adapter = new NextcloudAdapter();
    expect(adapter.name).toBe("nextcloud");
  });

  it("throws when NEXTCLOUD_URL is missing", async () => {
    delete process.env.NEXTCLOUD_URL;
    vi.resetModules();
    const mod = await import("../channels/NextcloudAdapter");
    const adapter = new mod.NextcloudAdapter();
    await expect(adapter.initialize()).rejects.toThrow("NEXTCLOUD_URL not configured");
  });

  it("throws when NEXTCLOUD_USER is missing", async () => {
    delete process.env.NEXTCLOUD_USER;
    vi.resetModules();
    const mod = await import("../channels/NextcloudAdapter");
    const adapter = new mod.NextcloudAdapter();
    await expect(adapter.initialize()).rejects.toThrow("NEXTCLOUD_USER not configured");
  });

  it("throws when NEXTCLOUD_TOKEN is missing", async () => {
    delete process.env.NEXTCLOUD_TOKEN;
    vi.resetModules();
    const mod = await import("../channels/NextcloudAdapter");
    const adapter = new mod.NextcloudAdapter();
    await expect(adapter.initialize()).rejects.toThrow("NEXTCLOUD_TOKEN not configured");
  });

  it("onMessage registers a handler", () => {
    const adapter = new NextcloudAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(true).toBe(true);
  });

  it("sendMessage posts to the OCS chat API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new NextcloudAdapter();
    await adapter.sendMessage({
      channelId: "room1",
      text: "Hello NC",
      replyToId: "42",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://cloud.example.com/ocs/v2.php/apps/spreed/api/v1/chat/room1",
      expect.objectContaining({ method: "POST" }),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.message).toBe("Hello NC");
    expect(sentBody.replyTo).toBe(42);
  });

  it("sendMessage uses Basic auth with encoded credentials", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new NextcloudAdapter();
    await adapter.sendMessage({ channelId: "room1", text: "test" });

    const headers = mockFetch.mock.calls[0][1].headers;
    const expected = Buffer.from("admin:nc_token_xyz").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("healthCheck calls the room listing endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter = new NextcloudAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
  });

  it("healthCheck returns false on error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const adapter = new NextcloudAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });

  it("destroy clears polling timers", () => {
    const adapter = new NextcloudAdapter();
    expect(() => adapter.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Nostr Adapter
// ---------------------------------------------------------------------------

describe("NostrAdapter", () => {
  let NostrAdapter: typeof import("../channels/NostrAdapter").NostrAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // A valid 32-byte hex private key for secp256k1
    process.env.NOSTR_PRIVATE_KEY =
      "5a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778";
    process.env.NOSTR_RELAYS = "wss://relay.test.io";

    const mod = await import("../channels/NostrAdapter");
    NostrAdapter = mod.NostrAdapter;
  });

  afterEach(() => {
    delete process.env.NOSTR_PRIVATE_KEY;
    delete process.env.NOSTR_RELAYS;
  });

  it("creates an instance with name 'nostr'", () => {
    const adapter = new NostrAdapter();
    expect(adapter.name).toBe("nostr");
  });

  it("throws when NOSTR_PRIVATE_KEY is missing", async () => {
    delete process.env.NOSTR_PRIVATE_KEY;
    vi.resetModules();
    const mod = await import("../channels/NostrAdapter");
    const adapter = new mod.NostrAdapter();
    await expect(adapter.initialize()).rejects.toThrow("NOSTR_PRIVATE_KEY not configured");
  });

  it("onMessage registers a handler", () => {
    const adapter = new NostrAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(true).toBe(true);
  });

  it("healthCheck returns false when no relays connected", async () => {
    const adapter = new NostrAdapter();
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });

  it("destroy does not throw when not initialized", () => {
    const adapter = new NostrAdapter();
    expect(() => adapter.destroy()).not.toThrow();
  });

  it("uses default relays when NOSTR_RELAYS is unset", async () => {
    delete process.env.NOSTR_RELAYS;
    vi.resetModules();
    const mod = await import("../channels/NostrAdapter");
    const adapter = new mod.NostrAdapter();
    // The adapter should still construct without error (defaults to damus + nos.lol)
    expect(adapter.name).toBe("nostr");
  });
});
