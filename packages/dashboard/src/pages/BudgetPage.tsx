import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, BarChart3, AlertTriangle, Coins, TrendingUp, Wallet,
  CheckCircle, XCircle, Clock, Info,
} from "lucide-react";
import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface AccountUsage {
  accountId: string;
  label: string;
  tokensUsed: number;
  cost: number;
  limit: number;
  model: string;
}

const MOCK_ACCOUNTS: AccountUsage[] = [
  { accountId: "acc-prod-01", label: "Production API", tokensUsed: 12_450_000, cost: 186.75, limit: 250.00, model: "claude-sonnet-4" },
  { accountId: "acc-dev-01", label: "Dev / Staging", tokensUsed: 3_210_000, cost: 48.15, limit: 100.00, model: "claude-sonnet-4" },
  { accountId: "acc-int-01", label: "Internal Agents", tokensUsed: 8_760_000, cost: 131.40, limit: 200.00, model: "claude-opus-4" },
  { accountId: "acc-test-01", label: "QA Automation", tokensUsed: 1_890_000, cost: 28.35, limit: 50.00, model: "gpt-4o" },
  { accountId: "acc-analytics", label: "Analytics Pipeline", tokensUsed: 5_430_000, cost: 81.45, limit: 150.00, model: "gemini-2.5-pro" },
  { accountId: "acc-sandbox", label: "Sandbox", tokensUsed: 420_000, cost: 6.30, limit: 25.00, model: "llama3.1" },
];

const MOCK_DAILY_USAGE = [
  { date: "Mar 1", tokens: 980_000, cost: 14.70 },
  { date: "Mar 2", tokens: 1_120_000, cost: 16.80 },
  { date: "Mar 3", tokens: 870_000, cost: 13.05 },
  { date: "Mar 4", tokens: 1_340_000, cost: 20.10 },
  { date: "Mar 5", tokens: 1_560_000, cost: 23.40 },
  { date: "Mar 6", tokens: 1_230_000, cost: 18.45 },
  { date: "Mar 7", tokens: 1_450_000, cost: 21.75 },
  { date: "Mar 8", tokens: 1_670_000, cost: 25.05 },
  { date: "Mar 9", tokens: 1_890_000, cost: 28.35 },
  { date: "Mar 10", tokens: 1_100_000, cost: 16.50 },
  { date: "Mar 11", tokens: 2_010_000, cost: 30.15 },
  { date: "Mar 12", tokens: 1_780_000, cost: 26.70 },
  { date: "Mar 13", tokens: 1_430_000, cost: 21.45 },
];

const MODEL_PRICING = [
  { model: "claude-opus-4", provider: "Anthropic", input: 15.00, output: 75.00 },
  { model: "claude-sonnet-4", provider: "Anthropic", input: 3.00, output: 15.00 },
  { model: "gpt-4o", provider: "OpenAI", input: 2.50, output: 10.00 },
  { model: "o3", provider: "OpenAI", input: 10.00, output: 40.00 },
  { model: "gemini-2.5-pro", provider: "Google", input: 1.25, output: 10.00 },
  { model: "gemini-2.5-flash", provider: "Google", input: 0.15, output: 0.60 },
  { model: "llama3.1 (local)", provider: "Ollama", input: 0, output: 0 },
];

const ALERT_THRESHOLDS = [
  { level: "80%", description: "Warning threshold — sends Slack & email notification", status: "ok" as const },
  { level: "90%", description: "Critical threshold — alerts on-call and pauses non-essential agents", status: "ok" as const },
  { level: "100%", description: "Hard limit — all requests rejected, incident auto-created", status: "ok" as const },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function getPercentColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-yellow-500";
  return "bg-emerald-500";
}

