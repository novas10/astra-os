/**
 * AstraOS — ReasoningEngine.ts
 * Advanced reasoning engine: Chain-of-Thought, Tree-of-Thought,
 * Self-Consistency, Reflection, and Metacognition.
 * Goes beyond basic ReAct patterns with structured reasoning traces.
 */

import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import type { LLMMessage, LLMResponse } from "../llm/LLMProvider";

// ─── Types ───

export interface ReasoningStep {
  stepId: string;
  description: string;
  content: string;
  confidence: number; // 0.0 – 1.0
  durationMs: number;
  tokens: { input: number; output: number };
}

export interface ThoughtNode {
  id: string;
  parentId: string | null;
  depth: number;
  thought: string;
  evaluation: number; // Score 0.0 – 1.0
  children: ThoughtNode[];
  isTerminal: boolean;
  tokens: { input: number; output: number };
}

export interface ConfidenceAssessment {
  overallConfidence: number; // 0.0 – 1.0
  category: "high" | "medium" | "low" | "uncertain";
  strengths: string[];
  weaknesses: string[];
  suggestedActions: string[];
  needsHumanReview: boolean;
  reasoning: string;
  tokens: { input: number; output: number };
}

export interface ReasoningResult {
  resultId: string;
  method: "chain-of-thought" | "tree-of-thought" | "self-consistency" | "reflection";
  problem: string;
  steps: ReasoningStep[];
  finalAnswer: string;
  confidence: number;
  totalDurationMs: number;
  totalTokens: { input: number; output: number };
  metadata?: Record<string, unknown>;
}

export interface ReasoningEngineConfig {
  defaultModel: string;
  maxTokensPerCall: number;
  temperature: number;
  /** For self-consistency: how many independent chains to generate */
  defaultSamples: number;
  /** For tree-of-thought: default branching factor */
  defaultBreadth: number;
  /** For tree-of-thought: default max depth */
  defaultDepth: number;
  /** Maximum total tokens for a single reasoning session */
  maxTotalTokens: number;
}

// ─── Engine ───

const DEFAULT_CONFIG: ReasoningEngineConfig = {
  defaultModel: "claude-sonnet-4-20250514",
  maxTokensPerCall: 4096,
  temperature: 0.7,
  defaultSamples: 5,
  defaultBreadth: 3,
  defaultDepth: 3,
  maxTotalTokens: 200_000,
};

export class ReasoningEngine {
  private config: ReasoningEngineConfig;
  private registry: ProviderRegistry;

  constructor(config?: Partial<ReasoningEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = ProviderRegistry.getInstance();
  }

  // ─── 1. Chain-of-Thought ───
  // Step-by-step explicit reasoning, each step builds on the previous.

