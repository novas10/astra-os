/**
 * AstraOS — TTS Providers
 * Multiple Text-to-Speech backends: OpenAI, Edge TTS (free), Google Cloud TTS.
 */

import { logger } from "../utils/logger";

export interface TTSProviderOptions {
  voice?: string;
  speed?: number;
  format?: "mp3" | "opus" | "wav" | "pcm";
  language?: string;
}

export interface TTSProvider {
  name: string;
  synthesize(text: string, options?: TTSProviderOptions): Promise<Buffer>;
  listVoices?(): Promise<Array<{ id: string; name: string; language: string }>>;
}

// ─── OpenAI TTS Provider ───

export class OpenAITTSProvider implements TTSProvider {
  name = "openai";
  private apiKey: string;
  private model: string;
  private defaultVoice: string;

  constructor(apiKey?: string, model?: string, defaultVoice?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model || "tts-1";
    this.defaultVoice = defaultVoice || "nova";
  }

  async synthesize(text: string, options?: TTSProviderOptions): Promise<Buffer> {
    const voice = options?.voice || this.defaultVoice;
    const speed = options?.speed ?? 1.0;
    const format = options?.format || "mp3";

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice,
        speed,
        response_format: format,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI TTS failed (${res.status}): ${body}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    logger.info(`[AstraOS] OpenAI TTS: ${text.length} chars → ${arrayBuffer.byteLength} bytes (${voice}/${format})`);
    return Buffer.from(arrayBuffer);
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    return [
      { id: "alloy", name: "Alloy", language: "en" },
      { id: "echo", name: "Echo", language: "en" },
      { id: "fable", name: "Fable", language: "en" },
      { id: "onyx", name: "Onyx", language: "en" },
      { id: "nova", name: "Nova", language: "en" },
      { id: "shimmer", name: "Shimmer", language: "en" },
    ];
  }
}

// ─── Edge TTS Provider (Free, No API Key) ───

/**
 * Microsoft Edge TTS — uses the same free TTS WebSocket endpoint as the Edge browser.
 * No API key required. Supports SSML and a wide range of voices and languages.
 */
export class EdgeTTSProvider implements TTSProvider {
  name = "edge-tts";
  private defaultVoice: string;
  private wsEndpoint =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

  constructor(defaultVoice?: string) {
    this.defaultVoice = defaultVoice || "en-US-AriaNeural";
  }

