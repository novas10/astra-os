import { useQuery } from "@tanstack/react-query";
import {
  Zap, Search, ArrowRight, Tag, Clock,
  Filter, Sparkles, Download,
} from "lucide-react";
import { useState } from "react";
import { fetchSkillsEcosystem, generateSkill, migrateFromClawHub } from "../lib/api";

const MOCK_CATEGORIES = [
  "All", "Productivity", "Data & Analytics", "Developer Tools",
  "Communication", "AI & ML", "Automation", "Security", "Integration",
];

const MOCK_SKILLS = [
  { name: "web-search", version: "1.4.0", category: "Productivity", description: "Search the web using multiple providers", triggers: ["search", "lookup", "find"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T18:00:00Z" },
  { name: "code-executor", version: "2.1.0", category: "Developer Tools", description: "Safe sandboxed code execution in multiple languages", triggers: ["run", "execute", "eval"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T17:30:00Z" },
  { name: "file-manager", version: "1.2.0", category: "Productivity", description: "Read, write, and manage files in the workspace", triggers: ["read", "write", "file"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T16:00:00Z" },
  { name: "sql-analyst", version: "1.0.3", category: "Data & Analytics", description: "Natural language to SQL with auto-visualization", triggers: ["query", "sql", "database"], source: "installed" as const, enabled: true, lastUsed: "2026-02-27T12:00:00Z" },
  { name: "jira-sync", version: "0.9.1", category: "Integration", description: "Bidirectional sync with Jira projects and issues", triggers: ["jira", "ticket", "issue"], source: "installed" as const, enabled: true, lastUsed: "2026-02-26T09:00:00Z" },
  { name: "email-composer", version: "1.1.0", category: "Communication", description: "AI-powered email drafting with conversation context", triggers: ["email", "draft", "compose"], source: "installed" as const, enabled: false, lastUsed: null },
  { name: "image-generator", version: "2.0.0", category: "AI & ML", description: "Generate images from text prompts via DALL-E / Stable Diffusion", triggers: ["generate image", "draw", "create image"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T14:00:00Z" },
  { name: "slack-notifier", version: "0.5.0", category: "Communication", description: "Send notifications and summaries to Slack channels", triggers: ["notify", "slack", "alert"], source: "workspace" as const, enabled: true, lastUsed: "2026-02-28T10:00:00Z" },
  { name: "csv-parser", version: "1.0.0", category: "Data & Analytics", description: "Parse and analyze CSV/Excel files with natural language", triggers: ["parse csv", "analyze data", "spreadsheet"], source: "workspace" as const, enabled: true, lastUsed: "2026-02-25T08:00:00Z" },
];

function getSourceStyle(source: string) {
  switch (source) {
    case "bundled": return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
    case "installed": return "bg-green-500/10 text-green-400 border border-green-500/30";
    case "workspace": return "bg-purple-500/10 text-purple-400 border border-purple-500/30";
    default: return "bg-gray-500/10 text-gray-400 border border-gray-500/30";
  }
}

export default function SkillsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [migrateInput, setMigrateInput] = useState("");

  const { data: ecosystem, isLoading } = useQuery({
    queryKey: ["skills-ecosystem"],
    queryFn: fetchSkillsEcosystem,
  });

  const skills = ecosystem?.skills ?? MOCK_SKILLS;
  const categories = ecosystem?.categories ?? MOCK_CATEGORIES;
  const stats = ecosystem?.stats ?? {
    bundled: MOCK_SKILLS.filter((s) => s.source === "bundled").length,
    installed: MOCK_SKILLS.filter((s) => s.source === "installed").length,
    workspace: MOCK_SKILLS.filter((s) => s.source === "workspace").length,
    total: MOCK_SKILLS.length,
  };

  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      !search ||
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategory === "All" || skill.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const statCards = [
    { label: "Total Skills", value: stats.total, color: "text-astra-400", bg: "bg-astra-500/10" },
    { label: "Bundled", value: stats.bundled, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Installed", value: stats.installed, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Workspace", value: stats.workspace, color: "text-purple-400", bg: "bg-purple-500/10" },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Skills</h1>
          <p className="text-gray-500 mt-1">Manage your skills ecosystem</p>
        </div>
        <button
          onClick={() => generateSkill("New skill")}
          className="btn-primary flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Generate Skill
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ label, value, color, bg }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
              </div>
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center`}>
                <Zap className={`w-6 h-6 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search skills by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-10"
          />
        </div>
      </div>

      {/* Categories Sidebar + Skills Grid */}
      <div className="flex gap-6">
        {/* Categories Sidebar */}
        <nav className="w-48 space-y-1 flex-shrink-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2 px-3 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Categories
          </p>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "text-white bg-astra-600/20 border-l-2 border-astra-500"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>

        {/* Skills Grid */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-6 bg-gray-800 rounded w-2/3 mb-4" />
                  <div className="h-4 bg-gray-800 rounded w-1/2 mb-2" />
                  <div className="h-4 bg-gray-800 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSkills.map((skill) => (
                <div key={skill.name} className="card hover:border-gray-700 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                        <Zap className="w-5 h-5 text-yellow-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{skill.name}</h3>
                        <p className="text-xs text-gray-500 font-mono">v{skill.version}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-md font-medium ${getSourceStyle(skill.source)}`}>
                      {skill.source}
                    </span>
                  </div>

                  <p className="text-sm text-gray-400 mb-3">{skill.description}</p>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-1">
                        <Tag className="w-3 h-3" /> Category
                      </span>
                      <span className="text-white">{skill.category}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Status</span>
                      <span className={skill.enabled ? "badge-green" : "badge-red"}>
                        {skill.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>

                  {/* Triggers */}
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-1.5">Triggers</p>
                    <div className="flex flex-wrap gap-1">
                      {skill.triggers.map((trigger) => (
                        <span key={trigger} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                          {trigger}
                        </span>
                      ))}
                    </div>
                  </div>

                  {skill.lastUsed && (
                    <p className="text-xs text-gray-600 mt-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last used: {new Date(skill.lastUsed).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}

              {filteredSkills.length === 0 && (
                <div className="card col-span-full text-center py-12">
                  <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-400">No skills found</h3>
                  <p className="text-sm text-gray-500 mt-1">Try a different search or category</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Migrate from ClawHub */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <Download className="w-5 h-5 text-astra-400" /> Migrate from ClawHub
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Import skills from ClawHub packages. Enter the package name to migrate.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g., @clawhub/weather-skill"
            value={migrateInput}
            onChange={(e) => setMigrateInput(e.target.value)}
            className="input flex-1"
          />
          <button
            onClick={() => {
              if (migrateInput.trim()) migrateFromClawHub(migrateInput.trim());
            }}
            className="btn-primary flex items-center gap-2"
          >
            <ArrowRight className="w-4 h-4" /> Migrate
          </button>
        </div>
      </div>
    </div>
  );
}
