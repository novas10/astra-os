import { useQuery } from "@tanstack/react-query";
import {
  Puzzle, ToggleLeft, ToggleRight, Trash2, Plus, HeartPulse, Package,
  Search, Clock, Shield, Link, AlertTriangle, CheckCircle, XCircle,
} from "lucide-react";
import { useState } from "react";

interface Plugin {
  id: string;
  name: string;
  version: string;
  status: "active" | "disabled" | "error";
  health: "healthy" | "degraded" | "down";
  description: string;
  author: string;
  dependencies: string[];
  permissions: string[];
  hooks: string[];
  installedAt: string;
  lastHealthCheck: string;
  errorCount: number;
}

const MOCK_PLUGINS: Plugin[] = [
  { id: "plg-001", name: "astra-metrics-exporter", version: "2.3.1", status: "active", health: "healthy", description: "Export runtime metrics to Prometheus, Datadog, and Grafana Cloud", author: "AstraOS Core", dependencies: ["prom-client@15.1"], permissions: ["metrics:read", "config:read"], hooks: ["onRequest", "onResponse", "onError"], installedAt: "2025-11-10T08:00:00Z", lastHealthCheck: "2026-03-13T09:58:00Z", errorCount: 0 },
  { id: "plg-002", name: "redis-session-store", version: "1.1.0", status: "active", health: "healthy", description: "Persist sessions and cache in Redis with automatic TTL management", author: "AstraOS Core", dependencies: ["ioredis@5.3", "redis-semaphore@5.5"], permissions: ["sessions:write", "cache:write"], hooks: ["onSessionCreate", "onSessionDestroy"], installedAt: "2025-12-01T10:30:00Z", lastHealthCheck: "2026-03-13T09:58:00Z", errorCount: 0 },
  { id: "plg-003", name: "webhook-relay", version: "0.9.4", status: "active", health: "degraded", description: "Forward events to external webhook endpoints with retry logic and dead-letter queue", author: "community/kowsi", dependencies: ["got@14.0", "p-retry@6.2"], permissions: ["events:read", "network:outbound"], hooks: ["onEvent", "onAgentMessage"], installedAt: "2026-01-15T14:00:00Z", lastHealthCheck: "2026-03-13T09:57:00Z", errorCount: 3 },
  { id: "plg-004", name: "s3-backup-provider", version: "1.0.2", status: "active", health: "healthy", description: "Automated database and memory backups to AWS S3 with server-side encryption", author: "community/cloudops", dependencies: ["@aws-sdk/client-s3@3.500"], permissions: ["storage:read", "backup:write", "config:read"], hooks: ["onBackup", "onRestore"], installedAt: "2026-01-22T16:00:00Z", lastHealthCheck: "2026-03-13T09:58:00Z", errorCount: 0 },
  { id: "plg-005", name: "opentelemetry-tracer", version: "1.4.0", status: "active", health: "healthy", description: "Distributed tracing via OpenTelemetry SDK with Jaeger and Zipkin export", author: "AstraOS Core", dependencies: ["@opentelemetry/sdk-node@0.50", "@opentelemetry/exporter-jaeger@1.24"], permissions: ["traces:write", "config:read"], hooks: ["onRequest", "onToolCall", "onLLMCall"], installedAt: "2025-10-05T12:00:00Z", lastHealthCheck: "2026-03-13T09:58:00Z", errorCount: 0 },
  { id: "plg-006", name: "slack-audit-logger", version: "0.7.1", status: "disabled", health: "healthy", description: "Stream audit log entries to a designated Slack channel in real time", author: "community/secops", dependencies: ["@slack/web-api@7.0"], permissions: ["audit:read", "network:outbound"], hooks: ["onAuditEvent"], installedAt: "2026-02-10T09:00:00Z", lastHealthCheck: "2026-03-13T09:55:00Z", errorCount: 0 },
  { id: "plg-007", name: "custom-auth-provider", version: "0.3.0", status: "error", health: "down", description: "LDAP / Active Directory authentication bridge for enterprise environments", author: "community/enterprise", dependencies: ["ldapjs@3.0"], permissions: ["auth:write", "users:read"], hooks: ["onLogin", "onTokenRefresh"], installedAt: "2026-02-28T11:00:00Z", lastHealthCheck: "2026-03-13T09:50:00Z", errorCount: 42 },
  { id: "plg-008", name: "rate-limit-redis", version: "1.2.0", status: "active", health: "healthy", description: "Distributed rate limiting with Redis sliding window counters", author: "AstraOS Core", dependencies: ["ioredis@5.3", "rate-limiter-flexible@5.0"], permissions: ["rateLimit:write", "config:read"], hooks: ["onRequest"], installedAt: "2025-11-20T07:00:00Z", lastHealthCheck: "2026-03-13T09:58:00Z", errorCount: 0 },
];

