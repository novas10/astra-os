import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Search, RefreshCw, ChevronRight } from "lucide-react";
import { useState } from "react";
import { fetchTraces, fetchMetrics } from "../lib/api";

export default function TracesPage() {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const { data: traces, isLoading: tracesLoading } = useQuery({
    queryKey: ["traces", limit],
    queryFn: () => fetchTraces(limit),
  });

  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: fetchMetrics,
  });

  const filteredTraces = (traces || []).filter(
    (t: any) => !search || t.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const counters = (metrics as any)?.counters || {};
  const histograms = (metrics as any)?.histograms || {};

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Traces & Metrics</h1>
          <p className="text-gray-500 mt-1">OpenTelemetry-compatible observability</p>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(counters).map(([name, value]) => (
          <div key={name} className="stat-card">
            <p className="text-xs text-gray-400 truncate">{name}</p>
            <p className="text-2xl font-bold text-white mt-1">{String(value)}</p>
          </div>
        ))}
        {Object.keys(counters).length === 0 && (
          <>
            <div className="stat-card">
              <p className="text-xs text-gray-400">Total Requests</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-gray-400">Tool Calls</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-gray-400">Self-Heals</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-gray-400">Errors</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
          </>
        )}
      </div>

      {/* Histograms */}
      {Object.keys(histograms).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(histograms).map(([name, data]: [string, any]) => (
            <div key={name} className="card">
              <h4 className="text-sm font-medium text-gray-400 mb-2">{name}</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Count</p>
                  <p className="text-white font-medium">{data.count ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Avg</p>
                  <p className="text-white font-medium">{data.avg ? `${data.avg.toFixed(1)}ms` : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">P99</p>
                  <p className="text-white font-medium">{data.p99 ? `${data.p99.toFixed(1)}ms` : "—"}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Filter traces by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-10"
          />
        </div>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="input w-32"
        >
          <option value={25}>Last 25</option>
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
        </select>
      </div>

      {/* Traces Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Span</th>
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Duration</th>
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Time</th>
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Attributes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {tracesLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-40 animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-20 animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-32 animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-24 animate-pulse" /></td>
                  </tr>
                ))
              : filteredTraces.map((trace: any) => (
                  <tr key={trace.id} className="hover:bg-gray-900/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-astra-400" />
                        <span className="text-sm font-medium text-white">{trace.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-mono ${
                        trace.duration > 5000 ? "text-red-400" :
                        trace.duration > 1000 ? "text-yellow-400" : "text-green-400"
                      }`}>
                        {trace.duration > 1000 ? `${(trace.duration / 1000).toFixed(2)}s` : `${trace.duration}ms`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {new Date(trace.startTime).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(trace.attributes || {}).slice(0, 3).map(([k, v]) => (
                          <span key={k} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
            {!tracesLoading && filteredTraces.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                  No traces found. Traces appear when the agent processes requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
