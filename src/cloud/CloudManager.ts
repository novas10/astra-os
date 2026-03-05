/**
 * AstraOS — AstraCloud Manager
 * Manages cloud instance provisioning, Stripe checkout, and customer lifecycle.
 * Powers the AstraCloud hosted platform (like MyClaw.ai but better).
 */

import { Router, Request, Response } from "express";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

// ─── Types ───

export interface CloudPlan {
  id: string;
  name: string;
  price: number;          // Monthly price in cents
  stripePriceId: string;
  specs: {
    vcpu: number;
    ramGb: number;
    storageGb: number;
  };
  features: string[];
}

export interface CloudInstance {
  id: string;
  customerId: string;
  email: string;
  name: string;
  company?: string;
  planId: string;
  status: "provisioning" | "active" | "stopped" | "suspended" | "terminated";
  region: string;
  url?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  provisionedAt?: string;
  lastBackup?: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  company?: string;
  plan: string;
}

// ─── Plans ───

const CLOUD_PLANS: CloudPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 1500,
    stripePriceId: process.env.STRIPE_CLOUD_STARTER_PRICE_ID || "price_cloud_starter",
    specs: { vcpu: 2, ramGb: 4, storageGb: 40 },
    features: [
      "Always-on AI agent (24/7)",
      "All 55+ bundled skills",
      "14+ channels",
      "Daily backups",
      "Auto-updates",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 3500,
    stripePriceId: process.env.STRIPE_CLOUD_PRO_PRICE_ID || "price_cloud_pro",
    specs: { vcpu: 4, ramGb: 8, storageGb: 80 },
    features: [
      "Everything in Starter",
      "GraphRAG memory",
      "Workflow builder",
      "MCP + A2A protocols",
      "Priority support",
      "Custom domain",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 6900,
    stripePriceId: process.env.STRIPE_CLOUD_ENTERPRISE_PRICE_ID || "price_cloud_enterprise",
    specs: { vcpu: 8, ramGb: 16, storageGb: 160 },
    features: [
      "Everything in Pro",
      "SSO (SAML + OIDC)",
      "Audit log + compliance",
      "Data residency (7 regions)",
      "Multi-tenancy + RBAC",
      "Dedicated support",
    ],
  },
];

// ─── Cloud Manager ───