function getStatusStyle(status: Plugin["status"]) {
  switch (status) {
    case "active": return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", label: "Active" };
    case "disabled": return { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30", label: "Disabled" };
    case "error": return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", label: "Error" };
  }
}

function getHealthIcon(health: Plugin["health"]) {
  switch (health) {
    case "healthy": return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    case "degraded": return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    case "down": return <XCircle className="w-4 h-4 text-red-400" />;
  }
}

export default function PluginsPage() {
  const [search, setSearch] = useState("");
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installInput, setInstallInput] = useState("");

  const { data: pluginData } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => Promise.resolve(null),
  });

  const plugins = (pluginData as Plugin[] | null) ?? MOCK_PLUGINS;
  const activeCount = plugins.filter((p) => p.status === "active").length;
  const disabledCount = plugins.filter((p) => p.status === "disabled").length;
  const healthyCount = plugins.filter((p) => p.health === "healthy").length;

  const filtered = plugins.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  const statCards = [
    { label: "Total Plugins", value: plugins.length, icon: Package, color: "text-astra-400", bg: "bg-astra-500/10", trend: `${plugins.length} installed` },
    { label: "Active", value: activeCount, icon: Puzzle, color: "text-emerald-400", bg: "bg-emerald-500/10", trend: "Running normally" },
    { label: "Disabled", value: disabledCount, icon: ToggleLeft, color: "text-gray-400", bg: "bg-gray-500/10", trend: "Manually paused" },
    { label: "Health", value: `${healthyCount}/${plugins.length}`, icon: HeartPulse, color: "text-rose-400", bg: "bg-rose-500/10", trend: healthyCount === plugins.length ? "All healthy" : "Issues detected" },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-astra-500 to-violet-600 rounded-xl flex items-center justify-center">
              <Puzzle className="w-5 h-5 text-white" />
            </div>
            Plugins
            <span className="text-xs px-2 py-1 rounded-full bg-astra-500/10 text-astra-400 border border-astra-500/30 font-medium">
              {plugins.length} installed
            </span>
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Manage runtime plugins and extensions</p>
        </div>
        <button
          onClick={() => setShowInstallModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Install Plugin
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, trend }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{trend}</p>
              </div>
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search plugins by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {/* Plugin Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((plugin) => {
          const statusStyle = getStatusStyle(plugin.status);
          return (
            <div key={plugin.id} className="card hover:border-white/[0.06] transition-colors group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-astra-500/10">
                    <Puzzle className="w-5 h-5 text-astra-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{plugin.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">v{plugin.version}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getHealthIcon(plugin.health)}
                  <span className={`text-xs px-2 py-1 rounded-md font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
                    {statusStyle.label}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-400 mb-3">{plugin.description}</p>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center gap-1"><Package className="w-3 h-3" /> Author</span>
                  <span className="text-white">{plugin.author}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center gap-1"><Link className="w-3 h-3" /> Dependencies</span>
                  <span className="text-white">{plugin.dependencies.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center gap-1"><Shield className="w-3 h-3" /> Permissions</span>
                  <span className="text-white">{plugin.permissions.length}</span>
                </div>
                {plugin.errorCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Errors</span>
                    <span className="text-red-400 font-medium">{plugin.errorCount}</span>
                  </div>
                )}
              </div>

              {/* Dependencies */}
              <div className="mt-3 pt-3 border-t border-white/[0.04]">
                <p className="text-xs text-gray-500 mb-1.5">Dependencies</p>
                <div className="flex flex-wrap gap-1">
                  {plugin.dependencies.map((dep) => (
                    <span key={dep} className="text-xs bg-white/[0.04] text-gray-400 px-2 py-0.5 rounded border border-white/[0.06]">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>

              {/* Hooks */}
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1.5">Hooks registered</p>
                <div className="flex flex-wrap gap-1">
                  {plugin.hooks.map((hook) => (
                    <span key={hook} className="text-xs bg-astra-500/10 text-astra-400 px-2 py-0.5 rounded border border-astra-500/20">
                      {hook}
                    </span>
                  ))}
                </div>
              </div>

              {/* Permissions */}
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1.5">Permissions</p>
                <div className="flex flex-wrap gap-1">
                  {plugin.permissions.map((perm) => (
                    <span key={perm} className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
                      {perm}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                <p className="text-xs text-gray-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Installed: {new Date(plugin.installedAt).toLocaleDateString()}
                </p>
                <div className="flex items-center gap-2">
                  <button className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors border border-white/[0.06]">
                    {plugin.status === "active" ? (
                      <><ToggleRight className="w-3.5 h-3.5 text-emerald-400" /> Disable</>
                    ) : (
                      <><ToggleLeft className="w-3.5 h-3.5" /> Enable</>
                    )}
                  </button>
                  <button className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20">
                    <Trash2 className="w-3.5 h-3.5" /> Uninstall
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="card col-span-full text-center py-12">
            <Puzzle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400">No plugins found</h3>
            <p className="text-sm text-gray-500 mt-1">Try a different search term</p>
          </div>
        )}
      </div>

      {/* Install Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-lg mx-4">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <Plus className="w-5 h-5 text-astra-400" /> Install Plugin
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Enter the plugin package name or registry URL to install.
            </p>
            <input
              type="text"
              placeholder="e.g., @astra/plugin-analytics or https://registry.astra-os.dev/plugin"
              value={installInput}
              onChange={(e) => setInstallInput(e.target.value)}
              className="input w-full mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowInstallModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowInstallModal(false); setInstallInput(""); }}
                className="btn-primary flex items-center gap-2"
              >
                <Package className="w-4 h-4" /> Install
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
