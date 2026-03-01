/**
 * AstraOS — VoiceEngine.ts
 * Voice support: Text-to-Speech (ElevenLabs), Speech-to-Text, Wake Word detection, Push-to-Talk.
 */

import { logger } from "../utils/logger";
import { WebSocket as WS } from "ws";

export type TalkModeState = "listening" | "processing" | "speaking" | "interrupted";

export interface TalkModeSessionConfig {
  interruptible?: boolean;
  vadSensitivity?: number;
  silenceTimeoutMs?: number;
  onTranscript?: (sessionId: string, transcript: STTResult) => void;
  onAudio?: (sessionId: string, audioChunk: Buffer) => void;
  onStateChange?: (sessionId: string, state: TalkModeState) => void;
}

export interface TalkModeSession {
  sessionId: string;
  state: TalkModeState;
  isActive: boolean;
  audioQueue: Buffer[];
  interruptible: boolean;
  vadSensitivity: number;
  silenceTimeout: number;
  onTranscript?: (sessionId: string, transcript: STTResult) => void;
  onAudio?: (sessionId: string, audioChunk: Buffer) => void;
  onStateChange?: (sessionId: string, state: TalkModeState) => void;
}

export interface VoiceConfig {
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  wakeWord?: string;
  sttProvider?: "whisper" | "deepgram" | "google";
  sttApiKey?: string;
  talkModeEnabled?: boolean;
  vadSensitivity?: number;
  silenceTimeoutMs?: number;
}

export interface TTSOptions {
  text: string;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  model?: string;
}

export interface STTResult {
  text: string;
  confidence: number;
  language?: string;
}

export class VoiceEngine {
  private config: VoiceConfig;
  private wakeWordActive = false;
  private pushToTalkActive = false;
  private wsConnections: Map<string, WS> = new Map();

  // ─── Talk Mode State ───
  private talkModeSessions: Map<string, TalkModeSession> = new Map();
  private talkModeAudioBuffers: Map<string, Buffer[]> = new Map();
  private talkModeSilenceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private talkModeProcessingLocks: Map<string, boolean> = new Map();

  constructor(config?: VoiceConfig) {
    this.config = {
      elevenLabsApiKey: config?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY,
      elevenLabsVoiceId: config?.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
      wakeWord: config?.wakeWord || "hey astra",
      sttProvider: config?.sttProvider || "whisper",
      sttApiKey: config?.sttApiKey || process.env.STT_API_KEY,
    };
  }

  async initialize(): Promise<void> {
    if (this.config.elevenLabsApiKey) {
      logger.info("[AstraOS] VoiceEngine: ElevenLabs TTS ready");
    }
    logger.info(`[AstraOS] VoiceEngine: Wake word = "${this.config.wakeWord}"`);
  }

  // ─── Text-to-Speech (ElevenLabs) ───

  async textToSpeech(options: TTSOptions): Promise<Buffer> {
    if (!this.config.elevenLabsApiKey) {
      throw new Error("ELEVENLABS_API_KEY not configured");
    }

    const voiceId = options.voiceId || this.config.elevenLabsVoiceId;
    const model = options.model || "eleven_turbo_v2_5";

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.config.elevenLabsApiKey!,
        },
        body: JSON.stringify({
          text: options.text,
          model_id: model,
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarityBoost ?? 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─── Streaming TTS via WebSocket ───

  async streamTTS(sessionId: string, text: string, onChunk: (audio: Buffer) => void): Promise<void> {
    if (!this.config.elevenLabsApiKey) throw new Error("ELEVENLABS_API_KEY not configured");

    const voiceId = this.config.elevenLabsVoiceId;
    const ws = new WS(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_turbo_v2_5`,
      { headers: { "xi-api-key": this.config.elevenLabsApiKey! } }
    );

    this.wsConnections.set(sessionId, ws);

    return new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }));

        // Send text in chunks for natural pacing
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        for (const sentence of sentences) {
          ws.send(JSON.stringify({ text: sentence.trim() + " " }));
        }

        ws.send(JSON.stringify({ text: "" })); // Signal end
      });

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            onChunk(Buffer.from(msg.audio, "base64"));
          }
          if (msg.isFinal) {
            ws.close();
            resolve();
          }
        } catch {}
      });

      ws.on("error", reject);
      ws.on("close", () => {
        this.wsConnections.delete(sessionId);
        resolve();
      });
    });
  }

  // ─── Speech-to-Text ───

  async speechToText(audioBuffer: Buffer, language = "en"): Promise<STTResult> {
    switch (this.config.sttProvider) {
      case "whisper":
        return this.whisperSTT(audioBuffer, language);
      case "deepgram":
        return this.deepgramSTT(audioBuffer, language);
      default:
        return this.whisperSTT(audioBuffer, language);
    }
  }

  private async whisperSTT(audioBuffer: Buffer, language: string): Promise<STTResult> {
    const apiKey = this.config.sttApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key required for Whisper STT");

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }), "audio.wav");
    formData.append("model", "whisper-1");
    formData.append("language", language);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const data = (await response.json()) as { text: string };
    return { text: data.text, confidence: 0.95, language };
  }

  private async deepgramSTT(audioBuffer: Buffer, language: string): Promise<STTResult> {
    const apiKey = this.config.sttApiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("Deepgram API key required");

    const response = await fetch(
      `https://api.deepgram.com/v1/listen?language=${language}&model=nova-2`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/wav",
        },
        body: new Uint8Array(audioBuffer),
      }
    );

    const data = (await response.json()) as {
      results: { channels: Array<{ alternatives: Array<{ transcript: string; confidence: number }> }> };
    };

    const alt = data.results.channels[0]?.alternatives[0];
    return { text: alt?.transcript || "", confidence: alt?.confidence || 0, language };
  }

