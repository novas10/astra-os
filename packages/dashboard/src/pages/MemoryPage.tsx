import { useState } from "react";
import { Brain, Search, Database, Network, FileText, Send } from "lucide-react";
import { sendMessage } from "../lib/api";

interface MemoryEntry {
  type: string;
  content: string;
  timestamp: string;
  source: string;
  score?: number;
}

export default function MemoryPage() {
  const [userId, setUserId] = useState("demo");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"hybrid" | "semantic" | "keyword">("hybrid");
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await sendMessage(
        `Search my memory for: "${searchQuery}" using ${searchMode} search mode. Return the results in a structured format.`,
        userId,
      );
      // Parse results from agent response
      setResults([
        {
          type: "search_result",
          content: res.response,
          timestamp: new Date().toISOString(),
          source: searchMode,
          score: 1.0,
        },
      ]);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const memoryTiers = [
    { name: "Episodic (JSONL)", icon: FileText, description: "Conversation history and tool results", color: "text-blue-400", bg: "bg-blue-500/10" },
    { name: "Semantic (FTS5)", icon: Database, description: "Full-text searchable long-term knowledge", color: "text-green-400", bg: "bg-green-500/10" },
    { name: "Vector Embeddings", icon: Brain, description: "OpenAI / Ollama real vector embeddings", color: "text-purple-400", bg: "bg-purple-500/10" },
    { name: "GraphRAG", icon: Network, description: "Entity-relationship knowledge graph", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  ];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Memory Inspector</h1>
        <p className="text-gray-500 mt-1">Explore the 3-tier hybrid memory system with GraphRAG</p>
      </div>

      {/* Memory Tiers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {memoryTiers.map(({ name, icon: Icon, description, color, bg }) => (
          <div key={name} className="stat-card">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className="text-sm font-semibold text-white">{name}</h3>
            </div>
            <p className="text-xs text-gray-400">{description}</p>
          </div>
        ))}
      </div>

      {/* Search Controls */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Memory Search</h3>

        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">User ID</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="input w-full"
              placeholder="User ID"
            />
          </div>
          <div className="w-48">
            <label className="text-xs text-gray-400 block mb-1">Search Mode</label>
            <select
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value as typeof searchMode)}
              className="input w-full"
            >
              <option value="hybrid">Hybrid (FTS5 + Vector + Graph)</option>
              <option value="semantic">Semantic (Vector)</option>
              <option value="keyword">Keyword (FTS5)</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search memory..."
              className="input w-full pl-10"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="btn-primary flex items-center gap-2"
          >
            {isSearching ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">
            Results ({results.length})
          </h3>
          <div className="space-y-3">
            {results.map((entry, i) => (
              <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="badge-blue">{entry.source}</span>
                    {entry.score !== undefined && (
                      <span className="text-xs text-gray-500">Score: {entry.score.toFixed(3)}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{entry.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge Graph Visualization Placeholder */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-yellow-400" /> Knowledge Graph
        </h3>
        <div className="h-64 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
          <div className="text-center">
            <Network className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">Knowledge Graph Visualization</p>
            <p className="text-sm text-gray-500 mt-1">Entity-relationship graph rendered here</p>
            <p className="text-xs text-gray-600 mt-2">Entities, relationships, and communities from GraphRAG</p>
          </div>
        </div>
      </div>
    </div>
  );
}
