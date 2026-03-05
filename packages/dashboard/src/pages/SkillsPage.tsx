import { useQuery } from "@tanstack/react-query";
import {
  Zap, Search, ArrowRight, Tag, Clock,
  Filter, Sparkles, Download, ToggleLeft, ToggleRight,
  Code, MessageSquare, BarChart3, Shield, Link, Brain,
  Terminal, Image, Mail,
} from "lucide-react";
import { useState } from "react";
import { fetchSkillsEcosystem, generateSkill, migrateFromClawHub } from "../lib/api";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "All": Zap,
  "Productivity": Terminal,
  "Data & Analytics": BarChart3,
  "Developer Tools": Code,
  "Communication": MessageSquare,
  "AI & ML": Brain,
  "Automation": Sparkles,
  "Security": Shield,
  "Integration": Link,
};

const MOCK_CATEGORIES = [
  "All", "Productivity", "Data & Analytics", "Developer Tools",
  "Communication", "AI & ML", "Automation", "Security", "Integration",
];

const MOCK_SKILLS = [
  { name: "web-search", version: "1.4.0", category: "Productivity", description: "Search the web using multiple providers (Brave, Google, DuckDuckGo)", triggers: ["search", "lookup", "find"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T18:00:00Z", usageCount: 1247 },
  { name: "code-executor", version: "2.1.0", category: "Developer Tools", description: "Safe sandboxed code execution in multiple languages (JS, Python, Bash)", triggers: ["run", "execute", "eval"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T17:30:00Z", usageCount: 892 },
  { name: "file-manager", version: "1.2.0", category: "Productivity", description: "Read, write, and manage files in the workspace", triggers: ["read", "write", "file"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T16:00:00Z", usageCount: 2103 },
  { name: "sql-analyst", version: "1.0.3", category: "Data & Analytics", description: "Natural language to SQL with auto-visualization and chart rendering", triggers: ["query", "sql", "database"], source: "installed" as const, enabled: true, lastUsed: "2026-02-27T12:00:00Z", usageCount: 456 },
  { name: "jira-sync", version: "0.9.1", category: "Integration", description: "Bidirectional sync with Jira projects, issues, and sprints", triggers: ["jira", "ticket", "issue"], source: "installed" as const, enabled: true, lastUsed: "2026-02-26T09:00:00Z", usageCount: 234 },
  { name: "email-composer", version: "1.1.0", category: "Communication", description: "AI-powered email drafting with tone control and templates", triggers: ["email", "draft", "compose"], source: "installed" as const, enabled: false, lastUsed: null, usageCount: 0 },
  { name: "image-generator", version: "2.0.0", category: "AI & ML", description: "Generate images from text prompts via DALL-E 3 / Stable Diffusion XL", triggers: ["generate image", "draw", "create image"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T14:00:00Z", usageCount: 567 },
  { name: "slack-notifier", version: "0.5.0", category: "Communication", description: "Send notifications, summaries, and alerts to Slack channels", triggers: ["notify", "slack", "alert"], source: "workspace" as const, enabled: true, lastUsed: "2026-02-28T10:00:00Z", usageCount: 789 },
  { name: "csv-parser", version: "1.0.0", category: "Data & Analytics", description: "Parse and analyze CSV/Excel files with natural language queries", triggers: ["parse csv", "analyze data", "spreadsheet"], source: "workspace" as const, enabled: true, lastUsed: "2026-02-25T08:00:00Z", usageCount: 123 },
  { name: "ai-search", version: "1.0.0", category: "AI & ML", description: "Perplexity-style AI search with source citations and follow-ups", triggers: ["research", "deep search", "investigate"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T19:00:00Z", usageCount: 1890 },
  { name: "screenshot", version: "1.0.0", category: "Automation", description: "Take screenshots of any URL and analyze with vision models", triggers: ["screenshot", "capture", "snapshot"], source: "bundled" as const, enabled: true, lastUsed: "2026-02-28T15:00:00Z", usageCount: 345 },
  { name: "security-scanner", version: "0.8.0", category: "Security", description: "Scan codebases and dependencies for vulnerabilities", triggers: ["scan", "audit", "vulnerability"], source: "installed" as const, enabled: true, lastUsed: "2026-02-27T08:00:00Z", usageCount: 67 },
];

function getSourceStyle(source: string) {
  switch (source) {
    case "bundled": return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", label: "Bundled" };
    case "installed": return { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30", label: "Installed" };
    case "workspace": return { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30", label: "Workspace" };
    default: return { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30", label: source };
  }
}

function getSkillIcon(category: string) {
  switch (category) {
    case "Developer Tools": return Code;
    case "Communication": return Mail;
    case "Data & Analytics": return BarChart3;
    case "AI & ML": return Brain;
    case "Security": return Shield;
    case "Integration": return Link;
    case "Automation": return Sparkles;
    default: return Zap;
  }
}

function getCategoryColor(category: string) {
  switch (category) {
    case "Developer Tools": return "text-cyan-400 bg-cyan-500/10";
    case "Communication": return "text-pink-400 bg-pink-500/10";
    case "Data & Analytics": return "text-emerald-400 bg-emerald-500/10";
    case "AI & ML": return "text-violet-400 bg-violet-500/10";
    case "Security": return "text-red-400 bg-red-500/10";
    case "Integration": return "text-orange-400 bg-orange-500/10";
    case "Automation": return "text-amber-400 bg-amber-500/10";
    default: return "text-yellow-400 bg-yellow-500/10";
  }
}

export default function SkillsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [migrateInput, setMigrateInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

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
    { label: "Total Skills", value: stats.total, icon: Zap, color: "text-astra-400", bg: "bg-astra-500/10", trend: "+3 this week" },
    { label: "Bundled", value: stats.bundled, icon: Sparkles, color: "text-blue-400", bg: "bg-blue-500/10", trend: "Core skills" },
    { label: "Installed", value: stats.installed, icon: Download, color: "text-green-400", bg: "bg-green-500/10", trend: "From marketplace" },
    { label: "Workspace", value: stats.workspace, icon: Terminal, color: "text-purple-400", bg: "bg-purple-500/10", trend: "Custom skills" },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            Skills
          </h1>
          <p className="text-gray-500 mt-1 ml-[52px]">Manage your skills ecosystem — {stats.total} skills loaded</p>
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
        {statCards.map(({ label, value, icon: Icon, color, bg, trend }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold text-white mt-1">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{trend}</p>
              </div>
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center`}>
                <Icon className={`w-6 h-6 ${color}`} />
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
            placeholder="Search skills by name, description, or trigger..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-10"
          />
        </div>
        <div className="flex bg-gray-800 rounded-lg border border-gray-700">
          <button onClick={() => setViewMode("grid")} className={`px-3 py-2 text-xs rounded-l-lg ${viewMode === "grid" ? "bg-astra-600/20 text-astra-400" : "text-gray-400"}`}>Grid</button>
          <button onClick={() => setViewMode("list")} className={`px-3 py-2 text-xs rounded-r-lg ${viewMode === "list" ? "bg-astra-600/20 text-astra-400" : "text-gray-400"}`}>List</button>
        </div>
      </div>

      {/* Categories Sidebar + Skills Grid */}
      <div className="flex gap-6">
        {/* Categories Sidebar */}
        <nav className="w-52 space-y-1 flex-shrink-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2 px-3 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Categories
          </p>
          {categories.map((cat) => {
            const CatIcon = CATEGORY_ICONS[cat] || Zap;
            const count = cat === "All" ? skills.length : skills.filter((s) => s.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? "text-white bg-astra-600/20 border-l-2 border-astra-500"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                }`}
              >
                <CatIcon className="w-4 h-4" />
                <span className="flex-1 text-left">{cat}</span>
                <span className="text-xs text-gray-500">{count}</span>
              </button>
            );
          })}
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
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-3"}>
              {filteredSkills.map((skill) => {
                const SkillIcon = getSkillIcon(skill.category);
                const catColor = getCategoryColor(skill.category);
                const srcStyle = getSourceStyle(skill.source);

                if (viewMode === "list") {
                  return (
                    <div key={skill.name} className="card hover:border-gray-700 transition-colors flex items-center gap-4 py-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${catColor.split(" ")[1]}`}>
                        <SkillIcon className={`w-5 h-5 ${catColor.split(" ")[0]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white">{skill.name}</h3>
                          <span className="text-xs text-gray-500 font-mono">v{skill.version}</span>
                        </div>
                        <p className="text-sm text-gray-400 truncate">{skill.description}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-md font-medium ${srcStyle.bg} ${srcStyle.text} border ${srcStyle.border}`}>
                        {srcStyle.label}
                      </span>
                      <span className={skill.enabled ? "badge-green" : "badge-red"}>{skill.enabled ? "On" : "Off"}</span>
                    </div>
                  );
                }

                return (
                  <div key={skill.name} className="card hover:border-gray-700 transition-colors group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${catColor.split(" ")[1]}`}>
                          <SkillIcon className={`w-5 h-5 ${catColor.split(" ")[0]}`} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-white">{skill.name}</h3>
                          <p className="text-xs text-gray-500 font-mono">v{skill.version}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-md font-medium ${srcStyle.bg} ${srcStyle.text} border ${srcStyle.border}`}>
                          {srcStyle.label}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-gray-400 mb-3">{skill.description}</p>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 flex items-center gap-1"><Tag className="w-3 h-3" /> Category</span>
                        <span className="text-white">{skill.category}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Status</span>
                        <div className="flex items-center gap-1.5">
                          {skill.enabled ? (
                            <ToggleRight className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-gray-500" />
                          )}
                          <span className={skill.enabled ? "text-emerald-400" : "text-gray-500"}>
                            {skill.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                      {"usageCount" in skill && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400 flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Usage</span>
                          <span className="text-white font-medium">{(skill as { usageCount: number }).usageCount.toLocaleString()} calls</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <p className="text-xs text-gray-500 mb-1.5">Triggers</p>
                      <div className="flex flex-wrap gap-1">
                        {skill.triggers.map((trigger) => (
                          <span key={trigger} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded border border-gray-700">
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
                );
              })}

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
