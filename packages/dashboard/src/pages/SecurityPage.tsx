import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, ShieldCheck, ShieldAlert, Ban, Clock,
  AlertTriangle, CheckCircle, XCircle, Eye, RefreshCw, Info,
} from "lucide-react";
import { fetchSecurityOverview, runSecurityScan } from "../lib/api";

const MOCK_PROTECTIONS = [
  { name: "CSRF Protection", description: "Cross-site request forgery tokens on all state-changing endpoints", status: "active" as const },
  { name: "Brute Force Guard", description: "Rate-limited login attempts with exponential backoff", status: "active" as const },
  { name: "Token Guard", description: "JWT rotation, short-lived access tokens, secure refresh flow", status: "active" as const },
  { name: "Path Traversal Block", description: "path.resolve() + startsWith() sandbox enforcement", status: "active" as const },
  { name: "XSS Prevention", description: "HTML sanitization + Content-Security-Policy headers", status: "active" as const },
  { name: "SQL Injection Shield", description: "Parameterized queries, no raw SQL concatenation", status: "active" as const },
  { name: "Rate Limiter", description: "Sliding window, per-IP, 60 req/min default", status: "active" as const },
  { name: "CORS Policy", description: "Strict origin allowlist, no wildcard in production", status: "warning" as const },
];

const MOCK_BLOCKED_IPS = [
  { ip: "192.168.1.100", reason: "Brute force attempt (15 failed logins)", blockedAt: "2026-02-28T14:22:00Z", expiresAt: "2026-03-01T14:22:00Z" },
  { ip: "10.0.0.55", reason: "SQL injection attempt detected", blockedAt: "2026-02-27T09:15:00Z", expiresAt: null },
  { ip: "172.16.0.200", reason: "Path traversal attack", blockedAt: "2026-02-26T18:45:00Z", expiresAt: null },
  { ip: "203.0.113.42", reason: "Excessive rate limit violations", blockedAt: "2026-02-28T20:10:00Z", expiresAt: "2026-03-02T20:10:00Z" },
];

const MOCK_EVENTS = [
  { id: "evt-001", type: "auth_failure", severity: "medium" as const, message: "Failed login attempt from 192.168.1.100 (attempt 15/15)", timestamp: "2026-02-28T14:22:00Z", source: "auth" },
  { id: "evt-002", type: "ip_blocked", severity: "high" as const, message: "IP 10.0.0.55 blocked: SQL injection pattern detected in /api/agents", timestamp: "2026-02-27T09:15:00Z", source: "waf" },
  { id: "evt-003", type: "token_rotated", severity: "low" as const, message: "JWT signing key rotated successfully", timestamp: "2026-02-27T00:00:00Z", source: "auth" },
  { id: "evt-004", type: "path_traversal", severity: "critical" as const, message: "Path traversal blocked: ../../etc/passwd in sandbox exec", timestamp: "2026-02-26T18:45:00Z", source: "sandbox" },
  { id: "evt-005", type: "rate_limit", severity: "medium" as const, message: "Rate limit exceeded for IP 203.0.113.42 (120 req/min)", timestamp: "2026-02-28T20:10:00Z", source: "rate-limiter" },
  { id: "evt-006", type: "exposure_scan", severity: "low" as const, message: "Exposure scan completed: 0 findings", timestamp: "2026-02-28T06:00:00Z", source: "scanner" },
];

