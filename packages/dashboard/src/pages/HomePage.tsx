import { useQuery } from "@tanstack/react-query";
import {
  Bot, MessageSquare, Zap, Clock, Cpu, HardDrive, Users, Activity,
  ArrowUpRight, Server, Shield,
} from "lucide-react";
import { fetchStats, fetchHealth, fetchMetrics } from "../lib/api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
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

export default function HomePage() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const { data: metrics } = useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics });

  const chartData = (metrics as { timeSeries?: Array<{ hour: string; requests: number; tokens: number }> })?.timeSeries ?? EMPTY_CHART_DATA;

  const statCards = [
    { label: "Active Agents", value: stats?.agents ?? "—", icon: Bot, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Live Sessions", value: stats?.activeSessions ?? "—", icon: MessageSquare, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Skills Loaded", value: stats?.skills ?? "—", icon: Zap, color: "text-yellow-400", bg: "bg-yellow-500/10" },
    { label: "Uptime", value: stats ? formatUptime(stats.uptime) : "—", icon: Clock, color: "text-purple-400", bg: "bg-purple-500/10" },
  ];

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 mt-1">
            AstraOS {health?.version ? `v${health.version}` : ""} — System Overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-green">
            <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse" />
            Operational
          </span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
              </div>
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request Volume */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Request Volume (24h)</h3>
            <Activity className="w-5 h-5 text-gray-500" />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5c7cfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#5c7cfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="hour" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Area type="monotone" dataKey="requests" stroke="#5c7cfa" fill="url(#colorReq)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Token Usage */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Token Usage (24h)</h3>
            <Cpu className="w-5 h-5 text-gray-500" />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="hour" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Bar dataKey="tokens" fill="#4c6ef5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* System Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channels */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-astra-500" /> Active Channels
          </h3>
          <div className="flex flex-wrap gap-2">
            {(stats?.channels || health?.channels || []).map((ch: string) => (
              <span key={ch} className="badge-blue">{ch}</span>
            ))}
          </div>
        </div>

        {/* Providers */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" /> LLM Providers
          </h3>
          <div className="flex flex-wrap gap-2">
            {(stats?.providers || health?.providers || []).map((p: string) => (
              <span key={p} className="badge-green">{p}</span>
            ))}
          </div>
        </div>

        {/* Memory */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-yellow-400" /> Memory Usage
          </h3>
          {stats?.memory ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">Heap Used</span>
                  <span className="text-white">{formatBytes(stats.memory.heapUsed)}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 rounded-full"
                    style={{ width: `${(stats.memory.heapUsed / stats.memory.heapTotal) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">RSS</span>
                <span className="text-white">{formatBytes(stats.memory.rss)}</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading...</p>
          )}
        </div>
      </div>

      {/* Protocols & Features */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-astra-400" /> Protocols & Features
        </h3>
        <div className="flex flex-wrap gap-2">
          {(health?.protocols || []).map((p: string) => (
            <span key={p} className="badge bg-astra-900/50 text-astra-400 border border-astra-800 uppercase text-xs">{p}</span>
          ))}
          {(health?.features || []).map((f: string) => (
            <span key={f} className="badge bg-gray-800 text-gray-300 border border-gray-700">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
