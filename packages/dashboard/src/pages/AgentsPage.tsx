import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Plus, Play, Pause, Trash2, Settings, X, Activity,
  Cpu, Zap, Clock, Search, BarChart3,
  ChevronDown, ChevronUp, Globe,
} from "lucide-react";
import { fetchAgents, createAgent, pauseAgent, resumeAgent, deleteAgent } from "../lib/api";

const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "Anthropic", color: "text-orange-400" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4", provider: "Anthropic", color: "text-orange-400" },
  { value: "gpt-4o", label: "GPT-4o", provider: "OpenAI", color: "text-green-400" },
  { value: "o3", label: "o3", provider: "OpenAI", color: "text-green-400" },
  { value: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro", provider: "Google", color: "text-blue-400" },
  { value: "llama3.1", label: "Llama 3.1 (Local)", provider: "Ollama", color: "text-purple-400" },
];

const CHANNEL_OPTIONS = ["REST", "WebSocket", "Telegram", "WhatsApp", "Discord", "Slack", "Teams", "WebChat"];

function getStatusColor(status: string) {
  switch (status) {
    case "active": return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400" };
    case "paused": return { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", dot: "bg-amber-400" };
    case "error": return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-400" };
    default: return { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30", dot: "bg-gray-400" };
  }
}

function getModelInfo(model: string) {
  return MODEL_OPTIONS.find((m) => m.value === model) || { label: model, provider: "Unknown", color: "text-gray-400" };
}

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [showCreate, setShowCreate] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", model: "claude-sonnet-4-20250514", systemPrompt: "", channels: ["REST", "WebSocket"] as string[] });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createAgent({ name: newAgent.name, model: newAgent.model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setShowCreate(false);
      setNewAgent({ name: "", model: "claude-sonnet-4-20250514", systemPrompt: "", channels: ["REST", "WebSocket"] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const agentList = agents || [];
  const filteredAgents = agentList.filter(
    (a) =>
      !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sortedAgents = [...filteredAgents].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "status") return a.status.localeCompare(b.status) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  const activeCount = agentList.filter((a) => a.status === "active").length;
  const pausedCount = agentList.filter((a) => a.status === "paused").length;

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-astra-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            Agents
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Manage and monitor your AI agent instances</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Agents", value: agentList.length, icon: Bot, color: "text-astra-400", bg: "bg-astra-500/10" },
          { label: "Active", value: activeCount, icon: Activity, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Paused", value: pausedCount, icon: Pause, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Total Skills", value: agentList.reduce((sum, a) => sum + (a.skills?.length || 0), 0), icon: Zap, color: "text-yellow-400", bg: "bg-yellow-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
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

      {/* Search + Sort */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search agents by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input w-full pl-10"
          />
        </div>
        <button onClick={() => toggleSort("name")} className="btn-secondary flex items-center gap-1 text-xs">
          Name {sortBy === "name" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
        <button onClick={() => toggleSort("status")} className="btn-secondary flex items-center gap-1 text-xs">
          Status {sortBy === "status" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
      </div>

      {/* Create Agent Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="card w-full max-w-lg mx-4 border-astra-600/50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-astra-400" /> Create New Agent
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Agent Name</label>
                <input
                  type="text"
                  value={newAgent.name}
                  onChange={(e) => setNewAgent((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g., Customer Support Bot"
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Model</label>
                <select
                  value={newAgent.model}
                  onChange={(e) => setNewAgent((s) => ({ ...s, model: e.target.value }))}
                  className="input w-full"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">System Prompt (optional)</label>
                <textarea
                  value={newAgent.systemPrompt}
                  onChange={(e) => setNewAgent((s) => ({ ...s, systemPrompt: e.target.value }))}
                  placeholder="You are a helpful assistant..."
                  rows={3}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Channels</label>
                <div className="flex flex-wrap gap-2">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <button
                      key={ch}
                      onClick={() =>
                        setNewAgent((s) => ({
                          ...s,
                          channels: s.channels.includes(ch)
                            ? s.channels.filter((c) => c !== ch)
                            : [...s.channels, ch],
                        }))
                      }
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        newAgent.channels.includes(ch)
                          ? "bg-astra-600/20 border-astra-500/50 text-astra-400"
                          : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:border-white/[0.08]"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!newAgent.name || createMutation.isPending}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {createMutation.isPending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Create Agent
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agents Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 bg-white/[0.04] rounded w-2/3 mb-4" />
              <div className="h-4 bg-white/[0.04] rounded w-1/2 mb-2" />
              <div className="h-4 bg-white/[0.04] rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAgents.map((agent) => {
            const sc = getStatusColor(agent.status);
            const modelInfo = getModelInfo(agent.model);
            const isExpanded = expandedAgent === agent.id;

            return (
              <div key={agent.id} className="card hover:border-white/[0.06] transition-all duration-200 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-astra-600/30 to-blue-600/30 rounded-lg flex items-center justify-center ring-1 ring-astra-500/20">
                      <Bot className="w-5 h-5 text-astra-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{agent.name}</h3>
                      <p className="text-xs text-gray-500 font-mono">{agent.id.slice(0, 12)}...</p>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${sc.bg} ${sc.text} border ${sc.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${agent.status === "active" ? "animate-pulse" : ""}`} />
                    {agent.status}
                  </span>
                </div>

                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> Model</span>
                    <span className={`font-mono text-xs ${modelInfo.color}`}>{modelInfo.label}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Channels</span>
                    <div className="flex gap-1">
                      {agent.channels.slice(0, 3).map((ch) => (
                        <span key={ch} className="text-xs bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">{ch}</span>
                      ))}
                      {agent.channels.length > 3 && <span className="text-xs text-gray-500">+{agent.channels.length - 3}</span>}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Skills</span>
                    <span className="text-white font-medium">{agent.skills?.length || 0}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white/[0.04] space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white/[0.03] rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Messages</p>
                        <p className="text-white font-bold text-lg">--</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Tokens Used</p>
                        <p className="text-white font-bold text-lg">--</p>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Created: {new Date().toLocaleDateString()}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-4 pt-4 border-t border-white/[0.04]">
                  <button
                    onClick={() => agent.status === "active" ? pauseMutation.mutate(agent.id) : resumeMutation.mutate(agent.id)}
                    disabled={pauseMutation.isPending || resumeMutation.isPending}
                    className="btn-secondary flex-1 flex items-center justify-center gap-1.5 text-xs py-2"
                  >
                    {agent.status === "active" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {agent.status === "active" ? "Pause" : "Resume"}
                  </button>
                  <button onClick={() => setExpandedAgent(isExpanded ? null : agent.id)} className="btn-secondary flex items-center justify-center text-xs py-2 px-3">
                    <BarChart3 className="w-3.5 h-3.5" />
                  </button>
                  <button className="btn-secondary flex items-center justify-center text-xs py-2 px-3">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(agent.id)}
                    disabled={deleteMutation.isPending}
                    className="btn-secondary flex items-center justify-center text-xs py-2 px-3 text-red-400 hover:text-red-300 hover:border-red-500/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {sortedAgents.length === 0 && !isLoading && (
            <div className="card col-span-full text-center py-16">
              <div className="w-16 h-16 bg-white/[0.04] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-gray-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-400">
                {searchQuery ? "No agents match your search" : "No agents yet"}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {searchQuery ? "Try a different search term" : "Create your first agent to get started"}
              </p>
              {!searchQuery && (
                <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create Agent
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
