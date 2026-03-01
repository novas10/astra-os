/**
 * AstraOS — HeartbeatEngine.ts
 * Proactive scheduler: Cron jobs + one-shot timers. Uses node-cron for proper cron parsing.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";

interface ScheduledJob {
  id: string;
  task: string;
  cron?: string;
  runInMs?: number;
  notifyChannel: string;
  agentConfig: Record<string, unknown>;
  nextRun?: number;
  lastRun?: number;
  status: "active" | "paused" | "completed";
  createdAt: number;
}

interface ScheduleOptions {
  task: string;
  cron?: string;
  runInMs?: number;
  notifyChannel: string;
  agentConfig: Record<string, unknown>;
}

export class HeartbeatEngine extends EventEmitter {
  private static instance: HeartbeatEngine;
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private cronTasks: Map<string, cron.ScheduledTask> = new Map();

  private constructor() {
    super();
    this.startHeartbeatMonitor();
  }

  static getInstance(): HeartbeatEngine {
    if (!HeartbeatEngine.instance) {
      HeartbeatEngine.instance = new HeartbeatEngine();
    }
    return HeartbeatEngine.instance;
  }

  async schedule(options: ScheduleOptions): Promise<string> {
    const jobId = `job_${uuidv4().slice(0, 8)}`;

    const job: ScheduledJob = {
      id: jobId,
      task: options.task,
      cron: options.cron,
      runInMs: options.runInMs,
      notifyChannel: options.notifyChannel,
      agentConfig: options.agentConfig,
      status: "active",
      createdAt: Date.now(),
    };

    if (options.runInMs) {
      // One-shot timer
      job.nextRun = Date.now() + options.runInMs;
      const timer = setTimeout(() => this.executeJob(job), options.runInMs);
      this.timers.set(jobId, timer);
    } else if (options.cron) {
      // Validate cron expression
      if (!cron.validate(options.cron)) {
        throw new Error(`Invalid cron expression: ${options.cron}`);
      }
      // Use node-cron for proper scheduling
      const task = cron.schedule(options.cron, () => this.executeJob(job), {
        scheduled: true,
      });
      this.cronTasks.set(jobId, task);
    } else {
      throw new Error("Must provide either cron or runInMs");
    }

    this.jobs.set(jobId, job);
    console.log(`[HeartbeatEngine] Job ${jobId} scheduled: "${options.task}"${options.cron ? ` (cron: ${options.cron})` : ` (in ${options.runInMs}ms)`}`);
    return jobId;
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    console.log(`[HeartbeatEngine] Executing job ${job.id}: "${job.task}"`);
    job.lastRun = Date.now();

    this.emit("job:execute", {
      jobId: job.id,
      task: job.task,
      notifyChannel: job.notifyChannel,
      agentConfig: job.agentConfig,
    });

    if (job.runInMs && !job.cron) {
      job.status = "completed";
      this.timers.delete(job.id);
    }
  }

  cancelJob(jobId: string): boolean {
    const timer = this.timers.get(jobId);
    if (timer) { clearTimeout(timer); this.timers.delete(jobId); }

    const task = this.cronTasks.get(jobId);
    if (task) { task.stop(); this.cronTasks.delete(jobId); }

    const job = this.jobs.get(jobId);
    if (job) { job.status = "paused"; return true; }
    return false;
  }

  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.jobs.get(jobId);
  }

  registerWebhook(path: string, handler: (data: unknown) => Promise<string>): void {
    this.emit("webhook:register", { path, handler });
    console.log(`[HeartbeatEngine] Webhook registered: ${path}`);
  }

  private startHeartbeatMonitor(): void {
    setInterval(() => {
      const activeJobs = Array.from(this.jobs.values()).filter((j) => j.status === "active");
      if (activeJobs.length > 0) {
        console.log(`[HeartbeatEngine] Active jobs: ${activeJobs.length}`);
      }
    }, 60_000);
  }

  async destroyAll(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const task of this.cronTasks.values()) task.stop();
    this.timers.clear();
    this.cronTasks.clear();
    this.jobs.clear();
  }
}
