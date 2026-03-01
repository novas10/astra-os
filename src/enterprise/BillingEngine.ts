/**
 * AstraOS — Billing Engine
 * Stripe integration for SaaS billing: subscriptions, usage metering, invoices, webhooks.
 */

import { Router, Request, Response } from "express";
import * as crypto from "crypto";

// ─── Types ───

export interface Plan {
  id: string;
  name: string;
  stripePriceId: string;
  price: number;           // Monthly price in cents
  limits: {
    agents: number;
    messagesPerDay: number;
    skills: number;
    channels: string[];
    features: string[];
  };
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: "active" | "past_due" | "canceled" | "trialing" | "paused";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface UsageRecord {
  tenantId: string;
  metric: string;
  value: number;
  timestamp: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  stripeInvoiceId: string;
  amount: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  periodStart: string;
  periodEnd: string;
  pdfUrl?: string;
  createdAt: string;
}

// ─── Plans ───

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    stripePriceId: "",
    price: 0,
    limits: { agents: 1, messagesPerDay: 100, skills: 5, channels: ["REST", "WebSocket"], features: ["community_skills"] },
  },
  {
    id: "pro",
    name: "Pro",
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || "price_pro",
    price: 4900, // $49/mo
    limits: { agents: 10, messagesPerDay: 10_000, skills: 50, channels: ["*"], features: ["mcp", "a2a", "marketplace", "graphrag", "streaming"] },
  },
  {
    id: "team",
    name: "Team",
    stripePriceId: process.env.STRIPE_TEAM_PRICE_ID || "price_team",
    price: 19900, // $199/mo
    limits: { agents: 50, messagesPerDay: 100_000, skills: 200, channels: ["*"], features: ["mcp", "a2a", "marketplace", "graphrag", "streaming", "sso", "audit", "workflows", "priority_support"] },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || "price_enterprise",
    price: -1, // Custom
    limits: { agents: Infinity, messagesPerDay: Infinity, skills: Infinity, channels: ["*"], features: ["*"] },
  },
];

// ─── Billing Engine ───

export class BillingEngine {
  private stripeSecretKey: string;
  private stripeWebhookSecret: string;
  private subscriptions: Map<string, Subscription> = new Map();
  private usageRecords: UsageRecord[] = [];
  private invoices: Map<string, Invoice[]> = new Map();
  private router: Router;

  constructor() {
    this.stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
    this.stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    this.router = Router();
    this.setupRoutes();
  }

  // ─── Stripe API Helpers ───

