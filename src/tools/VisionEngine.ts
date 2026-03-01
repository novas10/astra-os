/**
 * AstraOS — Vision Engine
 * Structured computer vision: OCR extraction, UI element detection, document
 * analysis, chart interpretation, grid-based coordinate mapping.
 * Uses vision-capable LLMs with structured JSON output parsing for reliable results.
 */

import * as crypto from "crypto";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import { logger } from "../utils/logger";

// ─── Types ───

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedElement {
  type: "button" | "input" | "link" | "text" | "image" | "icon" | "checkbox" | "dropdown" | "menu" | "header" | "table" | "chart" | "other";
  label: string;
  content?: string;
  bbox: BoundingBox;
  confidence: number;
  interactable: boolean;
}

export interface OCRBlock {
  text: string;
  bbox: BoundingBox;
  confidence: number;
  blockType: "heading" | "paragraph" | "caption" | "label" | "code" | "data";
}

export interface DocumentStructure {
  title?: string;
  sections: Array<{ heading: string; content: string; level: number }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  lists: Array<{ type: "ordered" | "unordered"; items: string[] }>;
}

export interface ChartData {
  chartType: "bar" | "line" | "pie" | "scatter" | "area" | "other";
  title?: string;
  xAxis?: { label: string; values: string[] };
  yAxis?: { label: string };
  series: Array<{ name: string; dataPoints: Array<{ label: string; value: number }> }>;
  insights: string[];
}

export interface VisionResult {
  description: string;
  extractedText?: string;
  elements?: DetectedElement[];
  ocrBlocks?: OCRBlock[];
  document?: DocumentStructure;
  chart?: ChartData;
  analysisType: "general" | "ui" | "document" | "chart" | "screenshot";
  confidence: number;
}

// ─── Vision Engine ───

export class VisionEngine {
  private providers: ProviderRegistry;
  private cache: Map<string, { result: VisionResult; expires: number }> = new Map();

  constructor() {
    this.providers = ProviderRegistry.getInstance();
  }

