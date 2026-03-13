import { useQuery } from "@tanstack/react-query";
import {
  Lock, Plus, Trash2, Search, Key, ShieldCheck, Clock,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import { fetchVaultStatus, fetchCredentials, fetchVaultAuditLog, addCredential, deleteCredential } from "../lib/api";

const MOCK_CREDENTIALS = [
  { id: "cred-001", name: "OpenAI API Key", service: "openai", maskedValue: "sk-...Xk9f", expiresAt: "2027-01-15T00:00:00Z", createdAt: "2025-06-01T10:00:00Z", lastUsed: "2026-02-28T18:00:00Z" },
  { id: "cred-002", name: "Anthropic API Key", service: "anthropic", maskedValue: "sk-ant-...m3Qz", expiresAt: null, createdAt: "2025-06-01T10:00:00Z", lastUsed: "2026-02-28T17:45:00Z" },
  { id: "cred-003", name: "Telegram Bot Token", service: "telegram", maskedValue: "7291...:AAF", expiresAt: null, createdAt: "2025-08-15T14:00:00Z", lastUsed: "2026-02-28T12:00:00Z" },
  { id: "cred-004", name: "Slack Bot Token", service: "slack", maskedValue: "xoxb-...9f2k", expiresAt: "2026-06-01T00:00:00Z", createdAt: "2025-09-20T08:00:00Z", lastUsed: "2026-02-27T09:30:00Z" },
  { id: "cred-005", name: "AWS Access Key", service: "aws", maskedValue: "AKIA...W7QF", expiresAt: "2026-12-31T00:00:00Z", createdAt: "2025-11-10T12:00:00Z", lastUsed: "2026-02-25T16:00:00Z" },
  { id: "cred-006", name: "GitHub PAT", service: "github", maskedValue: "ghp_...kL9m", expiresAt: "2026-08-01T00:00:00Z", createdAt: "2025-12-01T09:00:00Z", lastUsed: "2026-02-28T11:00:00Z" },
];

const MOCK_AUDIT_LOG = [
  { id: "log-001", action: "read", credentialName: "OpenAI API Key", actor: "agent:primary", timestamp: "2026-02-28T18:00:00Z", ip: "127.0.0.1" },
  { id: "log-002", action: "read", credentialName: "Anthropic API Key", actor: "agent:primary", timestamp: "2026-02-28T17:45:00Z", ip: "127.0.0.1" },
  { id: "log-003", action: "create", credentialName: "GitHub PAT", actor: "admin@astra-os.dev", timestamp: "2025-12-01T09:00:00Z", ip: "10.0.0.1" },
  { id: "log-004", action: "rotate", credentialName: "Slack Bot Token", actor: "admin@astra-os.dev", timestamp: "2026-02-20T14:00:00Z", ip: "10.0.0.1" },
  { id: "log-005", action: "read", credentialName: "Telegram Bot Token", actor: "agent:telegram-bot", timestamp: "2026-02-28T12:00:00Z", ip: "127.0.0.1" },
  { id: "log-006", action: "delete", credentialName: "Old Stripe Key", actor: "admin@astra-os.dev", timestamp: "2026-02-15T11:00:00Z", ip: "10.0.0.1" },
];

function getActionStyle(action: string) {
  switch (action) {
    case "create": return "bg-green-500/10 text-green-400 border border-green-500/30";
    case "read": return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
    case "rotate": return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30";
    case "delete": return "bg-red-500/10 text-red-400 border border-red-500/30";
    default: return "bg-gray-500/10 text-gray-400 border border-gray-500/30";
  }
}

export default function VaultPage() {
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCred, setNewCred] = useState({ name: "", service: "", value: "", expiresAt: "" });

  const { data: vaultStatus } = useQuery({
    queryKey: ["vault-status"],
    queryFn: fetchVaultStatus,
  });

  const { data: credentials, isLoading: credsLoading } = useQuery({
    queryKey: ["vault-credentials"],
    queryFn: fetchCredentials,
  });

  const { data: auditLog } = useQuery({
    queryKey: ["vault-audit"],
    queryFn: fetchVaultAuditLog,
  });

  const creds = credentials ?? MOCK_CREDENTIALS;
  const logs = auditLog ?? MOCK_AUDIT_LOG;
  const status = vaultStatus ?? { encrypted: true, keySource: "AES-256-GCM (env: VAULT_KEY)", totalCredentials: MOCK_CREDENTIALS.length, lastAccess: "2026-02-28T18:00:00Z" };

  const filteredCreds = creds.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.service.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAddCredential = async () => {
    if (!newCred.name || !newCred.service || !newCred.value) return;
    try {
      await addCredential({
        name: newCred.name,
        service: newCred.service,
        value: newCred.value,
        expiresAt: newCred.expiresAt || undefined,
      });
      setNewCred({ name: "", service: "", value: "", expiresAt: "" });
      setShowAddForm(false);
    } catch (err) {
      console.error("Failed to add credential:", err);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Vault</h1>
          <p className="text-gray-500 mt-1">Encrypted credential storage and access audit</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Credential
        </button>
      </div>

      {/* Vault Status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-green-400" />
            <p className="text-xs text-gray-400">Encryption</p>
          </div>
          <p className="text-lg font-bold text-white">
            {status.encrypted ? "AES-256-GCM" : "Not Encrypted"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {status.encrypted ? "Active" : "Warning"}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-yellow-400" />
            <p className="text-xs text-gray-400">Key Source</p>
          </div>
          <p className="text-sm font-bold text-white truncate" title={status.keySource}>
            {status.keySource}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-astra-400" />
            <p className="text-xs text-gray-400">Stored Credentials</p>
          </div>
          <p className="text-3xl font-bold text-white">{status.totalCredentials}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-purple-400" />
            <p className="text-xs text-gray-400">Last Access</p>
          </div>
          <p className="text-sm font-bold text-white">
            {new Date(status.lastAccess).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Add Credential Form */}
      {showAddForm && (
        <div className="card border border-astra-500/30">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Credential</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Name</label>
              <input
                type="text"
                placeholder="e.g., OpenAI API Key"
                value={newCred.name}
                onChange={(e) => setNewCred({ ...newCred, name: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Service</label>
              <input
                type="text"
                placeholder="e.g., openai"
                value={newCred.service}
                onChange={(e) => setNewCred({ ...newCred, service: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Value (Secret)</label>
              <input
                type="password"
                placeholder="Enter credential value"
                value={newCred.value}
                onChange={(e) => setNewCred({ ...newCred, value: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Expires At (optional)</label>
              <input
                type="date"
                value={newCred.expiresAt}
                onChange={(e) => setNewCred({ ...newCred, expiresAt: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAddCredential} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Save Credential
            </button>
            <button onClick={() => setShowAddForm(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search credentials by name or service..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {/* Credentials Table */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Stored Credentials</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left table-header">Name</th>
                <th className="text-left table-header">Service</th>
                <th className="text-left table-header">Value</th>
                <th className="text-left table-header">Expires</th>
                <th className="text-left table-header">Last Used</th>
                <th className="text-left table-header">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {credsLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-32 animate-pulse" /></td>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-20 animate-pulse" /></td>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-24 animate-pulse" /></td>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-24 animate-pulse" /></td>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-24 animate-pulse" /></td>
                      <td className="table-cell"><div className="h-4 bg-white/[0.04] rounded w-16 animate-pulse" /></td>
                    </tr>
                  ))
                : filteredCreds.map((cred) => (
                    <tr key={cred.id} className="table-row">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 text-astra-400" />
                          <span className="text-sm font-medium text-white">{cred.name}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="badge-blue text-xs">{cred.service}</span>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm font-mono text-gray-400">{cred.maskedValue}</span>
                      </td>
                      <td className="table-cell">
                        {cred.expiresAt ? (
                          <span className={`text-sm ${
                            new Date(cred.expiresAt) < new Date() ? "text-red-400" :
                            new Date(cred.expiresAt) < new Date(Date.now() + 90 * 86400000) ? "text-yellow-400" : "text-gray-400"
                          }`}>
                            {new Date(cred.expiresAt).toLocaleDateString()}
                            {new Date(cred.expiresAt) < new Date() && (
                              <AlertTriangle className="w-3 h-3 inline ml-1" />
                            )}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-500">No expiry</span>
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-400">
                        {cred.lastUsed ? new Date(cred.lastUsed).toLocaleDateString() : "Never"}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => deleteCredential(cred.id)}
                          className="btn-secondary text-xs py-1.5 px-3 text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              {!credsLoading && filteredCreds.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No credentials found. Add your first credential to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Access Audit Log */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Access Audit Log</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left table-header">Action</th>
                <th className="text-left table-header">Credential</th>
                <th className="text-left table-header">Actor</th>
                <th className="text-left table-header">Time</th>
                <th className="text-left table-header">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((log) => (
                <tr key={log.id} className="table-row">
                  <td className="table-cell">
                    <span className={`text-xs px-2 py-1 rounded-md font-medium ${getActionStyle(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-white">{log.credentialName}</td>
                  <td className="table-cell text-sm text-gray-400 font-mono">{log.actor}</td>
                  <td className="table-cell text-sm text-gray-400">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="table-cell text-sm text-gray-500 font-mono">{log.ip}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No audit log entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
