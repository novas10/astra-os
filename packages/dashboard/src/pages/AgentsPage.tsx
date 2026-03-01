import { useQuery } from "@tanstack/react-query";
import { Bot, Plus, Play, Pause, Trash2, Settings } from "lucide-react";
import { fetchAgents } from "../lib/api";

export default function AgentsPage() {
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-gray-500 mt-1">Manage your AI agent instances</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 bg-gray-800 rounded w-2/3 mb-4" />
              <div className="h-4 bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-4 bg-gray-800 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(agents || []).map((agent) => (
            <div key={agent.id} className="card hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-astra-600/20 rounded-lg flex items-center justify-center">
                    <Bot className="w-5 h-5 text-astra-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{agent.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">{agent.id}</p>
                  </div>
                </div>
                <span
                  className={
                    agent.status === "active" ? "badge-green" :
                    agent.status === "paused" ? "badge-yellow" : "badge-red"
                  }
                >
                  {agent.status}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Model</span>
                  <span className="text-white font-mono text-xs">{agent.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Channels</span>
                  <div className="flex gap-1">
                    {agent.channels.slice(0, 3).map((ch) => (
                      <span key={ch} className="badge-blue text-xs">{ch}</span>
                    ))}
                    {agent.channels.length > 3 && (
                      <span className="text-xs text-gray-500">+{agent.channels.length - 3}</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Skills</span>
                  <span className="text-white">{agent.skills.length}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-800">
                <button className="btn-secondary flex-1 flex items-center justify-center gap-1 text-xs py-1.5">
                  {agent.status === "active" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {agent.status === "active" ? "Pause" : "Resume"}
                </button>
                <button className="btn-secondary flex items-center justify-center gap-1 text-xs py-1.5 px-3">
                  <Settings className="w-3 h-3" />
                </button>
                <button className="btn-secondary flex items-center justify-center gap-1 text-xs py-1.5 px-3 text-red-400 hover:text-red-300">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}

          {(!agents || agents.length === 0) && (
            <div className="card col-span-full text-center py-12">
              <Bot className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400">No agents yet</h3>
              <p className="text-sm text-gray-500 mt-1">Create your first agent to get started</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
