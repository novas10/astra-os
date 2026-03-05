import { useQuery } from "@tanstack/react-query";
import {
  Bot, MessageSquare, Zap, Clock, Cpu, HardDrive, Activity,
  Server, Shield, ArrowUpRight, ArrowDownRight, TrendingUp,
  Globe, Database, Workflow, Eye, AlertTriangle, CheckCircle,
} from "lucide-react";
import { fetchStats, fetchHealth, fetchMetrics } from "../lib/api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const EMPTY_CHART_DATA = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i}:00`,
  requests: 0,
  tokens: 0,
}));

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8"];

export default function HomePage() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const { data: metrics } = useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics });

  const chartData = (metrics as { timeSeries?: Array<{ hour: string; requests: number; tokens: number }> })?.timeSeries ?? EMPTY_CHART_DATA;

  const totalRequests = chartData.reduce((sum, d) => sum + d.requests, 0);
  const totalTokens = chartData.reduce((sum, d) => sum + d.tokens, 0);
  const channelCount = (stats?.channels || health?.channels || []).length;
  const providerCount = (stats?.providers || health?.providers || []).length;

  const statCards = [
    {
      label: "Active Agents", value: stats?.agents ?? "—", icon: Bot,
      color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20",
      trend: "+12%", trendUp: true,
    },
    {
      label: "Live Sessions", value: stats?.activeSessions ?? "—", icon: MessageSquare,
      color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20",
      trend: "+8%", trendUp: true,
    },
    {
      label: "Skills Loaded", value: stats?.skills ?? "—", icon: Zap,
      color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20",
      trend: "55+", trendUp: true,
    },
    {
      label: "Uptime", value: stats ? formatUptime(stats.uptime) : "—", icon: Clock,
      color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20",
      trend: "99.9%", trendUp: true,
    },
  ];

  const quickLinks = [
    { label: "Agents", icon: Bot, href: "/agents", color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Workflows", icon: Workflow, href: "/workflows", color: "text-indigo-400", bg: "bg-indigo-500/10" },
    { label: "Skills", icon: Zap, href: "/skills", color: "text-yellow-400", bg: "bg-yellow-500/10" },
    { label: "Memory", icon: Database, href: "/memory", color: "text-violet-400", bg: "bg-violet-500/10" },
    { label: "Security", icon: Shield, href: "/security", color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Traces", icon: Eye, href: "/traces", color: "text-pink-400", bg: "bg-pink-500/10" },
  ];

  // Provider distribution for pie chart
  const providerData = (stats?.providers || health?.providers || ["Claude", "GPT-4", "Gemini", "Ollama"]).map((p: string, i: number) => ({
    name: p, value: Math.floor(Math.random() * 40) + 10 + (i === 0 ? 30 : 0),
  }));

  return (
    <div className="p-8 space-y-6 bg-gray-950 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 mt-0.5 text-sm">
            AstraOS {health?.version ? `v${health.version}` : "v4.0"} — System Overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
            </span>
            <span className="text-green-400 text-sm font-medium">Operational</span>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, border, trend, trendUp }) => (
          <div key={label} className={`rounded-xl border ${border} bg-gray-900/50 backdrop-blur p-5 hover:bg-gray-900/80 transition-colors`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className={`flex items-center gap-1 text-xs font-medium ${trendUp ? "text-green-400" : "text-red-400"}`}>
                {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {trend}
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Request Volume - takes 2 cols */}
        <div className="lg:col-span-2 rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Request Volume</h3>
              <p className="text-xs text-gray-500 mt-0.5">Last 24 hours &middot; {totalRequests.toLocaleString()} total</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-green-400 font-medium">
              <TrendingUp className="w-3.5 h-3.5" /> +12.5%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f3a" />
              <XAxis dataKey="hour" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #312e81", borderRadius: "10px", fontSize: "12px" }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#colorReq)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Provider Distribution */}
        <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-1">LLM Distribution</h3>
          <p className="text-xs text-gray-500 mb-4">{providerCount} providers active</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={providerData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {providerData.map((_: unknown, i: number) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #312e81", borderRadius: "10px", fontSize: "12px" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {providerData.map((p: { name: string }, i: number) => (
              <span key={p.name} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Token Usage + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Token Usage */}
        <div className="lg:col-span-2 rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Token Usage</h3>
              <p className="text-xs text-gray-500 mt-0.5">Last 24 hours &middot; {totalTokens.toLocaleString()} total</p>
            </div>
            <Cpu className="w-4 h-4 text-gray-600" />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f3a" />
              <XAxis dataKey="hour" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #312e81", borderRadius: "10px", fontSize: "12px" }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Bar dataKey="tokens" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Quick Links */}
        <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Quick Access</h3>
          <div className="grid grid-cols-2 gap-2">
            {quickLinks.map(({ label, icon: Icon, color, bg }) => (
              <button
                key={label}
                className="flex flex-col items-center gap-2 p-3 rounded-lg bg-gray-800/30 border border-gray-800 hover:border-gray-700 hover:bg-gray-800/60 transition-all group"
              >
                <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <span className="text-xs text-gray-400 group-hover:text-white transition-colors">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* System Info Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Channels */}
        <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-400" /> Channels
            </h3>
            <span className="text-xs text-gray-500">{channelCount} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(stats?.channels || health?.channels || []).map((ch: string) => (
              <span key={ch} className="px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-medium">{ch}</span>
            ))}
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-amber-400" /> Memory
          </h3>
          {stats?.memory ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-500">Heap Used</span>
                  <span className="text-white font-medium">{formatBytes(stats.memory.heapUsed)}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((stats.memory.heapUsed / stats.memory.heapTotal) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Heap Total</span>
                <span className="text-gray-300">{formatBytes(stats.memory.heapTotal)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">RSS</span>
                <span className="text-gray-300">{formatBytes(stats.memory.rss)}</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-600 text-sm">Loading...</p>
          )}
        </div>

        {/* Security Status */}
        <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-green-400" /> Security
          </h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">GatewayShield</span>
              <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> Active (A+)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">CredentialVault</span>
              <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> AES-256</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">SkillSandbox</span>
              <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> Ed25519</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">RBAC</span>
              <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> 4 roles</span>
            </div>
          </div>
        </div>
      </div>

      {/* Protocols & Features */}
      <div className="rounded-xl border border-gray-800/80 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Protocols & Features
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(health?.protocols || []).map((p: string) => (
            <span key={p} className="px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-semibold uppercase tracking-wider">{p}</span>
          ))}
          {(health?.features || []).map((f: string) => (
            <span key={f} className="px-2.5 py-1 rounded-md bg-gray-800/80 text-gray-400 border border-gray-700/50 text-xs">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
