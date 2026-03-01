/**
 * AstraOS — Workflow Engine
 * DAG-based workflow execution with checkpointing and resume.
 * Nodes: llm_call, tool_call, condition, parallel, loop, human_input
 */

import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";

export type NodeType = "llm_call" | "tool_call" | "condition" | "parallel" | "loop" | "human_input" | "transform";

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

  constructor() {
    this.registerDefaultExecutors();
  }

  private registerDefaultExecutors(): void {
    // Transform node: applies a JS expression to transform variables
    this.executors.set("transform", async (node, variables) => {
      const expression = node.config.expression as string;
      const result = new Function("vars", `with(vars) { return ${expression}; }`)(variables);
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
      const result = new Function("vars", `with(vars) { return !!(${condition}); }`)(variables);
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

      // Handle loop nodes
      if (node.type === "loop") {
        await this.executeLoop(run, workflow);
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
}
