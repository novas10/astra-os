/**
 * AstraOS — Vision Engine
 * Multi-modal image analysis using vision-capable LLMs.
 * OCR, document understanding, chart interpretation.
 */

import { ProviderRegistry } from "../llm/ProviderRegistry";
import { logger } from "../utils/logger";

export interface VisionResult {
  description: string;
  extractedText?: string;
  elements?: Array<{ type: string; content: string; bbox?: [number, number, number, number] }>;
}

export class VisionEngine {
  private providers: ProviderRegistry;

  constructor() {
    this.providers = ProviderRegistry.getInstance();
  }

  async analyzeImage(imageBase64: string, prompt?: string, mimeType = "image/png"): Promise<VisionResult> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);

    if (!provider) {
      throw new Error("No vision-capable LLM provider available");
    }

    const systemPrompt = `You are a vision analysis assistant. Analyze the provided image and respond with structured information.
If asked to extract text (OCR), provide the text content.
If analyzing a chart/graph, describe the data and trends.
If analyzing a UI, describe the layout, buttons, inputs, and interactive elements with their approximate positions.`;

    const userPrompt = prompt || "Describe this image in detail. Extract any visible text. If it's a UI, describe all interactive elements and their positions.";

    try {
      const response = await provider.chat({
        model,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
              { type: "text", text: userPrompt },
            ] as unknown as string,
          },
        ],
        maxTokens: 2000,
      });

      return {
        description: response.text,
        extractedText: this.extractOCRText(response.text),
      };
    } catch (err) {
      logger.error(`[Vision] Analysis failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async analyzeScreenshot(screenshotBase64: string, task: string): Promise<{
    description: string;
    elements: Array<{ type: string; label: string; x: number; y: number }>;
    suggestedAction?: { action: string; target: { x: number; y: number }; text?: string };
  }> {
    const model = this.selectVisionModel();
    const provider = this.providers.getProviderForModel(model);

    if (!provider) throw new Error("No vision-capable LLM provider available");

    const response = await provider.chat({
      model,
      system: `You are a GUI automation assistant. Analyze the screenshot and identify UI elements.
Respond in JSON format with:
{
  "description": "what you see on screen",
  "elements": [{"type": "button|input|link|text", "label": "text on element", "x": center_x, "y": center_y}],
  "suggestedAction": {"action": "click|type|scroll", "target": {"x": x, "y": y}, "text": "optional text to type"}
}`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } },
            { type: "text", text: `Task: ${task}\n\nAnalyze this screenshot and suggest the next action to complete the task.` },
          ] as unknown as string,
        },
      ],
      maxTokens: 2000,
    });

    try {
      const parsed = JSON.parse(response.text);
      return parsed;
    } catch {
      return { description: response.text, elements: [] };
    }
  }

  private selectVisionModel(): string {
    // Prefer models with vision capability
    const visionModels = ["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.0-flash"];
    for (const model of visionModels) {
      if (this.providers.getProviderForModel(model)) return model;
    }
    return process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";
  }

  private extractOCRText(text: string): string | undefined {
    // Simple extraction of text content from the response
    const lines = text.split("\n");
    const textLines = lines.filter((l) => !l.startsWith("#") && !l.startsWith("-") && l.trim().length > 0);
    return textLines.length > 0 ? textLines.join("\n") : undefined;
  }
}
