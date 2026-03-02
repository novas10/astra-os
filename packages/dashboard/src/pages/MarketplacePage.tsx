import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Search, Star, Download, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { fetchSkills, searchMarketplace, fetchInstalledMarketplace, installSkill } from "../lib/api";

const FEATURED_SKILLS = [
  { id: "weather-alerts", name: "Weather Alerts", description: "Real-time weather monitoring and severe weather notifications", author: "AstraOS Team", downloads: 12500, rating: 4.8, price: 0, verified: true, category: "productivity" },
  { id: "jira-sync", name: "Jira Sync", description: "Bidirectional sync between AstraOS and Jira projects", author: "DevTools Inc", downloads: 8900, rating: 4.6, price: 0, verified: true, category: "devtools" },
  { id: "sql-analyst", name: "SQL Analyst", description: "Natural language to SQL queries with auto-visualization", author: "DataPro", downloads: 15200, rating: 4.9, price: 9.99, verified: true, category: "data" },
  { id: "email-composer", name: "Email Composer", description: "AI-powered email drafting with context from conversations", author: "CommTools", downloads: 6700, rating: 4.4, price: 0, verified: false, category: "communication" },
  { id: "code-reviewer", name: "Code Reviewer", description: "Automated code review with security scanning and best practices", author: "AstraOS Team", downloads: 22100, rating: 4.7, price: 0, verified: true, category: "devtools" },
  { id: "slack-summarizer", name: "Slack Summarizer", description: "Daily summaries of Slack channels with action items", author: "CommTools", downloads: 9400, rating: 4.5, price: 4.99, verified: true, category: "communication" },
];

export default function MarketplacePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const { data: installedSkills } = useQuery({ queryKey: ["skills"], queryFn: fetchSkills });
  useQuery({ queryKey: ["marketplace-installed"], queryFn: fetchInstalledMarketplace });
  const { data: searchResults } = useQuery({
    queryKey: ["marketplace-search", search],
    queryFn: () => searchMarketplace(search || "featured"),
    enabled: true,
  });

  const installMutation = useMutation({
    mutationFn: installSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["marketplace-installed"] });
      setInstallingId(null);
    },
    onError: () => setInstallingId(null),
  });

  const marketplaceSkills = searchResults?.skills ?? FEATURED_SKILLS;

  const categories = [
    { id: null, name: "All", icon: "grid" },
    { id: "productivity", name: "Productivity", icon: "zap" },
    { id: "data", name: "Data & Analytics", icon: "bar-chart" },
    { id: "devtools", name: "Developer Tools", icon: "code" },
    { id: "communication", name: "Communication", icon: "message-circle" },
    { id: "ai", name: "AI & ML", icon: "brain" },
    { id: "automation", name: "Automation", icon: "repeat" },
  ];

  const filteredSkills = marketplaceSkills.filter((skill) => {
    const matchesSearch = !search || skill.name.toLowerCase().includes(search.toLowerCase()) || skill.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !activeCategory || ("category" in skill && skill.category === activeCategory);
    return matchesSearch && matchesCategory;
  });

  const installedNames = new Set((installedSkills || []).map((s) => s.name));

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Skills Marketplace</h1>
          <p className="text-gray-500 mt-1">
            Browse and install skills from AstraHub — {installedSkills?.length ?? 0} installed
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-2 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id ?? "all"}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeCategory === cat.id
                ? "bg-astra-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSkills.map((skill) => {
          const isInstalled = installedNames.has(skill.id);

          return (
            <div key={skill.id} className="card hover:border-gray-700 transition-colors group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-astra-500/20 to-astra-700/20 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5 text-astra-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{skill.name}</h3>
                      {skill.verified && (
                        <span title="Verified"><Check className="w-4 h-4 text-blue-400" /></span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">by {skill.author}</p>
                  </div>
                </div>
                {skill.price > 0 ? (
                  <span className="badge-yellow">${skill.price}</span>
                ) : (
                  <span className="badge-green">Free</span>
                )}
              </div>

              <p className="text-sm text-gray-400 mb-4 line-clamp-2">{skill.description}</p>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    {skill.rating}
                  </span>
                  <span className="flex items-center gap-1">
                    <Download className="w-3 h-3" />
                    {skill.downloads.toLocaleString()}
                  </span>
                </div>

                {isInstalled ? (
                  <span className="badge-green">Installed</span>
                ) : (
                  <button
                    onClick={() => {
                      setInstallingId(skill.id);
                      installMutation.mutate(skill.id);
                    }}
                    disabled={installingId === skill.id}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    {installingId === skill.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "Install"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredSkills.length === 0 && (
          <div className="card col-span-full text-center py-12">
            <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400">No skills found</h3>
            <p className="text-sm text-gray-500 mt-1">Try a different search or category</p>
          </div>
        )}
      </div>

      {/* Installed Skills */}
      {(installedSkills?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-xl font-bold text-white mb-4">Installed Skills</h2>
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Version</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-6 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {installedSkills!.map((skill) => (
                  <tr key={skill.name} className="hover:bg-gray-900/50">
                    <td className="px-6 py-4 text-sm font-medium text-white">{skill.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-400 font-mono">{skill.version}</td>
                    <td className="px-6 py-4">
                      <span className={skill.enabled ? "badge-green" : "badge-red"}>
                        {skill.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">{skill.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
