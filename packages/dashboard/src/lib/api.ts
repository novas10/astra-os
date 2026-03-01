/**
 * AstraOS Dashboard — API Client
 */

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("astra_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { ...headers, ...options?.headers } });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ─── Health & Stats ───

export const fetchHealth = () => request<{
  status: string;
  version: string;
  uptime: number;
  providers: string[];
  skills: number;
  agents: number;
  channels: string[];
  protocols: string[];
  features: string[];
  activeSessions: number;
  tenants: number;
}>("/health".replace("/api", ""), { headers: {} }).catch(() =>
  fetch("/health").then((r) => r.json()),
);

export const fetchStats = () => request<{
  agents: number;
  activeSessions: number;
  skills: number;
  channels: string[];
  providers: string[];
  protocols: string[];
  uptime: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  metrics: Record<string, unknown>;
}>("/admin/stats");

// ─── Sessions ───

export const fetchSessions = () => request<{
  total: number;
  sessions: Array<{ sessionId: string; lastUsed: string; ageMinutes: number }>;
}>("/admin/sessions");

export const deleteSession = (id: string) =>
  request(`/admin/sessions/${id}`, { method: "DELETE" });

// ─── Conversations ───

export const fetchConversations = () =>
  request<Array<{ sessionId: string; channel: string; lastUsed: string | null }>>("/admin/conversations");

// ─── Agents ───

export const fetchAgents = () =>
  request<Array<{
    id: string;
    name: string;
    model: string;
    channels: string[];
    skills: string[];
    status: string;
    createdAt: number;
  }>>("/agents");

export const fetchAgentStats = () => request<Record<string, unknown>>("/agents/stats");

// ─── Skills ───

export const fetchSkills = () =>
  request<Array<{ name: string; version: string; description: string; enabled: boolean }>>("/skills");

export const installSkill = (name: string) =>
  request<{ success: boolean }>("/skills/install", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

// ─── Marketplace ───

export const searchMarketplace = (query: string, category?: string) => {
  const params = new URLSearchParams({ q: query });
  if (category) params.set("category", category);
  return request<{
    skills: Array<{
      id: string; name: string; version: string; description: string;
      author: string; downloads: number; rating: number; price: number; verified: boolean;
    }>;
    total: number;
  }>(`/marketplace/search?${params}`);
};

export const fetchMarketplaceCategories = () =>
  request<Array<{ id: string; name: string; icon: string }>>("/marketplace/categories");

export const fetchInstalledMarketplace = () =>
  request<Array<{ skillId: string; name: string; version: string; installedAt: string }>>("/marketplace/installed");

// ─── Metrics & Traces ───

export const fetchMetrics = () => request<Record<string, unknown>>("/metrics");

export const fetchTraces = (limit = 50) =>
  request<Array<{
    id: string; name: string; duration: number;
    startTime: number; attributes: Record<string, unknown>;
  }>>(`/traces?limit=${limit}`);

// ─── Auth ───

export const login = (apiKey: string) =>
  request<{ token: string; user: { id: string; email: string; name: string; role: string }; expiresIn: number }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ apiKey }) },
  );

export const fetchCurrentUser = () =>
  request<{ id: string; email: string; name: string; role: string; tenantId: string }>("/auth/me");

export const fetchUsers = () =>
  request<Array<{ id: string; email: string; name: string; role: string; active: boolean; createdAt: string }>>(
    "/auth/users",
  );

// ─── Tenants ───

export const fetchTenants = () =>
  request<Array<{
    id: string; name: string; plan: string; active: boolean;
    usage: { messagesToday: number; messagesThisMonth: number; tokensThisMonth: number; activeAgents: number };
    settings: { maxAgents: number; maxMessagesPerDay: number };
  }>>("/admin/tenants");

// ─── Security ───

export const fetchSecurityOverview = () =>
  request<{
    grade: string;
    score: number;
    protections: Array<{ name: string; description: string; status: "active" | "warning" | "inactive" }>;
    blockedIps: Array<{ ip: string; reason: string; blockedAt: string; expiresAt: string | null }>;
    events: Array<{ id: string; type: string; severity: "low" | "medium" | "high" | "critical"; message: string; timestamp: string; source: string }>;
    exposureCheck: { status: "passed" | "warning" | "failed"; lastChecked: string; findings: number };
  }>("/admin/security/overview");

export const fetchBlockedIps = () =>
  request<Array<{ ip: string; reason: string; blockedAt: string; expiresAt: string | null }>>("/admin/security/blocked-ips");

export const blockIp = (ip: string, reason: string) =>
  request<{ success: boolean }>("/admin/security/block-ip", {
    method: "POST",
    body: JSON.stringify({ ip, reason }),
  });