  async chainOfThought(problem: string, model?: string): Promise<ReasoningResult> {
    const resultId = `reason_${uuid().slice(0, 10)}`;
    const resolvedModel = model ?? this.config.defaultModel;
    const startedAt = Date.now();
    const steps: ReasoningStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[ReasoningEngine] Chain-of-Thought started: ${resultId}`);

    // Step 1: Break down the problem
    const decomposition = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\n` +
          `Break this problem down into clear sequential reasoning steps. ` +
          `For each step, explain what needs to be figured out and why. ` +
          `Format each step on its own line as "Step N: <description>".`,
      },
    ], "You are a systematic reasoner. Think step by step with extreme clarity.");

    steps.push(this.makeStep("decomposition", "Problem decomposition", decomposition));
    totalTokens.input += decomposition.usage.input;
    totalTokens.output += decomposition.usage.output;

    // Step 2: Execute each reasoning step
    const stepLines = decomposition.text.split("\n").filter((l) => /^step\s+\d/i.test(l.trim()));
    let accumulatedReasoning = `Problem: ${problem}\n\nDecomposition:\n${decomposition.text}\n\n`;

    for (let i = 0; i < stepLines.length; i++) {
      const stepDesc = stepLines[i];
      const stepResponse = await this.llmCall(resolvedModel, [
        {
          role: "user",
          content:
            `${accumulatedReasoning}\n\nNow execute this step:\n${stepDesc}\n\n` +
            `Show your detailed reasoning for this specific step. Be thorough.`,
        },
      ], "You are executing one step of a reasoning chain. Be precise and show your work.");

      accumulatedReasoning += `\n${stepDesc}\nReasoning: ${stepResponse.text}\n`;
      steps.push(this.makeStep(`step_${i + 1}`, stepDesc, stepResponse));
      totalTokens.input += stepResponse.usage.input;
      totalTokens.output += stepResponse.usage.output;
    }

    // Step 3: Synthesize final answer
    const synthesis = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `${accumulatedReasoning}\n\n` +
          `Based on all the reasoning above, provide the final answer to the original problem. ` +
          `Be definitive and concise.`,
      },
    ], "You are synthesizing a final answer from a chain of reasoning. Be clear and definitive.");

    steps.push(this.makeStep("synthesis", "Final synthesis", synthesis));
    totalTokens.input += synthesis.usage.input;
    totalTokens.output += synthesis.usage.output;

    const confidence = await this.quickConfidence(resolvedModel, problem, synthesis.text, totalTokens);

    return {
      resultId,
      method: "chain-of-thought",
      problem,
      steps,
      finalAnswer: synthesis.text,
      confidence,
      totalDurationMs: Date.now() - startedAt,
      totalTokens,
    };
  }

  // ─── 2. Tree-of-Thought ───
  // Explore multiple reasoning paths, evaluate and prune, pick the best.

  async treeOfThought(
    problem: string,
    breadth?: number,
    depth?: number,
    model?: string,
  ): Promise<ReasoningResult> {
    const resultId = `reason_${uuid().slice(0, 10)}`;
    const resolvedModel = model ?? this.config.defaultModel;
    const b = breadth ?? this.config.defaultBreadth;
    const d = depth ?? this.config.defaultDepth;
    const startedAt = Date.now();
    const steps: ReasoningStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[ReasoningEngine] Tree-of-Thought started: ${resultId} — breadth=${b}, depth=${d}`);

    // Build the tree
    const root: ThoughtNode = {
      id: `node_root`,
      parentId: null,
      depth: 0,
      thought: problem,
      evaluation: 1.0,
      children: [],
      isTerminal: false,
      tokens: { input: 0, output: 0 },
    };

    await this.expandNode(resolvedModel, root, problem, b, d, 0, totalTokens, steps);

    // Find the best terminal path
    const bestPath = this.findBestPath(root);
    const pathDescription = bestPath.map((n) => n.thought).join("\n→ ");

    // Synthesize along best path
    const synthesis = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\n` +
          `Best reasoning path through the thought tree:\n${pathDescription}\n\n` +
          `Based on this reasoning path, provide the definitive final answer.`,
      },
    ], "You are synthesizing an answer from the best path through a tree of thought.");

    steps.push(this.makeStep("synthesis", "Tree synthesis", synthesis));
    totalTokens.input += synthesis.usage.input;
    totalTokens.output += synthesis.usage.output;

    const confidence = bestPath.length > 0
      ? bestPath.reduce((sum, n) => sum + n.evaluation, 0) / bestPath.length
      : 0.5;

    return {
      resultId,
      method: "tree-of-thought",
      problem,
      steps,
      finalAnswer: synthesis.text,
      confidence,
      totalDurationMs: Date.now() - startedAt,
      totalTokens,
      metadata: { breadth: b, depth: d, totalNodes: this.countNodes(root) },
    };
  }

  private async expandNode(
    model: string,
    node: ThoughtNode,
    problem: string,
    breadth: number,
    maxDepth: number,
    currentDepth: number,
    totalTokens: { input: number; output: number },
    steps: ReasoningStep[],
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      node.isTerminal = true;
      return;
    }

    // Guard against token budget exhaustion
    if (totalTokens.input + totalTokens.output > this.config.maxTotalTokens) {
      node.isTerminal = true;
      return;
    }

    // Generate candidate thoughts
    const genResponse = await this.llmCall(model, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\n` +
          `Current reasoning so far: ${node.thought}\n\n` +
          `Generate exactly ${breadth} different next reasoning steps. ` +
          `Each should explore a DIFFERENT approach or angle. ` +
          `Format: one per line, prefixed with "Thought N: "`,
      },
    ], "You are generating diverse reasoning branches for a tree-of-thought search.");

    totalTokens.input += genResponse.usage.input;
    totalTokens.output += genResponse.usage.output;
    steps.push(this.makeStep(`expand_d${currentDepth}`, `Expand at depth ${currentDepth}`, genResponse));

    const thoughtLines = genResponse.text
      .split("\n")
      .filter((l) => /^thought\s+\d/i.test(l.trim()))
      .slice(0, breadth);

    // Evaluate each thought
    const evaluationPrompt =
      `Problem: ${problem}\n\nEvaluate each of these reasoning steps on a scale of 0.0 to 1.0:\n` +
      thoughtLines.map((t, i) => `${i + 1}. ${t}`).join("\n") +
      `\n\nFor each, respond with "Score N: <number>" where N matches the step number.`;

    const evalResponse = await this.llmCall(model, [
      { role: "user", content: evaluationPrompt },
    ], "You are evaluating reasoning quality. Be critical but fair.");

    totalTokens.input += evalResponse.usage.input;
    totalTokens.output += evalResponse.usage.output;

    const scores = this.parseScores(evalResponse.text, thoughtLines.length);

    // Create child nodes
    for (let i = 0; i < thoughtLines.length; i++) {
      const child: ThoughtNode = {
        id: `node_d${currentDepth + 1}_${i}`,
        parentId: node.id,
        depth: currentDepth + 1,
        thought: thoughtLines[i],
        evaluation: scores[i] ?? 0.5,
        children: [],
        isTerminal: false,
        tokens: { input: 0, output: 0 },
      };
      node.children.push(child);
    }

    // Only expand the top-scoring children (prune low scores)
    const sortedChildren = [...node.children].sort((a, b) => b.evaluation - a.evaluation);
    const toExpand = sortedChildren.slice(0, Math.max(1, Math.ceil(breadth / 2)));

    for (const child of toExpand) {
      await this.expandNode(model, child, problem, breadth, maxDepth, currentDepth + 1, totalTokens, steps);
    }

    // Mark unexpanded as terminal
    for (const child of node.children) {
      if (!toExpand.includes(child)) {
        child.isTerminal = true;
      }
    }
  }

  private findBestPath(root: ThoughtNode): ThoughtNode[] {
    if (root.isTerminal || root.children.length === 0) return [root];
    const bestChild = root.children.reduce((best, c) =>
      c.evaluation > best.evaluation ? c : best
    );
    return [root, ...this.findBestPath(bestChild)];
  }

  private countNodes(node: ThoughtNode): number {
    return 1 + node.children.reduce((sum, c) => sum + this.countNodes(c), 0);
  }

  private parseScores(text: string, count: number): number[] {
    const scores: number[] = [];
    for (let i = 1; i <= count; i++) {
      const match = text.match(new RegExp(`score\\s+${i}\\s*:\\s*([\\d.]+)`, "i"));
      scores.push(match ? Math.min(1, Math.max(0, parseFloat(match[1]))) : 0.5);
    }
    return scores;
  }

  // ─── 3. Self-Consistency ───
  // Generate N independent reasoning chains, extract answers, majority-vote.

  async selfConsistency(problem: string, samples?: number, model?: string): Promise<ReasoningResult> {
    const resultId = `reason_${uuid().slice(0, 10)}`;
    const resolvedModel = model ?? this.config.defaultModel;
    const n = samples ?? this.config.defaultSamples;
    const startedAt = Date.now();
    const steps: ReasoningStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[ReasoningEngine] Self-Consistency started: ${resultId} — ${n} samples`);

    // Generate N independent reasoning chains in parallel
    const chainPromises = Array.from({ length: n }, (_, i) =>
      this.llmCall(resolvedModel, [
        {
          role: "user",
          content:
            `Problem: ${problem}\n\n` +
            `Think through this step by step, then give your final answer on a line starting with "ANSWER: ".`,
        },
      ], `You are reasoning chain ${i + 1}. Think independently and carefully.`)
    );

    const chainResponses = await Promise.all(chainPromises);
    const answers: string[] = [];

    for (let i = 0; i < chainResponses.length; i++) {
      const resp = chainResponses[i];
      totalTokens.input += resp.usage.input;
      totalTokens.output += resp.usage.output;
      steps.push(this.makeStep(`chain_${i + 1}`, `Reasoning chain ${i + 1}`, resp));

      // Extract answer
      const answerMatch = resp.text.match(/ANSWER:\s*(.+)/i);
      answers.push(answerMatch ? answerMatch[1].trim() : resp.text.slice(-200).trim());
    }

    // Vote: use LLM to cluster and pick majority
    const votePrompt =
      `Problem: ${problem}\n\n` +
      `${n} independent reasoning chains produced these answers:\n` +
      answers.map((a, i) => `Chain ${i + 1}: ${a}`).join("\n") +
      `\n\nGroup similar answers together. Which answer appears most often (or is most consistent)? ` +
      `Provide the consensus answer and explain which chains agreed. ` +
      `Start your final answer with "CONSENSUS: "`;

    const voteResponse = await this.llmCall(resolvedModel, [
      { role: "user", content: votePrompt },
    ], "You are aggregating multiple reasoning chains via majority vote.");

    totalTokens.input += voteResponse.usage.input;
    totalTokens.output += voteResponse.usage.output;
    steps.push(this.makeStep("voting", "Majority vote aggregation", voteResponse));

    const consensusMatch = voteResponse.text.match(/CONSENSUS:\s*(.+)/is);
    const finalAnswer = consensusMatch ? consensusMatch[1].trim() : voteResponse.text;

    // Confidence based on agreement level
    const confidence = await this.quickConfidence(resolvedModel, problem, finalAnswer, totalTokens);

    return {
      resultId,
      method: "self-consistency",
      problem,
      steps,
      finalAnswer,
      confidence,
      totalDurationMs: Date.now() - startedAt,
      totalTokens,
      metadata: { samples: n, answers },
    };
  }

  // ─── 4. Reflection ───
  // Agent reviews its own response, identifies errors, and corrects them.

  async reflect(initialResponse: string, problem: string, model?: string): Promise<ReasoningResult> {
    const resultId = `reason_${uuid().slice(0, 10)}`;
    const resolvedModel = model ?? this.config.defaultModel;
    const startedAt = Date.now();
    const steps: ReasoningStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[ReasoningEngine] Reflection started: ${resultId}`);

    // Record initial response
    steps.push({
      stepId: `step_initial`,
      description: "Initial response",
      content: initialResponse,
      confidence: 0.5,
      durationMs: 0,
      tokens: { input: 0, output: 0 },
    });

    // Step 1: Critique
    const critiqueResponse = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\nProposed answer:\n${initialResponse}\n\n` +
          `Critically analyze this answer. Look for:\n` +
          `1. Logical errors or fallacies\n` +
          `2. Missing considerations\n` +
          `3. Incorrect facts or assumptions\n` +
          `4. Gaps in reasoning\n` +
          `5. Alternative interpretations\n\n` +
          `Be thorough and critical. List every issue found.`,
      },
    ], "You are a rigorous critic. Find every flaw, no matter how small.");

    steps.push(this.makeStep("critique", "Self-critique", critiqueResponse));
    totalTokens.input += critiqueResponse.usage.input;
    totalTokens.output += critiqueResponse.usage.output;

    // Step 2: Revision
    const revisionResponse = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\n` +
          `Original answer:\n${initialResponse}\n\n` +
          `Critique:\n${critiqueResponse.text}\n\n` +
          `Now provide a corrected and improved answer that addresses ALL the issues identified in the critique. ` +
          `If the original answer was correct, explain why the critique does not apply and reaffirm the answer.`,
      },
    ], "You are revising an answer based on critical feedback. Be thorough and precise.");

    steps.push(this.makeStep("revision", "Revised answer", revisionResponse));
    totalTokens.input += revisionResponse.usage.input;
    totalTokens.output += revisionResponse.usage.output;

    // Step 3: Verification
    const verifyResponse = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `Problem: ${problem}\n\n` +
          `Revised answer:\n${revisionResponse.text}\n\n` +
          `Verify this answer is correct. Check for any remaining issues. ` +
          `Rate your confidence from 0.0 to 1.0. ` +
          `Format: "CONFIDENCE: <number>\nVERDICT: <your assessment>"`,
      },
    ], "You are performing final verification. Be honest about confidence.");

    steps.push(this.makeStep("verification", "Final verification", verifyResponse));
    totalTokens.input += verifyResponse.usage.input;
    totalTokens.output += verifyResponse.usage.output;

    const confMatch = verifyResponse.text.match(/CONFIDENCE:\s*([\d.]+)/i);
    const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.6;

    return {
      resultId,
      method: "reflection",
      problem,
      steps,
      finalAnswer: revisionResponse.text,
      confidence,
      totalDurationMs: Date.now() - startedAt,
      totalTokens,
    };
  }

  // ─── 5. Metacognition ───
  // Assess confidence, identify knowledge gaps, decide if human help is needed.

  async assessConfidence(response: string, problem?: string): Promise<ConfidenceAssessment> {
    const resolvedModel = this.config.defaultModel;

    logger.info(`[ReasoningEngine] Confidence assessment started`);

    const assessResponse = await this.llmCall(resolvedModel, [
      {
        role: "user",
        content:
          `${problem ? `Question: ${problem}\n\n` : ""}Response to assess:\n${response}\n\n` +
          `Perform a metacognitive assessment. Evaluate:\n` +
          `1. How confident should we be in this response? (0.0 to 1.0)\n` +
          `2. What are the strengths of this response?\n` +
          `3. What are the weaknesses or gaps?\n` +
          `4. What actions could improve confidence?\n` +
          `5. Does this need human review?\n\n` +
          `Respond in this exact JSON format:\n` +
          `{\n` +
          `  "confidence": <number>,\n` +
          `  "category": "<high|medium|low|uncertain>",\n` +
          `  "strengths": ["..."],\n` +
          `  "weaknesses": ["..."],\n` +
          `  "suggestedActions": ["..."],\n` +
          `  "needsHumanReview": <boolean>,\n` +
          `  "reasoning": "<explanation>"\n` +
          `}\nOnly output valid JSON.`,
      },
    ], "You are a metacognitive assessor. Be honest and calibrated about uncertainty.");

    try {
      const jsonMatch = assessResponse.text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

      return {
        overallConfidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        category: parsed.category ?? "medium",
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
        needsHumanReview: parsed.needsHumanReview ?? false,
        reasoning: parsed.reasoning ?? "",
        tokens: { input: assessResponse.usage.input, output: assessResponse.usage.output },
      };
    } catch {
      return {
        overallConfidence: 0.5,
        category: "uncertain",
        strengths: [],
        weaknesses: ["Failed to parse metacognitive assessment"],
        suggestedActions: ["Retry assessment", "Request human review"],
        needsHumanReview: true,
        reasoning: assessResponse.text,
        tokens: { input: assessResponse.usage.input, output: assessResponse.usage.output },
      };
    }
  }

  // ─── Helpers ───

  private async llmCall(
    model: string,
    messages: LLMMessage[],
    system: string,
  ): Promise<LLMResponse> {
    const provider = this.registry.getProviderForModel(model);
    return provider.chat({
      model,
      system,
      messages,
      maxTokens: this.config.maxTokensPerCall,
    });
  }

  private makeStep(id: string, description: string, response: LLMResponse): ReasoningStep {
    return {
      stepId: `step_${id}`,
      description,
      content: response.text,
      confidence: 0.5, // Updated later by assessment
      durationMs: 0, // Individual timing not tracked at this level
      tokens: { input: response.usage.input, output: response.usage.output },
    };
  }

  private async quickConfidence(
    model: string,
    problem: string,
    answer: string,
    totalTokens: { input: number; output: number },
  ): Promise<number> {
    try {
      const resp = await this.llmCall(model, [
        {
          role: "user",
          content:
            `Problem: ${problem}\nAnswer: ${answer}\n\n` +
            `Rate confidence in this answer from 0.0 to 1.0. Reply with ONLY the number.`,
        },
      ], "Rate confidence. Reply with only a decimal number.");
      totalTokens.input += resp.usage.input;
      totalTokens.output += resp.usage.output;
      const parsed = parseFloat(resp.text.trim());
      return isNaN(parsed) ? 0.5 : Math.min(1, Math.max(0, parsed));
    } catch {
      return 0.5;
    }
  }
}
