import { useState } from "react";
import {
  Brain, Search, Database, Network, FileText, Send,
  Trash2, RefreshCw, BarChart3, HardDrive, Layers, Eye,
} from "lucide-react";
import { searchMemory } from "../lib/api";

interface MemoryEntry {
  type: string;
  content: string;
  timestamp: string;
  source: string;
  score?: number;
}

const MOCK_STATS = {
  episodic: { entries: 2847, sizeKb: 1240 },
  semantic: { entries: 1563, sizeKb: 890 },
  vector: { entries: 945, sizeKb: 3200 },
  graph: { entities: 312, relationships: 876, communities: 24 },
};

export default function MemoryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"hybrid" | "semantic" | "keyword">("hybrid");
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "graph" | "stats">("search");

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await searchMemory(searchQuery, searchMode);
      const entries = res.results
        ? res.results.split("\n\n").filter(Boolean).map((content, i) => ({
            type: "search_result",
            content,
            timestamp: new Date().toISOString(),
            source: res.mode,
            score: 1 - i * 0.05,
          }))
        : [];
      setResults(entries.length > 0 ? entries : [{
        type: "search_result",
        content: "No results found for this query.",
        timestamp: new Date().toISOString(),
        source: searchMode,
      }]);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const memoryTiers = [
    { name: "Episodic (JSONL)", icon: FileText, description: "Conversation history and tool results", color: "text-blue-400", bg: "bg-blue-500/10", gradient: "from-blue-500/20 to-blue-600/5", entries: MOCK_STATS.episodic.entries, size: `${(MOCK_STATS.episodic.sizeKb / 1024).toFixed(1)} MB` },
    { name: "Semantic (FTS5)", icon: Database, description: "Full-text searchable long-term knowledge", color: "text-green-400", bg: "bg-green-500/10", gradient: "from-green-500/20 to-green-600/5", entries: MOCK_STATS.semantic.entries, size: `${(MOCK_STATS.semantic.sizeKb / 1024).toFixed(1)} MB` },
    { name: "Vector Embeddings", icon: Brain, description: "OpenAI / Ollama real vector embeddings", color: "text-purple-400", bg: "bg-purple-500/10", gradient: "from-purple-500/20 to-purple-600/5", entries: MOCK_STATS.vector.entries, size: `${(MOCK_STATS.vector.sizeKb / 1024).toFixed(1)} MB` },
    { name: "GraphRAG", icon: Network, description: "Entity-relationship knowledge graph", color: "text-yellow-400", bg: "bg-yellow-500/10", gradient: "from-yellow-500/20 to-yellow-600/5", entries: MOCK_STATS.graph.entities, size: `${MOCK_STATS.graph.relationships} rels` },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            Memory Inspector
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Explore the 3-tier hybrid memory system with GraphRAG</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Reindex
          </button>
          <button className="btn-secondary flex items-center gap-2 text-sm text-red-400 hover:text-red-300">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        </div>
      </div>

      {/* Memory Tiers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {memoryTiers.map(({ name, icon: Icon, description, color, bg, gradient, entries, size }) => (
          <div key={name} className={`stat-card bg-gradient-to-br ${gradient}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className="text-sm font-semibold text-white">{name}</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">{description}</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 flex items-center gap-1"><Layers className="w-3 h-3" /> {entries.toLocaleString()} entries</span>
              <span className="text-gray-500 flex items-center gap-1"><HardDrive className="w-3 h-3" /> {size}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] rounded-lg p-1 w-fit">
        {[
          { id: "search" as const, label: "Search", icon: Search },
          { id: "graph" as const, label: "Knowledge Graph", icon: Network },
          { id: "stats" as const, label: "Statistics", icon: BarChart3 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id
                ? "bg-astra-600/20 text-astra-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Search Tab */}
      {activeTab === "search" && (
        <>
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">Memory Search</h3>

            <div className="flex gap-4 mb-4">
              <div className="w-56">
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
              <div className="flex-1 flex items-end">
                <p className="text-xs text-gray-500">
                  {searchMode === "hybrid" && "Combines all three memory tiers for the most comprehensive results."}
                  {searchMode === "semantic" && "Uses vector embeddings for meaning-based similarity search."}
                  {searchMode === "keyword" && "Uses SQLite FTS5 for fast full-text keyword search."}
                </p>
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
                  placeholder="Search memory... (e.g., 'What did the user ask about deployments?')"
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

          {results.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4">
                Results ({results.length})
              </h3>
              <div className="space-y-3">
                {results.map((entry, i) => (
                  <div key={i} className="bg-white/[0.04] rounded-lg p-4 border border-white/[0.06] hover:border-white/[0.08] transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="badge-blue">{entry.source}</span>
                        {entry.score !== undefined && (
                          <div className="flex items-center gap-1">
                            <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-astra-500 to-blue-500 rounded-full"
                                style={{ width: `${Math.max(entry.score * 100, 10)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{(entry.score * 100).toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="text-gray-500 hover:text-white transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs text-gray-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{entry.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Knowledge Graph Tab */}
      {activeTab === "graph" && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Network className="w-5 h-5 text-yellow-400" /> Knowledge Graph
          </h3>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white/[0.03] rounded-lg p-4 text-center">
              <p className="text-lg font-bold text-white">{MOCK_STATS.graph.entities}</p>
              <p className="text-xs text-gray-400 mt-1">Entities</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-4 text-center">
              <p className="text-lg font-bold text-white">{MOCK_STATS.graph.relationships}</p>
              <p className="text-xs text-gray-400 mt-1">Relationships</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-4 text-center">
              <p className="text-lg font-bold text-white">{MOCK_STATS.graph.communities}</p>
              <p className="text-xs text-gray-400 mt-1">Communities</p>
            </div>
          </div>

          <div className="bg-white/[0.04] rounded-lg p-6 border border-white/[0.06]">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-yellow-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <Network className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <p className="text-gray-300 font-medium mb-1">GraphRAG Knowledge Graph</p>
                <p className="text-sm text-gray-400 mb-3">
                  The knowledge graph automatically builds entity-relationship connections from stored memories
                  using Louvain community detection. Entities, relationships, and communities are
                  discovered as you add data to the memory system.
                </p>
                <div className="flex gap-2">
                  <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded border border-yellow-500/20">Louvain Detection</span>
                  <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20">Entity Extraction</span>
                  <span className="text-xs bg-green-500/10 text-green-400 px-2 py-1 rounded border border-green-500/20">Auto-linking</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sample entities */}
          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-400 font-medium">Recent Entities</p>
            {["AstraOS", "Workflow Engine", "Telegram Bot", "GraphRAG", "Docker Sandbox", "SSO SAML"].map((entity, i) => (
              <div key={entity} className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]/50">
                <div className={`w-3 h-3 rounded-full ${["bg-blue-400", "bg-green-400", "bg-purple-400", "bg-yellow-400", "bg-cyan-400", "bg-orange-400"][i]}`} />
                <span className="text-sm text-white font-medium">{entity}</span>
                <span className="text-xs text-gray-500 ml-auto">{Math.floor(Math.random() * 20 + 3)} connections</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Statistics Tab */}
      {activeTab === "stats" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">Storage Breakdown</h3>
            <div className="space-y-4">
              {[
                { name: "Episodic", size: MOCK_STATS.episodic.sizeKb, color: "bg-blue-500", maxSize: 5120 },
                { name: "Semantic", size: MOCK_STATS.semantic.sizeKb, color: "bg-green-500", maxSize: 5120 },
                { name: "Vector", size: MOCK_STATS.vector.sizeKb, color: "bg-purple-500", maxSize: 10240 },
              ].map(({ name, size, color, maxSize }) => (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">{name}</span>
                    <span className="text-white">{(size / 1024).toFixed(1)} MB / {(maxSize / 1024).toFixed(0)} MB</span>
                  </div>
                  <div className="w-full h-2 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${(size / maxSize) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-4">Memory Activity</h3>
            <div className="space-y-3">
              {[
                { label: "Entries today", value: "47" },
                { label: "Searches today", value: "23" },
                { label: "Graph updates", value: "12" },
                { label: "Last reindex", value: "2h ago" },
                { label: "Avg search latency", value: "45ms" },
                { label: "Cache hit rate", value: "87%" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