  // ─── Wake Word Detection ───

  enableWakeWord(): void {
    this.wakeWordActive = true;
    logger.info(`[AstraOS] Wake word detection enabled: "${this.config.wakeWord}"`);
  }

  disableWakeWord(): void {
    this.wakeWordActive = false;
  }

  checkWakeWord(transcript: string): boolean {
    if (!this.wakeWordActive) return false;
    return transcript.toLowerCase().includes(this.config.wakeWord!.toLowerCase());
  }

  // ─── Push-to-Talk ───

  startPushToTalk(sessionId: string): void {
    this.pushToTalkActive = true;
    logger.info(`[AstraOS] Push-to-talk started: ${sessionId}`);
  }

  stopPushToTalk(sessionId: string): void {
    this.pushToTalkActive = false;
    logger.info(`[AstraOS] Push-to-talk stopped: ${sessionId}`);
  }

  isPushToTalkActive(): boolean {
    return this.pushToTalkActive;
  }

  // ─── Available Voices ───

  async listVoices(): Promise<Array<{ voice_id: string; name: string; category: string }>> {
    if (!this.config.elevenLabsApiKey) return [];

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": this.config.elevenLabsApiKey! },
    });

    const data = (await response.json()) as {
      voices: Array<{ voice_id: string; name: string; category: string }>;
    };

    return data.voices;
  }

  // ─── Talk Mode: Real-time Bidirectional Voice Conversation ───

  /**
   * Start a Talk Mode session for real-time bidirectional voice conversation.
   * Creates a new TalkModeSession and sets it to "listening" state.
   */
  startTalkMode(sessionId: string, config?: TalkModeSessionConfig): TalkModeSession {
    if (this.talkModeSessions.has(sessionId)) {
      throw new Error(`Talk mode session "${sessionId}" already exists`);
    }

    const session: TalkModeSession = {
      sessionId,
      state: "listening",
      isActive: true,
      audioQueue: [],
      interruptible: config?.interruptible ?? true,
      vadSensitivity: config?.vadSensitivity ?? this.config.vadSensitivity ?? 0.3,
      silenceTimeout: config?.silenceTimeoutMs ?? this.config.silenceTimeoutMs ?? 1500,
      onTranscript: config?.onTranscript,
      onAudio: config?.onAudio,
      onStateChange: config?.onStateChange,
    };

    this.talkModeSessions.set(sessionId, session);
    this.talkModeAudioBuffers.set(sessionId, []);
    this.talkModeProcessingLocks.set(sessionId, false);

    this.setTalkModeState(sessionId, "listening");
    logger.info(`[AstraOS] Talk mode started: ${sessionId} (VAD=${session.vadSensitivity}, silence=${session.silenceTimeout}ms)`);

    return session;
  }

  /**
   * Process incoming audio in Talk Mode. This is the core real-time audio pipeline.
   *
   * - Runs simple VAD (Voice Activity Detection) using RMS energy on PCM data
   * - Accumulates audio chunks while speech is detected
   * - After silence exceeding silenceTimeout, processes accumulated audio via STT
   * - Fires onTranscript callback with the result
   * - Generates TTS response and streams audio chunks via onAudio callback
   * - Supports interruption mid-speech via interruptTalkMode()
   */
  async processTalkModeAudio(sessionId: string, audioChunk: Buffer): Promise<void> {
    const session = this.talkModeSessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Talk mode session "${sessionId}" not found or inactive`);
    }

    // Don't accept audio while processing or speaking (unless for interrupt detection)
    if (session.state === "processing") {
      return;
    }

    // If currently speaking, incoming audio with speech triggers an interrupt
    if (session.state === "speaking") {
      const isSpeech = this.detectVoiceActivity(audioChunk, session.vadSensitivity);
      if (isSpeech && session.interruptible) {
        await this.interruptTalkMode(sessionId);
        // After interrupt, fall through to accumulate this chunk in listening state
      } else {
        return;
      }
    }

    const audioBuffers = this.talkModeAudioBuffers.get(sessionId);
    if (!audioBuffers) return;

    const isSpeech = this.detectVoiceActivity(audioChunk, session.vadSensitivity);

    if (isSpeech) {
      // Speech detected: accumulate chunk and reset silence timer
      audioBuffers.push(audioChunk);
      this.resetSilenceTimer(sessionId);
    } else if (audioBuffers.length > 0) {
      // Silence detected but we have accumulated audio — start/reset the silence timer
      // The timer fires after silenceTimeout ms of consecutive silence
      this.startSilenceTimer(sessionId);
    }
  }

  /**
   * Interrupt an ongoing Talk Mode TTS playback.
   * Immediately stops audio output, clears the audio queue, and returns to listening.
   */
  async interruptTalkMode(sessionId: string): Promise<void> {
    const session = this.talkModeSessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Talk mode session "${sessionId}" not found or inactive`);
    }

    if (session.state !== "speaking") {
      logger.warn(`[AstraOS] Talk mode interrupt ignored: session "${sessionId}" is not speaking (state=${session.state})`);
      return;
    }

    if (!session.interruptible) {
      logger.warn(`[AstraOS] Talk mode interrupt ignored: session "${sessionId}" is not interruptible`);
      return;
    }

    logger.info(`[AstraOS] Talk mode interrupted: ${sessionId}`);

    // Close the streaming TTS WebSocket for this session to stop audio generation
    const ttsWsKey = `talkmode-tts-${sessionId}`;
    const ttsWs = this.wsConnections.get(ttsWsKey);
    if (ttsWs) {
      ttsWs.close();
      this.wsConnections.delete(ttsWsKey);
    }

    // Clear the audio queue
    session.audioQueue.length = 0;

    // Signal interrupted then return to listening
    this.setTalkModeState(sessionId, "interrupted");
    this.setTalkModeState(sessionId, "listening");
  }

  /**
   * Stop and clean up a Talk Mode session.
   */
  stopTalkMode(sessionId: string): void {
    const session = this.talkModeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Talk mode session "${sessionId}" not found`);
    }

    logger.info(`[AstraOS] Talk mode stopped: ${sessionId}`);

    session.isActive = false;

    // Clear silence timer
    this.clearSilenceTimer(sessionId);

    // Close any TTS WebSocket for this session
    const ttsWsKey = `talkmode-tts-${sessionId}`;
    const ttsWs = this.wsConnections.get(ttsWsKey);
    if (ttsWs) {
      ttsWs.close();
      this.wsConnections.delete(ttsWsKey);
    }

    // Clean up all maps
    this.talkModeSessions.delete(sessionId);
    this.talkModeAudioBuffers.delete(sessionId);
    this.talkModeProcessingLocks.delete(sessionId);
  }

  /**
   * Get the current state of a Talk Mode session.
   */
  getTalkModeState(sessionId: string): TalkModeState | null {
    const session = this.talkModeSessions.get(sessionId);
    return session?.state ?? null;
  }

  // ─── Talk Mode: Internal Helpers ───

  /**
   * Simple Voice Activity Detection (VAD) using RMS energy on PCM 16-bit LE data.
   * Returns true if the audio chunk's energy exceeds the sensitivity threshold.
   */
  private detectVoiceActivity(audioChunk: Buffer, vadSensitivity: number): boolean {
    if (audioChunk.length < 2) return false;

    // Treat the buffer as signed 16-bit little-endian PCM samples
    const sampleCount = Math.floor(audioChunk.length / 2);
    let sumSquares = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = audioChunk.readInt16LE(i * 2);
      // Normalize to -1.0 .. 1.0 range
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);

    // vadSensitivity is 0.0-1.0 where lower = more sensitive (detects quieter speech)
    // Map sensitivity to a threshold: 0.0 sensitivity -> 0.01 threshold (very sensitive)
    //                                 1.0 sensitivity -> 0.5 threshold (very insensitive)
    const threshold = 0.01 + vadSensitivity * 0.49;

    return rms > threshold;
  }

  /**
   * Set the talk mode session state and fire the onStateChange callback.
   */
  private setTalkModeState(sessionId: string, state: TalkModeState): void {
    const session = this.talkModeSessions.get(sessionId);
    if (!session) return;

    session.state = state;
    if (session.onStateChange) {
      session.onStateChange(sessionId, state);
    }
  }

  /**
   * Start the silence timer. When it expires, it processes the accumulated audio.
   */
  private startSilenceTimer(sessionId: string): void {
    // Don't start a new timer if one is already running
    if (this.talkModeSilenceTimers.has(sessionId)) return;

    const session = this.talkModeSessions.get(sessionId);
    if (!session) return;

    const timer = setTimeout(() => {
      this.talkModeSilenceTimers.delete(sessionId);
      void this.processAccumulatedAudio(sessionId);
    }, session.silenceTimeout);

    this.talkModeSilenceTimers.set(sessionId, timer);
  }

  /**
   * Reset (clear) the silence timer — called when new speech is detected.
   */
  private resetSilenceTimer(sessionId: string): void {
    this.clearSilenceTimer(sessionId);
  }

  /**
   * Clear the silence timer without triggering processing.
   */
  private clearSilenceTimer(sessionId: string): void {
    const timer = this.talkModeSilenceTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.talkModeSilenceTimers.delete(sessionId);
    }
  }

  /**
   * Process accumulated audio chunks: run STT, fire transcript callback,
   * generate TTS response, and stream audio chunks back.
   */
  private async processAccumulatedAudio(sessionId: string): Promise<void> {
    const session = this.talkModeSessions.get(sessionId);
    const audioBuffers = this.talkModeAudioBuffers.get(sessionId);

    if (!session || !session.isActive || !audioBuffers || audioBuffers.length === 0) {
      return;
    }

    // Prevent re-entrant processing
    if (this.talkModeProcessingLocks.get(sessionId)) return;
    this.talkModeProcessingLocks.set(sessionId, true);

    try {
      // Combine accumulated audio chunks into a single buffer
      const combinedAudio = Buffer.concat(audioBuffers);

      // Clear the accumulation buffer for the next utterance
      audioBuffers.length = 0;

      // ── Phase 1: Speech-to-Text ──
      this.setTalkModeState(sessionId, "processing");
      logger.info(`[AstraOS] Talk mode processing audio: ${sessionId} (${combinedAudio.length} bytes)`);

      const sttResult = await this.speechToText(combinedAudio);

      // Check if session was stopped during STT
      if (!session.isActive) return;

      // Skip empty transcripts
      if (!sttResult.text.trim()) {
        this.setTalkModeState(sessionId, "listening");
        return;
      }

      logger.info(`[AstraOS] Talk mode transcript: "${sttResult.text}" (confidence=${sttResult.confidence})`);

      // Fire the onTranscript callback — the consumer can use this to generate a response
      if (session.onTranscript) {
        session.onTranscript(sessionId, sttResult);
      }

      // ── Phase 2: Text-to-Speech response ──
      // The transcript callback is expected to populate session.audioQueue with a response text.
      // If audioQueue has content (as text stored in a single-element buffer), stream it.
      // Otherwise, we return to listening and let the consumer handle TTS externally.

      // Check if there's a response queued (consumer pushes text response as Buffer)
      if (session.audioQueue.length > 0) {
        this.setTalkModeState(sessionId, "speaking");

        const responseText = session.audioQueue.shift()!.toString("utf-8");
        session.audioQueue.length = 0; // Clear remaining queue

        // Stream TTS using the existing streamTTS method with a talk-mode-specific key
        const ttsWsKey = `talkmode-tts-${sessionId}`;

        try {
          await this.streamTTS(ttsWsKey, responseText, (audioChunk: Buffer) => {
            // Check for interruption before delivering each chunk
            if (!session.isActive || session.state !== "speaking") {
              return;
            }
            if (session.onAudio) {
              session.onAudio(sessionId, audioChunk);
            }
          });
        } catch (err) {
          // If the WS was closed due to interrupt, this is expected
          if (session.isActive && session.state === "speaking") {
            logger.error(`[AstraOS] Talk mode TTS error: ${sessionId}`, err);
          }
        }

        // After TTS completes (or was interrupted), return to listening if still active
        if (session.isActive && session.state === "speaking") {
          this.setTalkModeState(sessionId, "listening");
        }
      } else {
        // No response queued — return to listening
        if (session.isActive) {
          this.setTalkModeState(sessionId, "listening");
        }
      }
    } finally {
      this.talkModeProcessingLocks.set(sessionId, false);
    }
  }

  // ─── Lifecycle ───

  destroy(): void {
    // Clean up all talk mode sessions (collect keys first to avoid mutation during iteration)
    const talkModeSessionIds = [...this.talkModeSessions.keys()];
    for (const sessionId of talkModeSessionIds) {
      this.stopTalkMode(sessionId);
    }

    for (const ws of this.wsConnections.values()) {
      ws.close();
    }
    this.wsConnections.clear();
  }
}
