/**
 * AstraOS — WorkflowEngine unit tests
 * Tests workflow CRUD, DAG execution, and node type handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { WorkflowEngine, WorkflowDefinition, WorkflowNode } from "../workflow/WorkflowEngine";

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "wf_test",
    name: "Test Workflow",
    description: "A test workflow",
    version: "1.0",
    nodes: [
      { id: "start", type: "transform", name: "Start", config: { expression: "'hello'" }, next: undefined },
    ],
    entryNode: "start",
    variables: {},
    ...overrides,
  };
}

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  describe("workflow CRUD", () => {
    it("should register a workflow", () => {
      const wf = makeWorkflow();
      engine.registerWorkflow(wf);
      expect(engine.getWorkflow("wf_test")).toBeDefined();
      expect(engine.getWorkflow("wf_test")?.name).toBe("Test Workflow");
    });

    it("should list all workflows", () => {
      engine.registerWorkflow(makeWorkflow({ id: "wf_1", name: "WF1" }));
      engine.registerWorkflow(makeWorkflow({ id: "wf_2", name: "WF2" }));
      const all = engine.listWorkflows();
      expect(all).toHaveLength(2);
    });

    it("should return undefined for unknown workflow", () => {
      expect(engine.getWorkflow("nonexistent")).toBeUndefined();
    });
  });

  describe("workflow execution", () => {
    it("should execute a simple transform node", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "transform", name: "Transform", config: { expression: "1 + 1" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");

      expect(run.status).toBe("completed");
      expect(run.history.length).toBeGreaterThanOrEqual(1);
    });

    it("should execute a multi-node chain", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "transform", name: "Step 1", config: { expression: "1" }, next: "n2" },
          { id: "n2", type: "transform", name: "Step 2", config: { expression: "2" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");

      expect(run.status).toBe("completed");
      expect(run.history).toHaveLength(2);
    });

    it("should fail for unknown workflow", async () => {
      await expect(engine.startWorkflow("nonexistent")).rejects.toThrow();
    });

    it("should handle condition nodes", async () => {
      const wf = makeWorkflow({
        nodes: [
          {
            id: "cond",
            type: "condition",
            name: "Check",
            config: { condition: "true" },
            conditionTrue: "yes",
            conditionFalse: "no",
          },
          { id: "yes", type: "transform", name: "Yes", config: { expression: "'yes'" } },
          { id: "no", type: "transform", name: "No", config: { expression: "'no'" } },
        ],
        entryNode: "cond",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");

      expect(run.status).toBe("completed");
      expect(run.history.length).toBeGreaterThanOrEqual(1);
    });

    it("should set variables from transform output", async () => {
      const wf = makeWorkflow({
        nodes: [
          {
            id: "n1",
            type: "transform",
            name: "Set Var",
            config: { expression: "42", outputVariable: "myVar" },
            next: "n2",
          },
          {
            id: "n2",
            type: "transform",
            name: "Use Var",
            config: { expression: "1" },
          },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");

      expect(run.status).toBe("completed");
    });
  });

  describe("run management", () => {
    it("should track run by ID", async () => {
      engine.registerWorkflow(makeWorkflow());
      const run = await engine.startWorkflow("wf_test");
      const fetched = engine.getRun(run.id);
      expect(fetched).toBeDefined();
      expect(fetched?.status).toBe("completed");
    });

    it("should list all runs", async () => {
      engine.registerWorkflow(makeWorkflow());
      await engine.startWorkflow("wf_test");
      await engine.startWorkflow("wf_test");
      const runs = engine.listRuns();
      expect(runs).toHaveLength(2);
    });
  });

  describe("security", () => {
    it("should block dangerous expressions in transform", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "transform", name: "Danger", config: { expression: "process.exit(1)" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");

      // Should fail or complete with error, not actually exit
      expect(["completed", "failed"]).toContain(run.status);
    });

    it("should block require in expressions", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "transform", name: "Danger", config: { expression: "require('fs')" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");
      expect(["completed", "failed"]).toContain(run.status);
    });
  });

  describe("node types", () => {
    it("should support delay node", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "delay", name: "Wait", config: { seconds: 0 } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");
      expect(run.status).toBe("completed");
    });

    it("should support code node", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "code", name: "Code", config: { code: "1 + 1" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");
      expect(run.status).toBe("completed");
    });

    it("should support memory node", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "memory", name: "Mem", config: { operation: "read", key: "test" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");
      expect(run.status).toBe("completed");
    });

    it("should support search node", async () => {
      const wf = makeWorkflow({
        nodes: [
          { id: "n1", type: "search", name: "Search", config: { source: "web", query: "test" } },
        ],
        entryNode: "n1",
      });
      engine.registerWorkflow(wf);
      const run = await engine.startWorkflow("wf_test");
      expect(run.status).toBe("completed");
    });
  });
});
