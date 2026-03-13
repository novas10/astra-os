/**
 * AstraOS — Embedding Provider
 * Real vector embeddings via OpenAI, Voyage AI, or Ollama local models.
 */

import { logger } from "../utils/logger";

export interface EmbeddingResult {
  vector: number[];
  dimensions: number;
}

export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}

// --- OpenAI Embeddings ---
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = "openai";
  dimensions = 1536;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model || "text-embedding-3-small";
    if (this.model === "text-embedding-3-small") this.dimensions = 1536;
    if (this.model === "text-embedding-3-large") this.dimensions = 3072;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => ({ vector: d.embedding, dimensions: d.embedding.length }));
  }
}

// --- Ollama Local Embeddings ---
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  name = "ollama";
  dimensions = 384;
  private baseUrl: string;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    this.model = model || "all-minilm";
    this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
    const data = (await res.json()) as { embedding: number[] };
    this.dimensions = data.embedding.length;
    return { vector: data.embedding, dimensions: data.embedding.length };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Ollama doesn't support batch, so we do sequential
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// --- Gemini Embeddings ---
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  name = "gemini";
  dimensions = 768;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
    this.model = model || "text-embedding-004";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dimensions,
      }),
    });

    if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status}`);
    const data = (await res.json()) as { embedding: { values: number[] } };
    return { vector: data.embedding.values, dimensions: data.embedding.values.length };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Gemini embedContent doesn't support native batch; use sequential calls
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// --- Mistral Embeddings ---
export class MistralEmbeddingProvider implements EmbeddingProvider {
  name = "mistral";
  dimensions = 1024;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.MISTRAL_API_KEY || "";
    this.model = model || "mistral-embed";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const res = await fetch("https://api.mistral.ai/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`Mistral embedding failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => ({ vector: d.embedding, dimensions: d.embedding.length }));
  }
}

// --- Voyage AI Embeddings ---
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  name = "voyage";
  dimensions = 1024;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.VOYAGE_API_KEY || "";
    this.model = model || "voyage-3";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`Voyage embedding failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => ({ vector: d.embedding, dimensions: d.embedding.length }));
  }
}

// --- Cohere Embeddings ---
export class CohereEmbeddingProvider implements EmbeddingProvider {
  name = "cohere";
  dimensions = 1024;
  private apiKey: string;
  private model: string;
  private inputType: string;

  constructor(apiKey?: string, model?: string, inputType?: string) {
    this.apiKey = apiKey || process.env.COHERE_API_KEY || "";
    this.model = model || "embed-v4.0";
    this.inputType = inputType || "search_document";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const res = await fetch("https://api.cohere.com/v2/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: this.inputType,
        embedding_types: ["float"],
      }),
    });

    if (!res.ok) throw new Error(`Cohere embedding failed: ${res.status}`);
    const data = (await res.json()) as {
      embeddings: { float: number[][] };
    };
    return data.embeddings.float.map((vec) => ({ vector: vec, dimensions: vec.length }));
  }

  /** Create a query-optimized instance for search queries */
  asQueryProvider(): CohereEmbeddingProvider {
    return new CohereEmbeddingProvider(this.apiKey, this.model, "search_query");
  }
}

// --- Provider Factory ---
export function createEmbeddingProvider(): EmbeddingProvider | null {
  if (process.env.OPENAI_API_KEY) {
    logger.info("[Memory] Using OpenAI embeddings (text-embedding-3-small)");
    return new OpenAIEmbeddingProvider();
  }
  if (process.env.GEMINI_API_KEY) {
    logger.info("[Memory] Using Gemini embeddings (text-embedding-004)");
    return new GeminiEmbeddingProvider();
  }
  if (process.env.COHERE_API_KEY) {
    logger.info("[Memory] Using Cohere embeddings (embed-v4.0)");
    return new CohereEmbeddingProvider();
  }
  if (process.env.MISTRAL_API_KEY) {
    logger.info("[Memory] Using Mistral embeddings (mistral-embed)");
    return new MistralEmbeddingProvider();
  }
  if (process.env.VOYAGE_API_KEY) {
    logger.info("[Memory] Using Voyage AI embeddings (voyage-3)");
    return new VoyageEmbeddingProvider();
  }
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_EMBEDDING_MODEL) {
    logger.info("[Memory] Using Ollama local embeddings");
    return new OllamaEmbeddingProvider(process.env.OLLAMA_EMBEDDING_MODEL);
  }
  logger.warn("[Memory] No embedding provider configured, vector search disabled");
  return null;
}

// --- Cosine Similarity ---
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
