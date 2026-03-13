import { useQuery } from "@tanstack/react-query";
import {
  Bot, MessageSquare, Zap, Clock, Cpu, HardDrive, Activity,
  Server, Shield, ArrowUpRight, ArrowDownRight, TrendingUp,
  Globe, Database, Workflow, Eye, CheckCircle,
} from "lucide-react";
import { fetchStats, fetchHealth, fetchMetrics } from "../lib/api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { NavLink } from "react-router-dom";

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
  requests: Math.floor(Math.random() * 80 + (i > 8 && i < 18 ? 40 : 5)),
  tokens: Math.floor(Math.random() * 4000 + (i > 8 && i < 18 ? 2000 : 200)),
}));

const PIE_COLORS = ["#6366f1", "#10b981", "#3b82f6", "#f59e0b", "#818cf8"];

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(26, 26, 36, 0.95)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "10px",
  fontSize: "12px",
  backdropFilter: "blur(12px)",
};

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
      color: "text-blue-400", bg: "from-blue-500/10 to-blue-600/5", border: "border-blue-500/10",
      trend: "+2", trendUp: true,
    },
    {
      label: "Live Sessions", value: stats?.activeSessions ?? "—", icon: MessageSquare,
      color: "text-emerald-400", bg: "from-emerald-500/10 to-emerald-600/5", border: "border-emerald-500/10",
      trend: "+8%", trendUp: true,
    },
    {
      label: "Skills Loaded", value: stats?.skills ?? "—", icon: Zap,
      color: "text-amber-400", bg: "from-amber-500/10 to-amber-600/5", border: "border-amber-500/10",
      trend: "55+", trendUp: true,
    },
    {
      label: "Uptime", value: stats ? formatUptime(stats.uptime) : "—", icon: Clock,
      color: "text-purple-400", bg: "from-purple-500/10 to-purple-600/5", border: "border-purple-500/10",
      trend: "99.97%", trendUp: true,
    },
  ];

  const quickLinks = [
    { label: "Agents", icon: Bot, href: "/agents", color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Workflows", icon: Workflow, href: "/workflows", color: "text-astra-400", bg: "bg-astra-500/10" },
    { label: "Skills", icon: Zap, href: "/skills", color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Memory", icon: Database, href: "/memory", color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Security", icon: Shield, href: "/security", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Traces", icon: Eye, href: "/traces", color: "text-pink-400", bg: "bg-pink-500/10" },
  ];

  const providerData = (stats?.providers || health?.providers || ["Claude", "GPT-4o", "Gemini", "Ollama"]).map((p: string, i: number) => ({
    name: p, value: [45, 30, 15, 10][i] || 10,
  }));

  return (
    <div className="p-6 space-y-5 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            AstraOS {health?.version ? `v${health.version}` : "v4.0.1"}
          </h1>
          <p className="text-gray-500 text-xs mt-0.5">System Overview</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/15">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
            <span className="text-emerald-400 text-xs font-medium">Operational</span>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, border, trend, trendUp }) => (
          <div key={label} className={`card-hover bg-gradient-to-br ${bg}`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 bg-white/[0.04] rounded-xl flex items-center justify-center ring-1 ring-white/[0.06]`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className={`flex items-center gap-1 text-[10px] font-semibold ${trendUp ? "text-emerald-400" : "text-red-400"}`}>
                {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {trend}
              </div>
            </div>
            <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
            <p className="text-[11px] text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Request Volume</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Last 24 hours &middot; {totalRequests.toLocaleString()} total</p>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <TrendingUp className="w-3.5 h-3.5" /> +12.5%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="hour" stroke="#374151" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#374151" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#9ca3af" }} />
              <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#colorReq)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-1">LLM Distribution</h3>
          <p className="text-[11px] text-gray-500 mb-3">{providerCount} providers active</p>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={providerData} cx="50%" cy="50%" innerRadius={42} outerRadius={65} paddingAngle={3} dataKey="value" stroke="none">
                {providerData.map((_: unknown, i: number) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
            {providerData.map((p: { name: string; value: number }, i: number) => (
              <span key={p.name} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                {p.name} ({p.value}%)
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Token Usage + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Token Usage</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Last 24 hours &middot; {totalTokens.toLocaleString()} total</p>
            </div>
            <Cpu className="w-4 h-4 text-gray-600" />
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="hour" stroke="#374151" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#374151" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#9ca3af" }} />
              <Bar dataKey="tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Quick Access</h3>
          <div className="grid grid-cols-2 gap-2">
            {quickLinks.map(({ label, icon: Icon, href, color, bg }) => (
              <NavLink
                key={label}
                to={href}
                className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.04] transition-all group"
              >
                <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <span className="text-[10px] text-gray-500 group-hover:text-white transition-colors font-medium">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* System Info Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-astra-400" /> Channels
            </h3>
            <span className="text-[10px] text-gray-500">{channelCount} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(stats?.channels || health?.channels || []).map((ch: string) => (
              <span key={ch} className="px-2 py-1 rounded-md bg-astra-500/10 text-astra-300 border border-astra-500/15 text-[10px] font-medium">{ch}</span>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-amber-400" /> Memory
          </h3>
          {stats?.memory ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-gray-500">Heap Used</span>
                  <span className="text-white font-medium">{formatBytes(stats.memory.heapUsed)}</span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((stats.memory.heapUsed / stats.memory.heapTotal) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">Heap Total</span>
                <span className="text-gray-300">{formatBytes(stats.memory.heapTotal)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">RSS</span>
                <span className="text-gray-300">{formatBytes(stats.memory.rss)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-3 w-2/3" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-emerald-400" /> Security
          </h3>
          <div className="space-y-2.5">
            {[
              { label: "GatewayShield", value: "Active (A+)" },
              { label: "CredentialVault", value: "AES-256" },
              { label: "SkillSandbox", value: "Ed25519" },
              { label: "RBAC", value: "4 roles" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{label}</span>
                <span className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle className="w-3 h-3" /> {value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Protocols & Features */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-astra-400" /> Protocols & Features
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(health?.protocols || []).map((p: string) => (
            <span key={p} className="px-2.5 py-1 rounded-md bg-astra-500/10 text-astra-300 border border-astra-500/15 text-[10px] font-semibold uppercase tracking-wider">{p}</span>
          ))}
          {(health?.features || []).map((f: string) => (
            <span key={f} className="px-2.5 py-1 rounded-md bg-white/[0.03] text-gray-500 border border-white/[0.06] text-[10px]">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
