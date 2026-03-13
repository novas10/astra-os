/**
 * AstraOS — AgentOrchestrator.ts
 * True multi-agent collaboration engine with six orchestration patterns.
 * Goes far beyond single-agent routing: sequential pipelines, parallel fan-out,
 * supervisor-worker, debate, consensus, and hierarchical delegation.
 */

import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import type { LLMMessage } from "../llm/LLMProvider";

// ─── Types ───

export interface AgentOrchestrationConfig {
  /** Maximum time (ms) for any single agent call */
  agentTimeoutMs: number;
  /** Maximum time (ms) for entire orchestration */
  orchestrationTimeoutMs: number;
  /** Maximum total tokens across all agents */
  maxTotalTokens: number;
  /** Whether to record full execution traces */
  traceEnabled: boolean;
  /** Default model to use if agent doesn't specify one */
  defaultModel: string;
  /** Maximum retry attempts per agent call */
  maxRetries: number;
  /** System prompts keyed by agent name */
  agentSystemPrompts: Record<string, string>;
}

export interface OrchestrationStep {
  stepId: string;
  agentName: string;
  model: string;
  input: string;
  output: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  tokens: { input: number; output: number };
  status: "success" | "failure" | "timeout" | "skipped";
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface OrchestrationResult {
  orchestrationId: string;
  pattern: "pipeline" | "parallel" | "supervisor" | "debate" | "consensus" | "hierarchical";
  finalOutput: string;
  steps: OrchestrationStep[];
  totalDurationMs: number;
  totalTokens: { input: number; output: number };
  agentCount: number;
  startedAt: number;
  completedAt: number;
  status: "completed" | "failed" | "partial";
  metadata?: Record<string, unknown>;
}

export interface HierarchyNode {
  agent: string;
  role: "manager" | "lead" | "worker";
  children: HierarchyNode[];
}

// ─── Orchestrator ───

const DEFAULT_CONFIG: AgentOrchestrationConfig = {
  agentTimeoutMs: 60_000,
  orchestrationTimeoutMs: 300_000,
  maxTotalTokens: 500_000,
  traceEnabled: true,
  defaultModel: "claude-sonnet-4-20250514",
  maxRetries: 2,
  agentSystemPrompts: {},
};

export class AgentOrchestrator extends EventEmitter {
  private config: AgentOrchestrationConfig;
  private registry: ProviderRegistry;
  private runningOrchestrations: Map<string, { abort: AbortController }> = new Map();

  constructor(config?: Partial<AgentOrchestrationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = ProviderRegistry.getInstance();
  }

  // ─── Pattern 1: Sequential Pipeline ───
  // Agent A output feeds into Agent B, which feeds into Agent C, etc.

  async runPipeline(agents: string[], input: string): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const steps: OrchestrationStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Pipeline started: ${orchestrationId} — ${agents.length} agents`);
    this.emit("orchestration:start", { orchestrationId, pattern: "pipeline", agents });

    let currentInput = input;
    let status: OrchestrationResult["status"] = "completed";

    for (const agent of agents) {
      const step = await this.callAgent(agent, currentInput, {
        orchestrationId,
        pattern: "pipeline",
        pipelinePosition: steps.length,
      });
      steps.push(step);
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;

      if (step.status === "failure" || step.status === "timeout") {
        status = "failed";
        logger.error(`[Orchestrator] Pipeline failed at agent "${agent}": ${step.error}`);
        break;
      }

      currentInput = step.output;
      this.emit("orchestration:step", { orchestrationId, step });
    }

    const result = this.buildResult(orchestrationId, "pipeline", currentInput, steps, totalTokens, startedAt, status);
    this.emit("orchestration:complete", result);
    return result;
  }

  // ─── Pattern 2: Parallel Fan-Out ───
  // Send the same input to all agents simultaneously, collect all results.

  async runParallel(agents: string[], input: string): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Parallel fan-out started: ${orchestrationId} — ${agents.length} agents`);
    this.emit("orchestration:start", { orchestrationId, pattern: "parallel", agents });

    const stepPromises = agents.map((agent) =>
      this.callAgent(agent, input, { orchestrationId, pattern: "parallel" })
    );

    const steps = await Promise.all(stepPromises);
    const outputs: string[] = [];

    for (const step of steps) {
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;
      if (step.status === "success") {
        outputs.push(step.output);
      }
      this.emit("orchestration:step", { orchestrationId, step });
    }

