/**
 * AstraOS — CloudManager unit tests
 * Tests cloud instance management, plan lookups, and checkout flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

import { CloudManager } from "../cloud/CloudManager";

describe("CloudManager", () => {
  let manager: CloudManager;

  beforeEach(async () => {
    manager = new CloudManager();
    await manager.initialize();
  });

  describe("initialization", () => {
    it("should initialize without errors", () => {
      expect(manager).toBeDefined();
    });

    it("should start with no instances", () => {
      expect(manager.getAllInstances()).toHaveLength(0);
    });
  });

  describe("createCheckoutSession", () => {
    it("should create instance for valid plan", async () => {
      const result = await manager.createCheckoutSession({
        name: "Test User",
        email: "test@example.com",
        plan: "starter",
      });

      expect(result.instanceId).toBeDefined();
      expect(result.instanceId).toMatch(/^inst_/);
    });

    it("should throw for unknown plan", async () => {
      await expect(
        manager.createCheckoutSession({
          name: "Test",
          email: "test@example.com",
          plan: "nonexistent",
        }),
      ).rejects.toThrow("Unknown plan: nonexistent");
    });

    it("should save instance after creation", async () => {
      const result = await manager.createCheckoutSession({
        name: "Test",
        email: "test@example.com",
        plan: "pro",
      });

      const instance = manager.getInstance(result.instanceId);
      expect(instance).toBeDefined();
      expect(instance?.planId).toBe("pro");
      expect(instance?.email).toBe("test@example.com");
      expect(instance?.status).toBe("provisioning");
    });
  });

  describe("instance management", () => {
    let instanceId: string;

    beforeEach(async () => {
      const result = await manager.createCheckoutSession({
        name: "Test",
        email: "test@example.com",
        plan: "starter",
      });
      instanceId = result.instanceId;
    });

    it("should provision instance", async () => {
      const instance = await manager.provisionInstance(instanceId);
      expect(instance.status).toBe("active");
      expect(instance.url).toContain("astracloud.ai");
      expect(instance.provisionedAt).toBeDefined();
    });

    it("should stop instance", async () => {
      await manager.stopInstance(instanceId);
      const instance = manager.getInstance(instanceId);
      expect(instance?.status).toBe("stopped");
    });

    it("should terminate instance", async () => {
      await manager.terminateInstance(instanceId);
      const instance = manager.getInstance(instanceId);
      expect(instance?.status).toBe("terminated");
    });

    it("should throw for unknown instance", async () => {
      await expect(manager.provisionInstance("inst_unknown")).rejects.toThrow("Instance not found");
      await expect(manager.stopInstance("inst_unknown")).rejects.toThrow("Instance not found");
      await expect(manager.terminateInstance("inst_unknown")).rejects.toThrow("Instance not found");
    });

    it("should find instances by email", async () => {
      const instances = manager.getInstanceByEmail("test@example.com");
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe(instanceId);
    });

    it("should return empty for unknown email", () => {
      const instances = manager.getInstanceByEmail("nobody@example.com");
      expect(instances).toHaveLength(0);
    });
  });

  describe("webhook handling", () => {
    it("should provision instance on checkout.session.completed", async () => {
      const result = await manager.createCheckoutSession({
        name: "Test",
        email: "test@example.com",
        plan: "starter",
      });

      await manager.handleStripeWebhook({
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: { instanceId: result.instanceId },
          },
        },
      });

      const instance = manager.getInstance(result.instanceId);
      expect(instance?.status).toBe("active");
    });

    it("should handle unknown event types without error", async () => {
      await expect(
        manager.handleStripeWebhook({
          type: "some.unknown.event",
          data: { object: {} },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("getRouter", () => {
    it("should return an Express router", () => {
      const router = manager.getRouter();
      expect(router).toBeDefined();
      expect(typeof router).toBe("function");
    });
  });
});
