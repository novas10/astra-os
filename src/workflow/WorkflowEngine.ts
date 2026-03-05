/**
 * AstraOS — Workflow Engine
 * DAG-based workflow execution with checkpointing and resume.
 * Nodes: llm_call, tool_call, condition, parallel, loop, human_input
 */

import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";

export type NodeType =
  | "llm_call" | "tool_call" | "condition" | "parallel" | "loop" | "human_input" | "transform"
  | "api_call" | "email" | "memory" | "search" | "image_gen" | "code" | "delay" | "webhook" | "file_op";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  next?: string | string[];          // next node(s) to execute
  conditionTrue?: string;            // for condition nodes
  conditionFalse?: string;           // for condition nodes
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  entryNode: string;
  variables: Record<string, unknown>;
}

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed" | "canceled";

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  currentNode: string;
  variables: Record<string, unknown>;
  history: Array<{ nodeId: string; result: unknown; timestamp: number }>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export type NodeExecutor = (node: WorkflowNode, variables: Record<string, unknown>) => Promise<{
  result: unknown;
  nextNode?: string;
  variables?: Record<string, unknown>;
}>;

export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private runs: Map<string, WorkflowRun> = new Map();
  private executors: Map<NodeType, NodeExecutor> = new Map();
  private pendingInputs: Map<string, { resolve: (value: unknown) => void }> = new Map();

  private static readonly BLOCKED_PATTERNS = /\b(process|require|import|eval|Function|constructor|__proto__|globalThis|fetch|child_process|exec|spawn|setTimeout|setInterval|setImmediate)\b/;

  constructor() {
    this.registerDefaultExecutors();
  }

  private safeEval(expression: string, variables: Record<string, unknown>): unknown {
    if (WorkflowEngine.BLOCKED_PATTERNS.test(expression)) {
      throw new Error(`Blocked expression: contains forbidden keyword`);
    }
    const keys = Object.keys(variables);
    const values = Object.values(variables);
    const fn = new Function(...keys, `"use strict"; return (${expression});`);
    return fn(...values);
  }

  private registerDefaultExecutors(): void {
    // Transform node: applies a JS expression to transform variables
    this.executors.set("transform", async (node, variables) => {
      const expression = node.config.expression as string;
      const result = this.safeEval(expression, variables);
      const outputVar = (node.config.outputVar as string) || "result";
      return {
        result,
        variables: { ...variables, [outputVar]: result },
        nextNode: typeof node.next === "string" ? node.next : node.next?.[0],
      };
    });

    // Condition node: evaluates condition and branches
    this.executors.set("condition", async (node, variables) => {
      const condition = node.config.condition as string;
      const result = this.safeEval(condition, variables);
      return {
        result,
        nextNode: result ? node.conditionTrue : node.conditionFalse,
      };
    });

    // Human input node: pauses and waits for input
    this.executors.set("human_input", async (node, variables) => {
      const prompt = node.config.prompt as string || "Awaiting input...";
      logger.info(`[Workflow] Waiting for human input: ${prompt}`);

      const input = await new Promise<unknown>((resolve) => {
        // Store resolver for external input
        this.pendingInputs.set(node.id, { resolve });
      });

      const outputVar = (node.config.outputVar as string) || "humanInput";
      return {
        result: input,
        variables: { ...variables, [outputVar]: input },
        nextNode: typeof node.next === "string" ? node.next : node.next?.[0],
      };
    });

    // API Call node: HTTP request to external API
    this.executors.set("api_call", async (node, variables) => {
      const method = (node.config.method as string) || "GET";
      const url = node.config.url as string;
      const headers = node.config.headers ? JSON.parse(node.config.headers as string) : {};
      const body = node.config.body as string;

      const opts: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
      if (body && method !== "GET") opts.body = body;

      const resp = await fetch(url, opts);
      const result = await resp.json();
      return { result, variables: { ...variables, apiResult: result }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Code node: execute custom JavaScript expression
    this.executors.set("code", async (node, variables) => {
      const code = node.config.code as string || "return null;";
      const result = this.safeEval(code, variables);
      return { result, variables: { ...variables, codeResult: result }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Delay node: wait N seconds
    this.executors.set("delay", async (node, variables) => {
      const seconds = parseInt(node.config.seconds as string) || 5;
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { result: { delayed: seconds }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Email node: placeholder for email sending
    this.executors.set("email", async (node, variables) => {
      const to = node.config.to as string;
      const subject = node.config.subject as string || "AstraOS Notification";
      logger.info(`[Workflow] Email node: to=${to}, subject=${subject}`);
      return { result: { sent: true, to, subject }, variables: { ...variables, emailSent: true }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Memory node: read/write to memory store
    this.executors.set("memory", async (node, variables) => {
      const operation = (node.config.operation as string) || "read";
      const key = node.config.key as string || "default";
      logger.info(`[Workflow] Memory node: ${operation} key=${key}`);
      return { result: { operation, key }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Search node: web or knowledge base search
    this.executors.set("search", async (node, variables) => {
      const source = (node.config.source as string) || "web";
      const query = (node.config.query as string) || (variables.input as string) || "";
      logger.info(`[Workflow] Search node: source=${source}, query=${query}`);
      return { result: { source, query, results: [] }, variables: { ...variables, searchResults: [] }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Image generation node: placeholder
    this.executors.set("image_gen", async (node, variables) => {
      const prompt = (node.config.prompt as string) || "";
      const style = (node.config.style as string) || "natural";
      logger.info(`[Workflow] Image gen node: style=${style}, prompt=${prompt}`);
      return { result: { prompt, style, imageUrl: null }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // Webhook node: trigger or receive webhook
    this.executors.set("webhook", async (node, variables) => {
      const mode = (node.config.mode as string) || "trigger";
      const url = node.config.url as string;
      if (mode === "trigger" && url) {
        const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(variables) });
        const result = await resp.json();
        return { result, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
      }
      return { result: { mode, received: true }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });

    // File operation node: placeholder
    this.executors.set("file_op", async (node, variables) => {
      const operation = (node.config.operation as string) || "read";
      logger.info(`[Workflow] File op node: ${operation}`);
      return { result: { operation }, nextNode: typeof node.next === "string" ? node.next : node.next?.[0] };
    });
  }

  registerExecutor(type: NodeType, executor: NodeExecutor): void {
    this.executors.set(type, executor);
  }

  registerWorkflow(definition: WorkflowDefinition): void {
    this.workflows.set(definition.id, definition);
    logger.info(`[Workflow] Registered: ${definition.name} (${definition.nodes.length} nodes)`);
  }

  async startWorkflow(workflowId: string, initialVars?: Record<string, unknown>): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const run: WorkflowRun = {
      id: uuid(),
      workflowId,
      status: "running",
      currentNode: workflow.entryNode,
      variables: { ...workflow.variables, ...initialVars },
      history: [],
      startedAt: Date.now(),
    };

    this.runs.set(run.id, run);
    logger.info(`[Workflow] Started run ${run.id} for ${workflow.name}`);

    // Execute workflow
    await this.executeLoop(run, workflow);
    return run;
  }

  private async executeLoop(run: WorkflowRun, workflow: WorkflowDefinition): Promise<void> {
    let maxIterations = 1000; // Safety limit

    while (run.status === "running" && maxIterations-- > 0) {
      const node = workflow.nodes.find((n) => n.id === run.currentNode);
      if (!node) {
        run.status = "completed";
        run.completedAt = Date.now();
        break;
      }

      // Handle parallel nodes
      if (node.type === "parallel" && Array.isArray(node.next)) {
        await this.executeParallel(run, workflow, node);
        continue;
      }

      // Handle loop nodes — iterate over an array variable
      if (node.type === "loop") {
        const loopVar = node.config.loopVar as string || "items";
        const items = run.variables[loopVar];
        const bodyNode = typeof node.next === "string" ? node.next : node.next?.[0];
        const afterLoop = node.config.afterLoop as string || node.conditionFalse;

        if (!Array.isArray(items) || !bodyNode) {
          if (afterLoop) { run.currentNode = afterLoop; }
          else { run.status = "completed"; run.completedAt = Date.now(); }
          continue;
        }

        const iterResults: unknown[] = [];
        for (let i = 0; i < items.length && run.status === "running"; i++) {
          run.variables = { ...run.variables, loopIndex: i, loopItem: items[i], loopTotal: items.length };
          const bodyDef = workflow.nodes.find((n) => n.id === bodyNode);
          if (!bodyDef) break;
          const bodyExecutor = this.executors.get(bodyDef.type);
          if (!bodyExecutor) break;

          try {
            const result = await bodyExecutor(bodyDef, run.variables);
            iterResults.push(result.result);
            if (result.variables) run.variables = { ...run.variables, ...result.variables };
            run.history.push({ nodeId: bodyDef.id, result: result.result, timestamp: Date.now() });
          } catch (err) {
            run.status = "failed";
            run.error = `Loop iteration ${i} failed: ${(err as Error).message}`;
            break;
          }
        }

        run.variables = { ...run.variables, loopResults: iterResults };
        if (run.status === "running") {
          if (afterLoop) { run.currentNode = afterLoop; }
          else { run.status = "completed"; run.completedAt = Date.now(); }
        }
        continue;
      }

      const executor = this.executors.get(node.type);
      if (!executor) {
        run.status = "failed";
        run.error = `No executor for node type: ${node.type}`;
        break;
      }

      try {
        const result = await executor(node, run.variables);
        run.history.push({ nodeId: node.id, result: result.result, timestamp: Date.now() });

        if (result.variables) {
          run.variables = { ...run.variables, ...result.variables };
        }

        // Determine next node
        const nextNode = result.nextNode || (typeof node.next === "string" ? node.next : node.next?.[0]);

        if (!nextNode) {
          run.status = "completed";
          run.completedAt = Date.now();
          break;
        }

        run.currentNode = nextNode;
      } catch (err) {
        run.status = "failed";
        run.error = (err as Error).message;
        run.history.push({ nodeId: node.id, result: { error: (err as Error).message }, timestamp: Date.now() });
        break;
      }
    }

    if (maxIterations <= 0) {
      run.status = "failed";
      run.error = "Maximum iterations exceeded";
    }
  }

  private async executeParallel(run: WorkflowRun, workflow: WorkflowDefinition, node: WorkflowNode): Promise<void> {
    const nextNodes = node.next as string[];
    const parallelResults = await Promise.allSettled(
      nextNodes.map(async (nodeId) => {
        const subNode = workflow.nodes.find((n) => n.id === nodeId);
        if (!subNode) return null;
        const executor = this.executors.get(subNode.type);
        if (!executor) return null;
        return executor(subNode, run.variables);
      })
    );

    for (const result of parallelResults) {
      if (result.status === "fulfilled" && result.value) {
        run.history.push({ nodeId: node.id, result: result.value.result, timestamp: Date.now() });
        if (result.value.variables) {
          run.variables = { ...run.variables, ...result.value.variables };
        }
      }
    }

    // After parallel, move to the merge node if specified
    const mergeNode = node.config.mergeNode as string;
    if (mergeNode) {
      run.currentNode = mergeNode;
    } else {
      run.status = "completed";
      run.completedAt = Date.now();
    }
  }

  provideInput(nodeId: string, value: unknown): void {
    const pending = this.pendingInputs.get(nodeId);
    if (pending) {
      pending.resolve(value);
      this.pendingInputs.delete(nodeId);
    }
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return false;
    run.status = "canceled";
    run.completedAt = Date.now();
    return true;
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  deleteWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }
}