export const unblockIp = (ip: string) =>
  request<{ success: boolean }>(`/admin/security/unblock-ip`, {
    method: "POST",
    body: JSON.stringify({ ip }),
  });

// ─── Skills Ecosystem ───

export const fetchSkillsEcosystem = () =>
  request<{
    stats: { bundled: number; installed: number; workspace: number; total: number };
    skills: Array<{
      name: string; version: string; category: string; description: string;
      triggers: string[]; source: "bundled" | "installed" | "workspace";
      enabled: boolean; lastUsed: string | null;
    }>;
    categories: string[];
  }>("/skills/ecosystem");

export const generateSkill = (prompt: string) =>
  request<{ success: boolean; skillName: string; path: string }>("/skills/generate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

export const migrateFromClawHub = (packageName: string) =>
  request<{ success: boolean; migrated: string[] }>("/skills/migrate/clawhub", {
    method: "POST",
    body: JSON.stringify({ packageName }),
  });

// ─── Vault ───

export const fetchVaultStatus = () =>
  request<{
    encrypted: boolean;
    keySource: string;
    totalCredentials: number;
    lastAccess: string;
  }>("/vault/status");

export const fetchCredentials = () =>
  request<Array<{
    id: string; name: string; service: string; maskedValue: string;
    expiresAt: string | null; createdAt: string; lastUsed: string | null;
  }>>("/vault/credentials");

export const addCredential = (data: { name: string; service: string; value: string; expiresAt?: string }) =>
  request<{ success: boolean; id: string }>("/vault/credentials", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteCredential = (id: string) =>
  request<{ success: boolean }>(`/vault/credentials/${id}`, { method: "DELETE" });

export const fetchVaultAuditLog = () =>
  request<Array<{
    id: string; action: string; credentialName: string;
    actor: string; timestamp: string; ip: string;
  }>>("/vault/audit-log");

// ─── Chat ───

export const sendMessage = (message: string, userId = "dashboard", sessionId?: string) =>
  request<{
    response: string;
    sessionId: string;
    iterations: number;
    toolsUsed: string[];
    healed: boolean;
  }>("/chat", {
    method: "POST",
    body: JSON.stringify({ message, userId, sessionId }),
  });

// ─── Agent CRUD ───

export const getAgent = (id: string) =>
  request<{ id: string; name: string; model: string; status: string; channels: string[]; skills: string[] }>(`/agents/${id}`);

export const createAgent = (data: { name: string; model?: string; systemPrompt?: string }) =>
  request<{ id: string; name: string }>("/agents", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const pauseAgent = (id: string) =>
  request<{ success: boolean }>(`/agents/${id}/pause`, { method: "POST" });

export const resumeAgent = (id: string) =>
  request<{ success: boolean }>(`/agents/${id}/resume`, { method: "POST" });

export const deleteAgent = (id: string) =>
  request<{ success: boolean }>(`/agents/${id}`, { method: "DELETE" });

// ─── Workflow CRUD ───

export const fetchWorkflows = () =>
  request<Array<{ id: string; name: string; description: string; version: string; nodes: unknown[]; entryNode: string }>>("/workflows");

export const getWorkflow = (id: string) =>
  request<{ id: string; name: string; description: string; version: string; nodes: unknown[]; entryNode: string }>(`/workflows/${id}`);

export const saveWorkflow = (definition: Record<string, unknown>) =>
  request<{ success: boolean; id: string }>("/workflows", {
    method: "POST",
    body: JSON.stringify(definition),
  });

export const runWorkflow = (id: string, variables?: Record<string, unknown>) =>
  request<{ id: string; workflowId: string; status: string; history: unknown[] }>(`/workflows/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ variables }),
  });

export const deleteWorkflow = (id: string) =>
  request<{ success: boolean }>(`/workflows/${id}`, { method: "DELETE" });

// ─── Settings ───

export const fetchSettings = () =>
  request<{
    defaultModel: string;
    maxAgents: number;
    sessionTtl: number;
    maxSessions: number;
    providers: string[];
    features: { sso: boolean; billing: boolean; dataResidency: boolean };
  }>("/admin/settings");

export const updateSettings = (settings: Record<string, unknown>) =>
  request<{ success: boolean; note: string }>("/admin/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });

// ─── Security Scan ───

export const runSecurityScan = () =>
  request<Record<string, unknown>>("/admin/security/scan", { method: "POST" });

// ─── Memory Search ───

export const searchMemory = (query: string, mode: "keyword" | "semantic" | "hybrid" = "hybrid", topK = 10) => {
  const params = new URLSearchParams({ q: query, mode, topK: String(topK) });
  return request<{ query: string; mode: string; results: string }>(`/memory/search?${params}`);
};