  private async stripeRequest<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.stripeSecretKey) {
      throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
    }

    const url = `https://api.stripe.com/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = this.encodeFormData(body);
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      const errBody = await res.json() as Record<string, any>;
      throw new Error(`Stripe error: ${errBody.error?.message || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private encodeFormData(obj: Record<string, unknown>, prefix = ""): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        parts.push(this.encodeFormData(value as Record<string, unknown>, fullKey));
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.join("&");
  }

  // ─── Customer Management ───

  async createCustomer(tenantId: string, email: string, name: string): Promise<string> {
    const customer = await this.stripeRequest<{ id: string }>("POST", "/customers", {
      email, name, metadata: { tenantId },
    });
    return customer.id;
  }

  // ─── Subscription Management ───

  async createSubscription(tenantId: string, customerId: string, planId: string): Promise<Subscription> {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new Error(`Plan "${planId}" not found`);
    if (plan.id === "free") {
      // Free plan — no Stripe subscription
      const sub: Subscription = {
        id: `sub_free_${tenantId}`,
        tenantId,
        planId: "free",
        stripeSubscriptionId: "",
        stripeCustomerId: customerId,
        status: "active",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 365 * 86400_000).toISOString(),
        cancelAtPeriodEnd: false,
        createdAt: new Date().toISOString(),
      };
      this.subscriptions.set(tenantId, sub);
      return sub;
    }

    const stripeSub = await this.stripeRequest<{
      id: string; status: string;
      current_period_start: number; current_period_end: number;
    }>("POST", "/subscriptions", {
      customer: customerId,
      items: { "0": { price: plan.stripePriceId } },
      metadata: { tenantId, planId },
    });

    const sub: Subscription = {
      id: `sub_${crypto.randomBytes(8).toString("hex")}`,
      tenantId,
      planId,
      stripeSubscriptionId: stripeSub.id,
      stripeCustomerId: customerId,
      status: stripeSub.status as Subscription["status"],
      currentPeriodStart: new Date(stripeSub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.set(tenantId, sub);
    return sub;
  }

  async cancelSubscription(tenantId: string, immediate = false): Promise<void> {
    const sub = this.subscriptions.get(tenantId);
    if (!sub || !sub.stripeSubscriptionId) return;

    if (immediate) {
      await this.stripeRequest("DELETE", `/subscriptions/${sub.stripeSubscriptionId}`);
      sub.status = "canceled";
    } else {
      await this.stripeRequest("POST", `/subscriptions/${sub.stripeSubscriptionId}`, {
        cancel_at_period_end: "true",
      });
      sub.cancelAtPeriodEnd = true;
    }
  }

  async changePlan(tenantId: string, newPlanId: string): Promise<Subscription> {
    const sub = this.subscriptions.get(tenantId);
    if (!sub) throw new Error("No active subscription");

    const plan = PLANS.find((p) => p.id === newPlanId);
    if (!plan) throw new Error(`Plan "${newPlanId}" not found`);

    if (sub.stripeSubscriptionId) {
      // Get current subscription items
      const current = await this.stripeRequest<{ items: { data: Array<{ id: string }> } }>(
        "GET", `/subscriptions/${sub.stripeSubscriptionId}`,
      );

      await this.stripeRequest("POST", `/subscriptions/${sub.stripeSubscriptionId}`, {
        items: { "0": { id: current.items.data[0].id, price: plan.stripePriceId } },
        proration_behavior: "create_prorations",
      });
    }

    sub.planId = newPlanId;
    return sub;
  }

  // ─── Usage Metering ───

  recordUsage(tenantId: string, metric: string, value: number): void {
    this.usageRecords.push({
      tenantId,
      metric,
      value,
      timestamp: new Date().toISOString(),
    });
  }

  getUsageSummary(tenantId: string, metric?: string, startDate?: string, endDate?: string): { metric: string; total: number }[] {
    const records = this.usageRecords.filter((r) => {
      if (r.tenantId !== tenantId) return false;
      if (metric && r.metric !== metric) return false;
      if (startDate && r.timestamp < startDate) return false;
      if (endDate && r.timestamp > endDate) return false;
      return true;
    });

    const summary = new Map<string, number>();
    for (const r of records) {
      summary.set(r.metric, (summary.get(r.metric) || 0) + r.value);
    }

    return Array.from(summary.entries()).map(([m, total]) => ({ metric: m, total }));
  }

  // ─── Invoice Management ───

  async getInvoices(tenantId: string): Promise<Invoice[]> {
    return this.invoices.get(tenantId) || [];
  }

  // ─── Webhook Handler ───

  handleWebhook(payload: string, signature: string): { received: boolean } {
    // Verify webhook signature
    if (this.stripeWebhookSecret) {
      const parts = signature.split(",");
      const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
      const sig = parts.find((p) => p.startsWith("v1="))?.slice(3);

      if (timestamp && sig) {
        const expected = crypto
          .createHmac("sha256", this.stripeWebhookSecret)
          .update(`${timestamp}.${payload}`)
          .digest("hex");

        if (sig !== expected) {
          throw new Error("Invalid webhook signature");
        }
      }
    }

    const event = JSON.parse(payload);

    switch (event.type) {
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subData = event.data.object;
        const tenantId = subData.metadata?.tenantId;
        if (tenantId) {
          const sub = this.subscriptions.get(tenantId);
          if (sub) {
            sub.status = subData.status;
            sub.cancelAtPeriodEnd = subData.cancel_at_period_end;
          }
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object;
        const tenantId = inv.subscription_details?.metadata?.tenantId || inv.metadata?.tenantId;
        if (tenantId) {
          const invoice: Invoice = {
            id: `inv_${crypto.randomBytes(8).toString("hex")}`,
            tenantId,
            stripeInvoiceId: inv.id,
            amount: inv.amount_paid || inv.amount_due,
            currency: inv.currency,
            status: inv.status,
            periodStart: new Date(inv.period_start * 1000).toISOString(),
            periodEnd: new Date(inv.period_end * 1000).toISOString(),
            pdfUrl: inv.invoice_pdf,
            createdAt: new Date().toISOString(),
          };

          const existing = this.invoices.get(tenantId) || [];
          existing.push(invoice);
          this.invoices.set(tenantId, existing);
        }
        break;
      }
    }

    return { received: true };
  }

  // ─── Checkout Session ───

  async createCheckoutSession(tenantId: string, planId: string, successUrl: string, cancelUrl: string): Promise<string> {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan || !plan.stripePriceId) throw new Error("Invalid plan for checkout");

    const session = await this.stripeRequest<{ url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      line_items: { "0": { price: plan.stripePriceId, quantity: "1" } },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenantId, planId },
    });

    return session.url;
  }

  // ─── Customer Portal ───

  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  // ─── Routes ───

  private setupRoutes(): void {
    // Get plans
    this.router.get("/plans", (_req: Request, res: Response) => {
      res.json(PLANS.map((p) => ({
        id: p.id, name: p.name, price: p.price, limits: p.limits,
      })));
    });

    // Get subscription
    this.router.get("/subscription/:tenantId", (req: Request, res: Response) => {
      const sub = this.subscriptions.get(req.params.tenantId);
      if (!sub) return res.status(404).json({ error: "No subscription found" });
      res.json(sub);
    });

    // Create checkout session
    this.router.post("/checkout", async (req: Request, res: Response) => {
      const { tenantId, planId, successUrl, cancelUrl } = req.body;
      try {
        const url = await this.createCheckoutSession(tenantId, planId, successUrl, cancelUrl);
        res.json({ url });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Cancel subscription
    this.router.post("/cancel/:tenantId", async (req: Request, res: Response) => {
      try {
        await this.cancelSubscription(req.params.tenantId, req.body.immediate);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Change plan
    this.router.post("/change-plan/:tenantId", async (req: Request, res: Response) => {
      try {
        const sub = await this.changePlan(req.params.tenantId, req.body.planId);
        res.json(sub);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Usage summary
    this.router.get("/usage/:tenantId", (req: Request, res: Response) => {
      const metric = req.query.metric as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      res.json(this.getUsageSummary(req.params.tenantId, metric, startDate, endDate));
    });

    // Invoices
    this.router.get("/invoices/:tenantId", async (req: Request, res: Response) => {
      const invoices = await this.getInvoices(req.params.tenantId);
      res.json(invoices);
    });

    // Stripe webhook
    this.router.post("/webhook", (req: Request, res: Response) => {
      try {
        const sig = req.headers["stripe-signature"] as string;
        const result = this.handleWebhook(JSON.stringify(req.body), sig || "");
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Customer portal
    this.router.post("/portal", async (req: Request, res: Response) => {
      const { customerId, returnUrl } = req.body;
      try {
        const url = await this.createPortalSession(customerId, returnUrl);
        res.json({ url });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }

  getRouter(): Router {
    return this.router;
  }

  getSubscription(tenantId: string): Subscription | undefined {
    return this.subscriptions.get(tenantId);
  }

  getPlan(planId: string): Plan | undefined {
    return PLANS.find((p) => p.id === planId);
  }

  getPlans(): Plan[] {
    return PLANS;
  }
}