function getGradeColor(grade: string) {
  if (grade.startsWith("A")) return { text: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" };
  if (grade.startsWith("B")) return { text: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" };
  if (grade.startsWith("C")) return { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" };
  return { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
}

function getSeverityStyle(severity: string) {
  switch (severity) {
    case "critical": return "bg-red-500/10 text-red-400 border border-red-500/30";
    case "high": return "bg-orange-500/10 text-orange-400 border border-orange-500/30";
    case "medium": return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30";
    default: return "bg-green-500/10 text-green-400 border border-green-500/30";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "active": return <CheckCircle className="w-4 h-4 text-green-400" />;
    case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    default: return <XCircle className="w-4 h-4 text-red-400" />;
  }
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const { data: overview } = useQuery({
    queryKey: ["security-overview"],
    queryFn: fetchSecurityOverview,
  });

  const scanMutation = useMutation({
    mutationFn: runSecurityScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security-overview"] }),
  });

  const usingMockData = !overview;
  const grade = overview?.grade ?? "A+";
  const score = overview?.score ?? 97;
  const protections = overview?.protections ?? MOCK_PROTECTIONS;
  const blockedIps = overview?.blockedIps ?? MOCK_BLOCKED_IPS;
  const events = overview?.events ?? MOCK_EVENTS;
  const exposureCheck = overview?.exposureCheck ?? { status: "passed" as const, lastChecked: "2026-02-28T06:00:00Z", findings: 0 };

  const gradeColors = getGradeColor(grade);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Security</h1>
          <p className="text-gray-500 mt-1">Security posture, protections, and event monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          {usingMockData && (
            <span className="badge-yellow flex items-center gap-1">
              <Info className="w-3 h-3" /> Demo Data
            </span>
          )}
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="btn-secondary flex items-center gap-2"
          >
            {scanMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {scanMutation.isPending ? "Scanning..." : "Run Scan"}
          </button>
        </div>
      </div>

      {/* Top Row: Grade + Exposure Check */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Security Grade Card */}
        <div className={`card ${gradeColors.border} border`}>
          <div className="flex items-center gap-4">
            <div className={`w-20 h-20 ${gradeColors.bg} rounded-2xl flex items-center justify-center`}>
              <span className={`text-4xl font-black ${gradeColors.text}`}>{grade}</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Security Grade</h3>
              <p className="text-sm text-gray-400 mt-1">Score: {score}/100</p>
              <div className="mt-2 h-2 w-40 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${grade.startsWith("A") ? "bg-green-500" : grade.startsWith("B") ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <p className="text-xs text-gray-400">Active</p>
            </div>
            <p className="text-lg font-bold text-white">
              {protections.filter((p) => p.status === "active").length}
            </p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-4 h-4 text-yellow-400" />
              <p className="text-xs text-gray-400">Warnings</p>
            </div>
            <p className="text-lg font-bold text-white">
              {protections.filter((p) => p.status === "warning").length}
            </p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <Ban className="w-4 h-4 text-red-400" />
              <p className="text-xs text-gray-400">Blocked IPs</p>
            </div>
            <p className="text-lg font-bold text-white">{blockedIps.length}</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <p className="text-xs text-gray-400">Events (24h)</p>
            </div>
            <p className="text-lg font-bold text-white">{events.length}</p>
          </div>
        </div>

        {/* Exposure Check */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-astra-400" /> Exposure Check
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Status</span>
              <span className={
                exposureCheck.status === "passed" ? "badge-green" :
                exposureCheck.status === "warning" ? "badge-yellow" : "badge-red"
              }>
                {exposureCheck.status === "passed" ? "Passed" : exposureCheck.status === "warning" ? "Warning" : "Failed"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Findings</span>
              <span className="text-sm text-white font-medium">{exposureCheck.findings}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Last Checked</span>
              <span className="text-sm text-gray-300">
                {new Date(exposureCheck.lastChecked).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Protections */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-astra-400" /> Active Protections
        </h3>
        <div className="space-y-2">
          {protections.map((protection) => (
            <div
              key={protection.name}
              className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(protection.status)}
                <div>
                  <p className="text-sm font-medium text-white">{protection.name}</p>
                  <p className="text-xs text-gray-500">{protection.description}</p>
                </div>
              </div>
              <span className={
                protection.status === "active" ? "badge-green" :
                protection.status === "warning" ? "badge-yellow" : "badge-red"
              }>
                {protection.status.charAt(0).toUpperCase() + protection.status.slice(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Blocked IPs Table */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Blocked IPs</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left table-header">IP Address</th>
                <th className="text-left table-header">Reason</th>
                <th className="text-left table-header">Blocked At</th>
                <th className="text-left table-header">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {blockedIps.map((entry) => (
                <tr key={entry.ip} className="table-row">
                  <td className="table-cell">
                    <span className="text-sm font-mono text-red-400">{entry.ip}</span>
                  </td>
                  <td className="table-cell text-sm text-gray-400">{entry.reason}</td>
                  <td className="table-cell text-sm text-gray-400">
                    {new Date(entry.blockedAt).toLocaleString()}
                  </td>
                  <td className="table-cell">
                    {entry.expiresAt ? (
                      <span className="text-sm text-yellow-400">
                        {new Date(entry.expiresAt).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-sm text-red-400">Permanent</span>
                    )}
                  </td>
                </tr>
              ))}
              {blockedIps.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    No blocked IPs. All clear.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Security Events */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Recent Security Events</h2>
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="card flex items-start gap-4 py-4">
              <div className={`mt-0.5 px-2 py-1 rounded text-xs font-medium ${getSeverityStyle(event.severity)}`}>
                {event.severity}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white">{event.message}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    Source: {event.source}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="card text-center py-12">
              <ShieldCheck className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400">No recent events</h3>
              <p className="text-sm text-gray-500 mt-1">Your system is secure</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
