import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Trash2, Search, RefreshCw } from "lucide-react";
import { useState } from "react";
import { fetchConversations, fetchSessions, deleteSession } from "../lib/api";

export default function ConversationsPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });

  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const filtered = (conversations || []).filter(
    (c) =>
      !search ||
      c.sessionId.toLowerCase().includes(search.toLowerCase()) ||
      c.channel.toLowerCase().includes(search.toLowerCase()),
  );

  const channelColor: Record<string, string> = {
    api: "badge-blue",
    websocket: "badge-green",
    telegram: "badge-blue",
    whatsapp: "badge-green",
    discord: "badge-blue",
    slack: "badge-yellow",
    a2a: "badge-blue",
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Conversations</h1>
          <p className="text-gray-500 mt-1">
            {sessions?.total ?? 0} active sessions across all channels
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["conversations"] })}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search by session ID or channel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Session</th>
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Channel</th>
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Last Active</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-48 animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-20 animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-gray-800 rounded w-32 animate-pulse" /></td>
                    <td className="px-6 py-4" />
                  </tr>
                ))
              : filtered.map((conv) => (
                  <tr key={conv.sessionId} className="hover:bg-gray-900/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-mono text-white">{conv.sessionId}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={channelColor[conv.channel] || "badge-blue"}>
                        {conv.channel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {conv.lastUsed ? new Date(conv.lastUsed).toLocaleString() : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => deleteMutation.mutate(conv.sessionId)}
                        className="text-red-400 hover:text-red-300 p-1"
                        title="Delete session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                  No conversations found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