    const hasFailures = steps.some((s) => s.status !== "success");
    const allFailed = steps.every((s) => s.status !== "success");
    const status: OrchestrationResult["status"] = allFailed ? "failed" : hasFailures ? "partial" : "completed";

    const mergedOutput = outputs
      .map((o, i) => `[${agents[i]}]\n${o}`)
      .join("\n\n---\n\n");

    const result = this.buildResult(orchestrationId, "parallel", mergedOutput, steps, totalTokens, startedAt, status);
    this.emit("orchestration:complete", result);
    return result;
  }

  // ─── Pattern 3: Supervisor ───
  // A supervisor agent decides how to decompose the task, delegates to workers,
  // then synthesizes the final answer.

  async runSupervisor(supervisor: string, workers: string[], task: string): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const steps: OrchestrationStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Supervisor started: ${orchestrationId} — supervisor="${supervisor}", ${workers.length} workers`);
    this.emit("orchestration:start", { orchestrationId, pattern: "supervisor", agents: [supervisor, ...workers] });

    // Step 1: Supervisor decomposes the task
    const decompositionPrompt =
      `You are a supervisor agent. You have ${workers.length} worker agents available: ${workers.join(", ")}.\n\n` +
      `Task: ${task}\n\n` +
      `Decompose this task into subtasks, one per worker. Respond with a JSON array of objects:\n` +
      `[{"worker": "<worker_name>", "subtask": "<subtask_description>"}]\n` +
      `Only output valid JSON. Use exactly the worker names listed above.`;

    const decompStep = await this.callAgent(supervisor, decompositionPrompt, {
      orchestrationId, pattern: "supervisor", role: "decomposition",
    });
    steps.push(decompStep);
    totalTokens.input += decompStep.tokens.input;
    totalTokens.output += decompStep.tokens.output;

    if (decompStep.status !== "success") {
      return this.buildResult(orchestrationId, "supervisor", "", steps, totalTokens, startedAt, "failed");
    }

    // Parse decomposition
    let assignments: Array<{ worker: string; subtask: string }>;
    try {
      const jsonMatch = decompStep.output.match(/\[[\s\S]*\]/);
      assignments = JSON.parse(jsonMatch?.[0] ?? "[]");
    } catch {
      // Fallback: give entire task to all workers
      assignments = workers.map((w) => ({ worker: w, subtask: task }));
    }

    // Step 2: Workers execute in parallel
    const workerPromises = assignments.map((a) =>
      this.callAgent(a.worker, a.subtask, {
        orchestrationId, pattern: "supervisor", role: "worker", assignedBy: supervisor,
      })
    );

    const workerSteps = await Promise.all(workerPromises);
    for (const step of workerSteps) {
      steps.push(step);
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;
      this.emit("orchestration:step", { orchestrationId, step });
    }

    // Step 3: Supervisor synthesizes results
    const workerResults = workerSteps
      .map((s, i) => `[Worker: ${assignments[i]?.worker ?? "unknown"}]\nSubtask: ${assignments[i]?.subtask ?? ""}\nResult: ${s.output}`)
      .join("\n\n");

    const synthesisPrompt =
      `You are a supervisor agent. Your workers have completed their subtasks.\n\n` +
      `Original task: ${task}\n\nWorker results:\n${workerResults}\n\n` +
      `Synthesize a comprehensive final answer from the worker results.`;

    const synthStep = await this.callAgent(supervisor, synthesisPrompt, {
      orchestrationId, pattern: "supervisor", role: "synthesis",
    });
    steps.push(synthStep);
    totalTokens.input += synthStep.tokens.input;
    totalTokens.output += synthStep.tokens.output;

    const result = this.buildResult(
      orchestrationId, "supervisor",
      synthStep.status === "success" ? synthStep.output : workerResults,
      steps, totalTokens, startedAt,
      synthStep.status === "success" ? "completed" : "partial",
    );
    this.emit("orchestration:complete", result);
    return result;
  }

  // ─── Pattern 4: Debate ───
  // Two agents argue opposing sides, a judge agent picks the winner.

  async runDebate(
    agentA: string,
    agentB: string,
    judge: string,
    topic: string,
    rounds: number = 2,
  ): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const steps: OrchestrationStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Debate started: ${orchestrationId} — "${agentA}" vs "${agentB}", judge="${judge}"`);
    this.emit("orchestration:start", { orchestrationId, pattern: "debate", agents: [agentA, agentB, judge] });

    const debateHistory: string[] = [];

    for (let round = 1; round <= rounds; round++) {
      // Agent A argues
      const aPrompt = round === 1
        ? `You are debating the topic: "${topic}". Present your argument.`
        : `You are debating the topic: "${topic}". Previous exchanges:\n${debateHistory.join("\n\n")}\n\nPresent your rebuttal.`;

      const aStep = await this.callAgent(agentA, aPrompt, {
        orchestrationId, pattern: "debate", role: "debater_a", round,
      });
      steps.push(aStep);
      totalTokens.input += aStep.tokens.input;
      totalTokens.output += aStep.tokens.output;
      debateHistory.push(`[${agentA} — Round ${round}]: ${aStep.output}`);
      this.emit("orchestration:step", { orchestrationId, step: aStep });

      // Agent B argues
      const bPrompt =
        `You are debating the topic: "${topic}". Your opponent said:\n${aStep.output}\n\n` +
        (debateHistory.length > 1 ? `Full history:\n${debateHistory.join("\n\n")}\n\n` : "") +
        `Present your counter-argument.`;

      const bStep = await this.callAgent(agentB, bPrompt, {
        orchestrationId, pattern: "debate", role: "debater_b", round,
      });
      steps.push(bStep);
      totalTokens.input += bStep.tokens.input;
      totalTokens.output += bStep.tokens.output;
      debateHistory.push(`[${agentB} — Round ${round}]: ${bStep.output}`);
      this.emit("orchestration:step", { orchestrationId, step: bStep });
    }

    // Judge evaluates
    const judgePrompt =
      `You are judging a debate on: "${topic}"\n\nFull debate transcript:\n${debateHistory.join("\n\n")}\n\n` +
      `Evaluate both sides. Declare a winner and explain your reasoning. ` +
      `Then provide the definitive answer to the topic based on the strongest arguments.`;

    const judgeStep = await this.callAgent(judge, judgePrompt, {
      orchestrationId, pattern: "debate", role: "judge",
    });
    steps.push(judgeStep);
    totalTokens.input += judgeStep.tokens.input;
    totalTokens.output += judgeStep.tokens.output;

    const result = this.buildResult(
      orchestrationId, "debate",
      judgeStep.status === "success" ? judgeStep.output : debateHistory.join("\n\n"),
      steps, totalTokens, startedAt,
      judgeStep.status === "success" ? "completed" : "partial",
    );
    result.metadata = { rounds, debateHistory };
    this.emit("orchestration:complete", result);
    return result;
  }

  // ─── Pattern 5: Consensus ───
  // Multiple agents vote; a response passes if it meets the threshold.

  async runConsensus(agents: string[], input: string, threshold: number = 0.5): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Consensus started: ${orchestrationId} — ${agents.length} agents, threshold=${threshold}`);
    this.emit("orchestration:start", { orchestrationId, pattern: "consensus", agents });

    // Phase 1: All agents respond independently
    const responsePrompt = `${input}\n\nProvide your answer. Be concise and specific.`;
    const responsePromises = agents.map((agent) =>
      this.callAgent(agent, responsePrompt, { orchestrationId, pattern: "consensus", phase: "response" })
    );
    const responseSteps = await Promise.all(responsePromises);

    for (const step of responseSteps) {
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;
      this.emit("orchestration:step", { orchestrationId, step });
    }

    const successfulResponses = responseSteps.filter((s) => s.status === "success");

    // Phase 2: Each agent votes on all responses
    const votingResults: Map<number, number> = new Map();
    const allResponses = successfulResponses
      .map((s, i) => `Response ${i + 1}: ${s.output}`)
      .join("\n\n");

    const voterAgents = agents.slice(0, Math.min(agents.length, 5)); // Cap voters
    const votePromises = voterAgents.map((agent) => {
      const votePrompt =
        `Question: ${input}\n\nHere are ${successfulResponses.length} responses:\n\n${allResponses}\n\n` +
        `Which response number is the best? Reply with ONLY the number (e.g., "1" or "2").`;
      return this.callAgent(agent, votePrompt, { orchestrationId, pattern: "consensus", phase: "voting" });
    });

    const voteSteps = await Promise.all(votePromises);
    const allSteps = [...responseSteps, ...voteSteps];

    for (const step of voteSteps) {
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;

      if (step.status === "success") {
        const voteMatch = step.output.match(/(\d+)/);
        if (voteMatch) {
          const idx = parseInt(voteMatch[1], 10) - 1;
          votingResults.set(idx, (votingResults.get(idx) ?? 0) + 1);
        }
      }
      this.emit("orchestration:step", { orchestrationId, step });
    }

    // Determine winner
    let winnerIdx = 0;
    let maxVotes = 0;
    for (const [idx, votes] of votingResults) {
      if (votes > maxVotes) {
        maxVotes = votes;
        winnerIdx = idx;
      }
    }

    const votePercentage = voterAgents.length > 0 ? maxVotes / voterAgents.length : 0;
    const consensusReached = votePercentage >= threshold;
    const finalOutput = consensusReached && successfulResponses[winnerIdx]
      ? successfulResponses[winnerIdx].output
      : successfulResponses[0]?.output ?? "";

    const result = this.buildResult(
      orchestrationId, "consensus", finalOutput, allSteps, totalTokens, startedAt,
      consensusReached ? "completed" : "partial",
    );
    result.metadata = {
      votes: Object.fromEntries(votingResults),
      votePercentage,
      consensusReached,
      threshold,
    };
    this.emit("orchestration:complete", result);
    return result;
  }

  // ─── Pattern 6: Hierarchical ───
  // Manager → Team Leads → Workers. Tasks cascade down the hierarchy.

  async runHierarchical(hierarchy: HierarchyNode, task: string): Promise<OrchestrationResult> {
    const orchestrationId = this.newId();
    const startedAt = Date.now();
    const steps: OrchestrationStep[] = [];
    const totalTokens = { input: 0, output: 0 };

    logger.info(`[Orchestrator] Hierarchical started: ${orchestrationId} — root="${hierarchy.agent}"`);
    this.emit("orchestration:start", { orchestrationId, pattern: "hierarchical", agents: this.flattenHierarchy(hierarchy) });

    const finalOutput = await this.executeHierarchyNode(
      orchestrationId, hierarchy, task, steps, totalTokens, 0,
    );

    const hasFailures = steps.some((s) => s.status !== "success");
    const result = this.buildResult(
      orchestrationId, "hierarchical", finalOutput, steps, totalTokens, startedAt,
      hasFailures ? "partial" : "completed",
    );
    this.emit("orchestration:complete", result);
    return result;
  }

  private async executeHierarchyNode(
    orchestrationId: string,
    node: HierarchyNode,
    task: string,
    steps: OrchestrationStep[],
    totalTokens: { input: number; output: number },
    depth: number,
  ): Promise<string> {
    if (node.children.length === 0) {
      // Leaf worker — just execute
      const step = await this.callAgent(node.agent, task, {
        orchestrationId, pattern: "hierarchical", role: node.role, depth,
      });
      steps.push(step);
      totalTokens.input += step.tokens.input;
      totalTokens.output += step.tokens.output;
      this.emit("orchestration:step", { orchestrationId, step });
      return step.output;
    }

    // Manager/lead: decompose, delegate, synthesize
    const childNames = node.children.map((c) => c.agent);
    const decompPrompt =
      `You are a ${node.role}. You have subordinates: ${childNames.join(", ")}.\n\n` +
      `Task: ${task}\n\n` +
      `Decompose this into subtasks for each subordinate. Respond with a JSON array:\n` +
      `[{"agent": "<name>", "subtask": "<description>"}]\nOnly output valid JSON.`;

    const decompStep = await this.callAgent(node.agent, decompPrompt, {
      orchestrationId, pattern: "hierarchical", role: node.role, phase: "decomposition", depth,
    });
    steps.push(decompStep);
    totalTokens.input += decompStep.tokens.input;
    totalTokens.output += decompStep.tokens.output;

    let assignments: Array<{ agent: string; subtask: string }>;
    try {
      const jsonMatch = decompStep.output.match(/\[[\s\S]*\]/);
      assignments = JSON.parse(jsonMatch?.[0] ?? "[]");
    } catch {
      assignments = node.children.map((c) => ({ agent: c.agent, subtask: task }));
    }

    // Delegate to children (recursively, in parallel)
    const childResults = await Promise.all(
      node.children.map((child) => {
        const assignment = assignments.find((a) => a.agent === child.agent);
        const subtask = assignment?.subtask ?? task;
        return this.executeHierarchyNode(orchestrationId, child, subtask, steps, totalTokens, depth + 1);
      }),
    );

    // Synthesize
    const subordinateResults = childResults
      .map((r, i) => `[${childNames[i]}]: ${r}`)
      .join("\n\n");

    const synthPrompt =
      `You are a ${node.role}. Your subordinates completed their tasks.\n\n` +
      `Original task: ${task}\n\nResults:\n${subordinateResults}\n\nSynthesize a final answer.`;

    const synthStep = await this.callAgent(node.agent, synthPrompt, {
      orchestrationId, pattern: "hierarchical", role: node.role, phase: "synthesis", depth,
    });
    steps.push(synthStep);
    totalTokens.input += synthStep.tokens.input;
    totalTokens.output += synthStep.tokens.output;

    return synthStep.output;
  }

  private flattenHierarchy(node: HierarchyNode): string[] {
    return [node.agent, ...node.children.flatMap((c) => this.flattenHierarchy(c))];
  }

  // ─── Core Agent Caller ───

  private async callAgent(
    agentName: string,
    input: string,
    metadata: Record<string, unknown>,
  ): Promise<OrchestrationStep> {
    const stepId = `step_${uuid().slice(0, 8)}`;
    const model = this.config.defaultModel;
    const startedAt = Date.now();

    const systemPrompt = this.config.agentSystemPrompts[agentName]
      ?? `You are "${agentName}", an expert AI agent in the AstraOS multi-agent system. Be precise and helpful.`;

    const messages: LLMMessage[] = [
      { role: "user", content: input },
    ];

    let attempt = 0;
    while (attempt <= this.config.maxRetries) {
      try {
        const provider = this.registry.getProviderForModel(model);
        const response = await Promise.race([
          provider.chat({ model, system: systemPrompt, messages, maxTokens: 4096 }),
          this.timeout(this.config.agentTimeoutMs),
        ]);

        if (!response) {
          throw new Error("Agent call timed out");
        }

        const completedAt = Date.now();
        return {
          stepId,
          agentName,
          model,
          input,
          output: response.text,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          tokens: { input: response.usage.input, output: response.usage.output },
          status: "success",
          metadata,
        };
      } catch (err) {
        attempt++;
        if (attempt > this.config.maxRetries) {
          const completedAt = Date.now();
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Orchestrator] Agent "${agentName}" failed after ${this.config.maxRetries} retries: ${errorMsg}`);
          return {
            stepId,
            agentName,
            model,
            input,
            output: "",
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            tokens: { input: 0, output: 0 },
            status: errorMsg.includes("timed out") ? "timeout" : "failure",
            error: errorMsg,
            metadata,
          };
        }
        logger.warn(`[Orchestrator] Agent "${agentName}" attempt ${attempt} failed, retrying...`);
        await this.delay(1000 * attempt); // Exponential backoff
      }
    }

    // Should never reach here, but TypeScript needs it
    const completedAt = Date.now();
    return {
      stepId, agentName, model, input, output: "", startedAt, completedAt,
      durationMs: completedAt - startedAt, tokens: { input: 0, output: 0 },
      status: "failure", error: "Unexpected error", metadata,
    };
  }

  // ─── Orchestration Management ───

  cancelOrchestration(orchestrationId: string): boolean {
    const running = this.runningOrchestrations.get(orchestrationId);
    if (!running) return false;
    running.abort.abort();
    this.runningOrchestrations.delete(orchestrationId);
    logger.info(`[Orchestrator] Orchestration cancelled: ${orchestrationId}`);
    return true;
  }

  getRunningOrchestrations(): string[] {
    return Array.from(this.runningOrchestrations.keys());
  }

  // ─── Helpers ───

  private buildResult(
    orchestrationId: string,
    pattern: OrchestrationResult["pattern"],
    finalOutput: string,
    steps: OrchestrationStep[],
    totalTokens: { input: number; output: number },
    startedAt: number,
    status: OrchestrationResult["status"],
  ): OrchestrationResult {
    const completedAt = Date.now();
    return {
      orchestrationId,
      pattern,
      finalOutput,
      steps,
      totalDurationMs: completedAt - startedAt,
      totalTokens,
      agentCount: new Set(steps.map((s) => s.agentName)).size,
      startedAt,
      completedAt,
      status,
    };
  }

  private newId(): string {
    return `orch_${uuid().slice(0, 12)}`;
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Agent call timed out after ${ms}ms`)), ms),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