  async synthesize(text: string, options?: TTSProviderOptions): Promise<Buffer> {
    const voice = options?.voice || this.defaultVoice;
    const rate = options?.speed ? `${((options.speed - 1) * 100).toFixed(0)}%` : "+0%";
    const format = this.mapFormat(options?.format || "mp3");

    const requestId = this.generateRequestId();
    const timestamp = new Date().toISOString();

    const configMessage =
      `X-Timestamp:${timestamp}\r\n` +
      `Content-Type:application/json; charset=utf-8\r\n` +
      `Path:speech.config\r\n\r\n` +
      JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
              outputFormat: format,
            },
          },
        },
      });

    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
      `<voice name='${voice}'>` +
      `<prosody rate='${rate}' pitch='+0Hz'>` +
      this.escapeXml(text) +
      `</prosody></voice></speak>`;

    const ssmlMessage =
      `X-RequestId:${requestId}\r\n` +
      `Content-Type:application/ssml+xml\r\n` +
      `X-Timestamp:${timestamp}\r\n` +
      `Path:ssml\r\n\r\n` +
      ssml;

    return new Promise<Buffer>((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      const wsUrl =
        `${this.wsEndpoint}?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4` +
        `&ConnectionId=${requestId}`;

      // Use dynamic import for ws to avoid hard dependency issues
      let ws: any;
      try {
        const WebSocket = require("ws");
        ws = new WebSocket(wsUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
            Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
          },
        });
      } catch {
        reject(new Error("Edge TTS requires the 'ws' package"));
        return;
      }

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Edge TTS timed out after 30s"));
      }, 30000);

      ws.on("open", () => {
        ws.send(configMessage);
        ws.send(ssmlMessage);
      });

      ws.on("message", (data: Buffer | string) => {
        if (typeof data === "string" || (Buffer.isBuffer(data) && data.toString("utf-8", 0, 4) !== "Path")) {
          // Check for turn.end in text messages
          const str = typeof data === "string" ? data : data.toString("utf-8");
          if (str.includes("Path:turn.end")) {
            clearTimeout(timeout);
            ws.close();
            resolve(Buffer.concat(audioChunks));
            return;
          }
        }

        if (Buffer.isBuffer(data)) {
          // Binary messages: audio data prefixed with a header
          // Header ends with "Path:audio\r\n" — audio data follows after that
          const headerEnd = this.findHeaderEnd(data);
          if (headerEnd >= 0) {
            audioChunks.push(data.subarray(headerEnd));
          }
        }
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Edge TTS WebSocket error: ${err.message}`));
      });

      ws.on("close", () => {
        clearTimeout(timeout);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        }
        // If no audio received, the promise remains pending until timeout
      });
    });
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    const res = await fetch(
      "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        },
      }
    );

    if (!res.ok) throw new Error(`Edge TTS voice list failed: ${res.status}`);

    const voices = (await res.json()) as Array<{
      ShortName: string;
      FriendlyName: string;
      Locale: string;
    }>;

    return voices.map((v) => ({
      id: v.ShortName,
      name: v.FriendlyName,
      language: v.Locale,
    }));
  }

  private mapFormat(format: string): string {
    switch (format) {
      case "mp3":
        return "audio-24khz-96kbitrate-mono-mp3";
      case "opus":
        return "webm-24khz-16bit-mono-opus";
      case "wav":
        return "riff-24khz-16bit-mono-pcm";
      case "pcm":
        return "raw-24khz-16bit-mono-pcm";
      default:
        return "audio-24khz-96kbitrate-mono-mp3";
    }
  }

  private generateRequestId(): string {
    const chars = "abcdef0123456789";
    let id = "";
    for (let i = 0; i < 32; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private findHeaderEnd(data: Buffer): number {
    // Binary messages have a 2-byte header length prefix (big-endian uint16)
    // followed by header text, then audio data
    if (data.length < 2) return -1;
    const headerLen = data.readUInt16BE(0);
    const offset = 2 + headerLen;
    return offset < data.length ? offset : -1;
  }
}

// ─── Google Cloud TTS Provider ───

export class GoogleTTSProvider implements TTSProvider {
  name = "google-tts";
  private apiKey: string;
  private defaultVoice: string;
  private defaultLanguage: string;

  constructor(apiKey?: string, defaultVoice?: string, defaultLanguage?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_TTS_API_KEY || "";
    this.defaultVoice = defaultVoice || "en-US-Neural2-F";
    this.defaultLanguage = defaultLanguage || "en-US";
  }

  async synthesize(text: string, options?: TTSProviderOptions): Promise<Buffer> {
    const voice = options?.voice || this.defaultVoice;
    const language = options?.language || this.defaultLanguage;
    const speed = options?.speed ?? 1.0;
    const format = this.mapAudioEncoding(options?.format || "mp3");

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: language,
          name: voice,
        },
        audioConfig: {
          audioEncoding: format,
          speakingRate: speed,
          pitch: 0,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google TTS failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { audioContent: string };
    const audioBuffer = Buffer.from(data.audioContent, "base64");

    logger.info(`[AstraOS] Google TTS: ${text.length} chars → ${audioBuffer.length} bytes (${voice}/${language})`);
    return audioBuffer;
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    const url = `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Google TTS voice list failed: ${res.status}`);

    const data = (await res.json()) as {
      voices: Array<{
        name: string;
        languageCodes: string[];
        ssmlGender: string;
      }>;
    };

    return data.voices.map((v) => ({
      id: v.name,
      name: `${v.name} (${v.ssmlGender})`,
      language: v.languageCodes[0] || "en-US",
    }));
  }

  private mapAudioEncoding(format: string): string {
    switch (format) {
      case "mp3":
        return "MP3";
      case "opus":
        return "OGG_OPUS";
      case "wav":
        return "LINEAR16";
      case "pcm":
        return "LINEAR16";
      default:
        return "MP3";
    }
  }
}

// ─── TTS Provider Factory ───

export function createTTSProvider(): TTSProvider {
  if (process.env.OPENAI_API_KEY) {
    logger.info("[AstraOS] TTS: Using OpenAI TTS");
    return new OpenAITTSProvider();
  }
  if (process.env.GOOGLE_TTS_API_KEY) {
    logger.info("[AstraOS] TTS: Using Google Cloud TTS");
    return new GoogleTTSProvider();
  }
  // Default to Edge TTS (free, no API key required)
  logger.info("[AstraOS] TTS: Using Edge TTS (free)");
  return new EdgeTTSProvider();
}