  /**
   * Full structured image analysis — auto-detects content type and runs
   * the appropriate analysis pipeline (OCR, UI detection, chart, document).
   */
  async analyzeImage(imageBase64: string, prompt?: string, mimeType = "image/png"): Promise<VisionResult> {
    const cacheKey = crypto.createHash("md5").update(imageBase64.slice(0, 500) + (prompt || "")).digest("hex");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.result;

    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    // First pass: classify the image and get structured analysis
    const classificationPrompt = `Analyze this image and respond with ONLY valid JSON (no markdown, no backticks).

Determine what type of content this is and extract structured data accordingly.

JSON schema:
{
  "analysisType": "general" | "ui" | "document" | "chart",
  "description": "detailed description of what's in the image",
  "confidence": 0.0 to 1.0,
  "extractedText": "all visible text, preserving layout with newlines",
  "ocrBlocks": [
    {"text": "block text", "blockType": "heading|paragraph|caption|label|code|data", "confidence": 0.9, "position": {"row": 0-11, "col": 0-11, "spanRows": 1, "spanCols": 3}}
  ],
  "elements": [
    {"type": "button|input|link|text|image|icon|checkbox|dropdown|menu|header|table|chart|other", "label": "element text/label", "content": "value if input", "position": {"row": 0-11, "col": 0-11, "spanRows": 1, "spanCols": 2}, "confidence": 0.9, "interactable": true}
  ],
  "document": {
    "title": "document title if any",
    "sections": [{"heading": "...", "content": "...", "level": 1}],
    "tables": [{"headers": ["col1", "col2"], "rows": [["val1", "val2"]]}],
    "lists": [{"type": "ordered|unordered", "items": ["item1", "item2"]}]
  },
  "chart": {
    "chartType": "bar|line|pie|scatter|area|other",
    "title": "chart title",
    "xAxis": {"label": "X", "values": ["a", "b", "c"]},
    "yAxis": {"label": "Y"},
    "series": [{"name": "Series 1", "dataPoints": [{"label": "a", "value": 10}]}],
    "insights": ["trend description"]
  }
}

Only include "document", "chart", "elements", "ocrBlocks" if relevant to the image type.
Use the 12x12 grid system for positions (row 0-11, col 0-11).
${prompt ? `\nAdditional context: ${prompt}` : ""}`;

    try {
      const response = await provider.chat({
        model,
        system: "You are a computer vision analysis system. Always respond with valid JSON only. No markdown formatting.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
            { type: "text", text: classificationPrompt },
          ] as unknown as string,
        }],
        maxTokens: 4000,
      });

      const result = this.parseVisionResponse(response.text);

      this.cache.set(cacheKey, { result, expires: Date.now() + 300_000 });
      logger.info(`[Vision] Analysis complete: type=${result.analysisType}, elements=${result.elements?.length || 0}, confidence=${result.confidence}`);
      return result;
    } catch (err) {
      logger.error(`[Vision] Analysis failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Screenshot analysis for GUI automation — returns actionable element coordinates.
   * Used by ComputerUse tool to determine click targets.
   */
  async analyzeScreenshot(screenshotBase64: string, task: string, dimensions = { width: 1920, height: 1080 }): Promise<{
    description: string;
    elements: Array<{ type: string; label: string; x: number; y: number; width: number; height: number }>;
    suggestedAction?: { action: string; target: { x: number; y: number }; text?: string };
  }> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    // Use grid coordinate system for precise element localization
    const gridInfo = `The image is divided into a 12x12 grid. Use grid references (row 0-11, col 0-11) for element positions.`;

    const response = await provider.chat({
      model,
      system: `You are a GUI automation assistant. Analyze screenshots to identify interactive elements and suggest actions.
${gridInfo}
Respond with ONLY valid JSON (no markdown):
{
  "description": "what's on screen",
  "elements": [{"type": "button|input|link|text|menu|dropdown|checkbox|icon", "label": "visible text", "gridRow": 0-11, "gridCol": 0-11, "gridSpanRows": 1, "gridSpanCols": 1}],
  "suggestedAction": {"action": "click|type|scroll|hover|right_click", "targetRow": 0-11, "targetCol": 0-11, "text": "text to type if action is type"}
}`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } },
          { type: "text", text: `Task: ${task}\n\nIdentify all interactive elements and suggest the next action.` },
        ] as unknown as string,
      }],
      maxTokens: 3000,
    });

    try {
      const parsed = this.extractJSON(response.text);
      const { width, height } = dimensions;
      const cellW = width / 12;
      const cellH = height / 12;

      // Convert grid coordinates to pixel coordinates
      const elements = (parsed.elements || []).map((el: { type: string; label: string; gridRow: number; gridCol: number; gridSpanRows?: number; gridSpanCols?: number }) => ({
        type: el.type,
        label: el.label,
        x: Math.round(el.gridCol * cellW + cellW / 2),
        y: Math.round(el.gridRow * cellH + cellH / 2),
        width: Math.round((el.gridSpanCols || 1) * cellW),
        height: Math.round((el.gridSpanRows || 1) * cellH),
      }));

      let suggestedAction: { action: string; target: { x: number; y: number }; text?: string } | undefined;
      if (parsed.suggestedAction) {
        suggestedAction = {
          action: parsed.suggestedAction.action,
          target: {
            x: Math.round(parsed.suggestedAction.targetCol * cellW + cellW / 2),
            y: Math.round(parsed.suggestedAction.targetRow * cellH + cellH / 2),
          },
          text: parsed.suggestedAction.text,
        };
      }

      return { description: parsed.description || "", elements, suggestedAction };
    } catch {
      return { description: response.text, elements: [] };
    }
  }

  /**
   * Dedicated OCR extraction — optimized for text-heavy images.
   * Returns text blocks with positions and confidence scores.
   */
  async extractText(imageBase64: string, mimeType = "image/png"): Promise<{
    fullText: string;
    blocks: OCRBlock[];
    language?: string;
  }> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    const response = await provider.chat({
      model,
      system: `You are an OCR system. Extract ALL visible text from the image with precise positioning.
Respond with ONLY valid JSON:
{
  "fullText": "all text preserving layout",
  "blocks": [{"text": "block content", "blockType": "heading|paragraph|caption|label|code|data", "confidence": 0.95, "row": 0-11, "col": 0-11}],
  "language": "detected language"
}`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: "Extract all text from this image. Preserve formatting and layout." },
        ] as unknown as string,
      }],
      maxTokens: 4000,
    });

    try {
      const parsed = this.extractJSON(response.text);
      const blocks: OCRBlock[] = (parsed.blocks || []).map((b: { text: string; blockType: string; confidence: number; row: number; col: number }) => ({
        text: b.text,
        blockType: b.blockType || "paragraph",
        confidence: b.confidence || 0.8,
        bbox: { x: (b.col || 0) * 160, y: (b.row || 0) * 90, width: 160, height: 90 },
      }));
      return { fullText: parsed.fullText || "", blocks, language: parsed.language };
    } catch {
      return { fullText: response.text, blocks: [] };
    }
  }

  /**
   * Document structure analysis — extracts headings, sections, tables, lists
   * from documents, PDFs, or slides.
   */
  async analyzeDocument(imageBase64: string, mimeType = "image/png"): Promise<DocumentStructure> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    const response = await provider.chat({
      model,
      system: `You are a document analysis system. Extract the complete document structure.
Respond with ONLY valid JSON:
{
  "title": "document title",
  "sections": [{"heading": "section heading", "content": "section body text", "level": 1}],
  "tables": [{"headers": ["col1", "col2"], "rows": [["val1", "val2"]]}],
  "lists": [{"type": "ordered|unordered", "items": ["item1", "item2"]}]
}`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: "Analyze this document. Extract all sections, tables, and lists." },
        ] as unknown as string,
      }],
      maxTokens: 4000,
    });

    try {
      const parsed = this.extractJSON(response.text);
      return {
        title: parsed.title,
        sections: parsed.sections || [],
        tables: parsed.tables || [],
        lists: parsed.lists || [],
      };
    } catch {
      return { sections: [], tables: [], lists: [] };
    }
  }

  /**
   * Chart/graph data extraction — reads data points, axes, trends from charts.
   */
  async analyzeChart(imageBase64: string, mimeType = "image/png"): Promise<ChartData> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    const response = await provider.chat({
      model,
      system: `You are a chart analysis system. Extract data from charts and graphs.
Respond with ONLY valid JSON:
{
  "chartType": "bar|line|pie|scatter|area|other",
  "title": "chart title",
  "xAxis": {"label": "X axis label", "values": ["cat1", "cat2"]},
  "yAxis": {"label": "Y axis label"},
  "series": [{"name": "Series Name", "dataPoints": [{"label": "cat1", "value": 42.5}]}],
  "insights": ["The data shows an upward trend", "Peak value is at X"]
}
Extract actual numeric values from the chart as precisely as possible.`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: "Extract all data from this chart. Read values as precisely as possible." },
        ] as unknown as string,
      }],
      maxTokens: 3000,
    });

    try {
      const parsed = this.extractJSON(response.text);
      return {
        chartType: parsed.chartType || "other",
        title: parsed.title,
        xAxis: parsed.xAxis,
        yAxis: parsed.yAxis,
        series: parsed.series || [],
        insights: parsed.insights || [],
      };
    } catch {
      return { chartType: "other", series: [], insights: ["Failed to parse chart data"] };
    }
  }

  /**
   * Compare two images — visual diff detection.
   */
  async compareImages(imageA: string, imageB: string, mimeType = "image/png"): Promise<{
    similarity: number;
    differences: string[];
    changedRegions: Array<{ description: string; row: number; col: number }>;
  }> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);
    if (!provider) throw new Error("No vision-capable LLM provider available");

    const response = await provider.chat({
      model,
      system: `You compare two images and describe differences. Respond with ONLY valid JSON:
{
  "similarity": 0.0 to 1.0,
  "differences": ["description of each difference"],
  "changedRegions": [{"description": "what changed", "row": 0-11, "col": 0-11}]
}`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageA } },
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageB } },
          { type: "text", text: "Compare these two images. Identify all visual differences." },
        ] as unknown as string,
      }],
      maxTokens: 2000,
    });

    try {
      return this.extractJSON(response.text);
    } catch {
      return { similarity: 0, differences: ["Unable to compare"], changedRegions: [] };
    }
  }

  // ─── Internal Helpers ───

  private selectVisionModel(): string {
    const visionModels = ["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.0-flash"];
    for (const model of visionModels) {
      if (this.providers.getProviderForModel(model)) return model;
    }
    return process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";
  }

  private parseVisionResponse(text: string): VisionResult {
    const parsed = this.extractJSON(text);
    const width = 1920;
    const height = 1080;
    const cellW = width / 12;
    const cellH = height / 12;

    // Convert grid positions to pixel bounding boxes
    const elements: DetectedElement[] = (parsed.elements || []).map((el: { type: string; label: string; content?: string; position?: { row: number; col: number; spanRows?: number; spanCols?: number }; confidence?: number; interactable?: boolean }) => ({
      type: el.type || "other",
      label: el.label || "",
      content: el.content,
      bbox: el.position ? {
        x: Math.round(el.position.col * cellW),
        y: Math.round(el.position.row * cellH),
        width: Math.round((el.position.spanCols || 1) * cellW),
        height: Math.round((el.position.spanRows || 1) * cellH),
      } : { x: 0, y: 0, width: 0, height: 0 },
      confidence: el.confidence || 0.8,
      interactable: el.interactable ?? false,
    }));

    const ocrBlocks: OCRBlock[] = (parsed.ocrBlocks || []).map((b: { text: string; blockType: string; confidence: number; position?: { row: number; col: number; spanRows?: number; spanCols?: number } }) => ({
      text: b.text,
      blockType: b.blockType || "paragraph",
      confidence: b.confidence || 0.8,
      bbox: b.position ? {
        x: Math.round(b.position.col * cellW),
        y: Math.round(b.position.row * cellH),
        width: Math.round((b.position.spanCols || 3) * cellW),
        height: Math.round((b.position.spanRows || 1) * cellH),
      } : { x: 0, y: 0, width: 0, height: 0 },
    }));

    return {
      description: parsed.description || text,
      extractedText: parsed.extractedText,
      elements: elements.length > 0 ? elements : undefined,
      ocrBlocks: ocrBlocks.length > 0 ? ocrBlocks : undefined,
      document: parsed.document,
      chart: parsed.chart,
      analysisType: parsed.analysisType || "general",
      confidence: parsed.confidence || 0.7,
    };
  }

  /**
   * Extract JSON from LLM response, handling markdown code blocks and extra text.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractJSON(text: string): any {
    // Try direct parse
    try { return JSON.parse(text); } catch { /* continue */ }

    // Try extracting from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try { return JSON.parse(codeBlockMatch[1]); } catch { /* continue */ }
    }

    // Try finding JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
    }

    // Return a wrapper with the raw text
    return { description: text, analysisType: "general", confidence: 0.3 };
  }
}