export class CloudManager {
  private instances: Map<string, CloudInstance> = new Map();
  private dataDir: string;
  private stripeSecretKey: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), ".astra-data", "cloud");
    this.stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.loadInstances();
    logger.info(`[CloudManager] Initialized — ${this.instances.size} instances loaded`);
  }

  // ─── Stripe Checkout ───

  async createCheckoutSession(signup: SignupRequest): Promise<{ checkoutUrl?: string; instanceId: string }> {
    const plan = CLOUD_PLANS.find((p) => p.id === signup.plan);
    if (!plan) throw new Error(`Unknown plan: ${signup.plan}`);

    const instanceId = `inst_${crypto.randomBytes(12).toString("hex")}`;

    // Create instance record
    const instance: CloudInstance = {
      id: instanceId,
      customerId: `cust_${crypto.randomBytes(8).toString("hex")}`,
      email: signup.email,
      name: signup.name,
      company: signup.company,
      planId: plan.id,
      status: "provisioning",
      region: "us-east-1",
      createdAt: new Date().toISOString(),
    };

    this.instances.set(instanceId, instance);
    await this.saveInstances();

    // If Stripe is configured, create a checkout session
    if (this.stripeSecretKey) {
      try {
        const session = await this.stripeRequest<{ id: string; url: string }>(
          "POST",
          "/checkout/sessions",
          {
            mode: "subscription",
            "line_items[0][price]": plan.stripePriceId,
            "line_items[0][quantity]": "1",
            success_url: `${process.env.ASTRACLOUD_URL || "http://localhost:3000"}/cloud/success?instance=${instanceId}`,
            cancel_url: `${process.env.ASTRACLOUD_URL || "http://localhost:3000"}/cloud`,
            customer_email: signup.email,
            "metadata[instanceId]": instanceId,
            "metadata[planId]": plan.id,
          },
        );

        instance.stripeCustomerId = session.id;
        await this.saveInstances();

        return { checkoutUrl: session.url, instanceId };
      } catch (err) {
        logger.warn(`[CloudManager] Stripe checkout failed: ${err}`);
      }
    }

    // No Stripe configured — waitlist mode
    logger.info(`[CloudManager] New signup (waitlist): ${signup.email} — plan: ${plan.name}`);

    // Save to waitlist file
    const waitlistPath = path.join(this.dataDir, "waitlist.jsonl");
    const entry = JSON.stringify({ ...signup, instanceId, timestamp: new Date().toISOString() });
    await fs.appendFile(waitlistPath, entry + "\n", "utf-8");

    return { instanceId };
  }

  // ─── Instance Management ───

  async provisionInstance(instanceId: string): Promise<CloudInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    // In production, this would call Railway/Render API to provision a container.
    // For now, update status and generate a URL.
    instance.status = "active";
    instance.provisionedAt = new Date().toISOString();
    instance.url = `https://${instance.id}.astracloud.ai`;

    await this.saveInstances();
    logger.info(`[CloudManager] Instance provisioned: ${instanceId} — ${instance.url}`);
    return instance;
  }

  getInstance(instanceId: string): CloudInstance | undefined {
    return this.instances.get(instanceId);
  }

  getInstanceByEmail(email: string): CloudInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.email === email);
  }

  getAllInstances(): CloudInstance[] {
    return Array.from(this.instances.values());
  }

  async stopInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);
    instance.status = "stopped";
    await this.saveInstances();
  }

  async terminateInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);
    instance.status = "terminated";
    await this.saveInstances();
  }

  // ─── Stripe Helpers ───

  private async stripeRequest<T>(method: string, endpoint: string, body?: Record<string, string>): Promise<T> {
    const url = `https://api.stripe.com/v1${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    if (body) {
      options.body = new URLSearchParams(body).toString();
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe error: ${err.error?.message || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Webhook Handler ───

  async handleStripeWebhook(event: { type: string; data: { object: Record<string, unknown> } }): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const instanceId = (session.metadata as Record<string, string>)?.instanceId;
        if (instanceId) {
          await this.provisionInstance(instanceId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        // Find instance by subscription
        for (const instance of this.instances.values()) {
          if (instance.stripeSubscriptionId === sub.id) {
            instance.status = "suspended";
            await this.saveInstances();
            break;
          }
        }
        break;
      }
    }
  }

  // ─── Persistence ───

  private async loadInstances(): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, "instances.json");
      const data = await fs.readFile(filePath, "utf-8");
      const arr = JSON.parse(data) as CloudInstance[];
      for (const inst of arr) {
        this.instances.set(inst.id, inst);
      }
    } catch {
      // No instances file yet
    }
  }

  private async saveInstances(): Promise<void> {
    const filePath = path.join(this.dataDir, "instances.json");
    const data = JSON.stringify(Array.from(this.instances.values()), null, 2);
    await fs.writeFile(filePath, data, "utf-8");
  }

  // ─── Express Router ───

  getRouter(): Router {
    const router = Router();

    // Serve landing page
    router.get("/", (_req: Request, res: Response) => {
      const landingPage = path.join(process.cwd(), "packages", "astracloud", "index.html");
      res.sendFile(landingPage, (err) => {
        if (err) res.status(404).json({ error: "AstraCloud landing page not found" });
      });
    });

    // Plans
    router.get("/plans", (_req: Request, res: Response) => {
      res.json(CLOUD_PLANS.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price / 100,
        specs: p.specs,
        features: p.features,
      })));
    });

    // Signup / Checkout
    router.post("/signup", async (req: Request, res: Response) => {
      try {
        const { name, email, company, plan } = req.body as SignupRequest;
        if (!name || !email || !plan) {
          res.status(400).json({ error: "name, email, and plan are required" });
          return;
        }

        const result = await this.createCheckoutSession({ name, email, company, plan });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Instance status
    router.get("/instance/:id", (req: Request, res: Response) => {
      const instance = this.getInstance(req.params.id);
      if (!instance) {
        res.status(404).json({ error: "Instance not found" });
        return;
      }
      res.json(instance);
    });

    // List instances (admin)
    router.get("/admin/instances", (_req: Request, res: Response) => {
      res.json(this.getAllInstances());
    });

    // Success page
    router.get("/success", (req: Request, res: Response) => {
      const instanceId = req.query.instance as string;
      const instance = instanceId ? this.getInstance(instanceId) : undefined;
      res.json({
        message: "Your AstraCloud instance is being provisioned!",
        instance: instance ? {
          id: instance.id,
          status: instance.status,
          url: instance.url,
          plan: instance.planId,
        } : undefined,
      });
    });

    // Stripe webhook
    router.post("/webhook/stripe", async (req: Request, res: Response) => {
      try {
        await this.handleStripeWebhook(req.body);
        res.json({ received: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    return router;
  }
}