export default function BudgetPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const { data: budgetData } = useQuery({
    queryKey: ["budget", selectedPeriod],
    queryFn: () => Promise.resolve(null),
  });

  const accounts = (budgetData as AccountUsage[] | null) ?? MOCK_ACCOUNTS;
  const totalSpend = accounts.reduce((sum, a) => sum + a.cost, 0);
  const totalTokens = accounts.reduce((sum, a) => sum + a.tokensUsed, 0);
  const alertsFired = accounts.filter((a) => a.cost / a.limit >= 0.8).length;

  const statCards = [
    { label: "Total Spend", value: `$${totalSpend.toFixed(2)}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10", trend: "This billing cycle" },
    { label: "Tokens Used", value: formatTokens(totalTokens), icon: Coins, color: "text-blue-400", bg: "bg-blue-500/10", trend: `${MOCK_DAILY_USAGE.length} days tracked` },
    { label: "Active Accounts", value: accounts.length, icon: Wallet, color: "text-astra-400", bg: "bg-astra-500/10", trend: "Across all teams" },
    { label: "Alerts Fired", value: alertsFired, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", trend: alertsFired === 0 ? "All clear" : `${alertsFired} over 80%` },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            Budget & Usage
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Monitor token consumption, costs, and spending limits</p>
        </div>
        <div className="flex bg-white/[0.04] rounded-lg border border-white/[0.06]">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={`px-3 py-2 text-xs rounded-lg ${selectedPeriod === p ? "bg-astra-600/20 text-astra-400" : "text-gray-400"}`}
            >
              {p}
            </button>
          ))}
        </div>
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

      {/* Usage Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-astra-400" /> Daily Token Usage
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={MOCK_DAILY_USAGE} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 12 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0.5rem", color: "#fff" }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(value: number, name: string) => [name === "tokens" ? formatTokens(value) : `$${value.toFixed(2)}`, name === "tokens" ? "Tokens" : "Cost"]}
              />
              <Area type="monotone" dataKey="tokens" stroke="#8b5cf6" fill="url(#tokenGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-Account Table */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Per-Account Usage</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left table-header">Account</th>
                <th className="text-left table-header">Model</th>
                <th className="text-right table-header">Tokens Used</th>
                <th className="text-right table-header">Cost</th>
                <th className="text-right table-header">Limit</th>
                <th className="text-left table-header">% Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {accounts.map((account) => {
                const pct = Math.round((account.cost / account.limit) * 100);
                return (
                  <tr key={account.accountId} className="table-row">
                    <td className="table-cell">
                      <div>
                        <p className="text-sm font-medium text-white">{account.label}</p>
                        <p className="text-xs text-gray-500 font-mono">{account.accountId}</p>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-gray-400">{account.model}</td>
                    <td className="table-cell text-sm text-white text-right font-medium">{formatTokens(account.tokensUsed)}</td>
                    <td className="table-cell text-sm text-emerald-400 text-right font-medium">${account.cost.toFixed(2)}</td>
                    <td className="table-cell text-sm text-gray-400 text-right">${account.limit.toFixed(2)}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getPercentColor(pct)}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${pct >= 90 ? "text-red-400" : pct >= 75 ? "text-yellow-400" : "text-gray-400"}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert Thresholds + Model Pricing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alert Thresholds */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" /> Alert Thresholds
          </h3>
          <div className="space-y-3">
            {ALERT_THRESHOLDS.map((threshold) => (
              <div key={threshold.level} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                    <span className="text-sm font-bold text-amber-400">{threshold.level}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{threshold.level} Threshold</p>
                    <p className="text-xs text-gray-500">{threshold.description}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <CheckCircle className="w-3 h-3" />
                  OK
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Model Pricing Table */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-astra-400" /> Model Pricing
          </h3>
          <p className="text-xs text-gray-500 mb-3">Cost per 1K tokens (USD)</p>
          <div className="space-y-2">
            {MODEL_PRICING.map((m) => (
              <div key={m.model} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-3 border border-white/[0.06]">
                <div>
                  <p className="text-sm font-medium text-white">{m.model}</p>
                  <p className="text-xs text-gray-500">{m.provider}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right">
                    <p className="text-gray-500 text-xs">Input</p>
                    <p className="text-white font-medium">
                      {m.input === 0 ? "Free" : `$${m.input.toFixed(2)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-500 text-xs">Output</p>
                    <p className="text-white font-medium">
                      {m.output === 0 ? "Free" : `$${m.output.toFixed(2)}`}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          Budget data refreshes every 5 minutes. Costs are calculated based on provider pricing at the time of usage.
          Local models (Ollama) incur no token costs but consume compute resources.
        </p>
      </div>
    </div>
  );
}
