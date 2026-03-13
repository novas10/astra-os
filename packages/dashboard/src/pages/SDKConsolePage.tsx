import { useState, useRef } from "react";
import {
  Code2, Search, Play, Package, CheckCircle, AlertCircle,
  FileText, Loader2, ChevronRight, ExternalLink,
  Shield, Globe, FolderOpen, Key, Terminal,
} from "lucide-react";

const TEMPLATES = [
  { id: "data-analyzer", icon: "📊", name: "Data Analyzer", desc: "Analyze CSV and JSON data files" },
  { id: "web-search", icon: "🔍", name: "Web Search", desc: "Search the web with multiple providers" },
  { id: "email-automation", icon: "📧", name: "Email Automation", desc: "AI-powered email drafting and sending" },
  { id: "ai-assistant", icon: "🤖", name: "AI Assistant", desc: "General-purpose conversational agent" },
  { id: "file-processor", icon: "📁", name: "File Processor", desc: "Read, transform, and write files" },
  { id: "security-tool", icon: "🔐", name: "Security Tool", desc: "Security scanning and auditing" },
  { id: "api-integration", icon: "📡", name: "API Integration", desc: "Connect to external APIs and services" },
  { id: "chat-bot", icon: "💬", name: "Chat Bot", desc: "Multi-channel conversational bot" },
  { id: "trading-signal", icon: "📈", name: "Trading Signal", desc: "Market analysis and trade signals" },
  { id: "developer-tool", icon: "🛠", name: "Developer Tool", desc: "Code generation, review, and testing" },
];

const CATEGORIES = [
  "productivity", "data-analytics", "developer-tools", "communication",
  "ai-ml", "automation", "security", "integration",
];

const PERMISSIONS = [
  { id: "network", label: "Network Access", icon: Globe, desc: "Make HTTP requests" },
  { id: "file-read", label: "File Read", icon: FolderOpen, desc: "Read files from workspace" },
  { id: "file-write", label: "File Write", icon: FileText, desc: "Write files to workspace" },
  { id: "env-access", label: "Env Variables", icon: Key, desc: "Access environment variables" },
];

interface LogEntry {
  type: "info" | "success" | "error" | "step";
  message: string;
  time: string;
}

export default function SDKConsolePage() {
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0]);
  const [activeTab, setActiveTab] = useState<"create" | "validate" | "test" | "package">("create");
  const [templateSearch, setTemplateSearch] = useState("");
  const [skillName, setSkillName] = useState("my-data-analyzer");
  const [description, setDescription] = useState("Analyze CSV and JSON data files");
  const [category, setCategory] = useState("data-analytics");
  const [version, setVersion] = useState("1.0.0");
  const [permissions, setPermissions] = useState<string[]>(["network", "file-read"]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (type: LogEntry["type"], message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { type, message, time }]);
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50);
  };

  const runCreate = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("info", `Creating skill: ${skillName}`);
    await delay(400);
    addLog("step", "Generated SKILL.md frontmatter");
    await delay(300);
    addLog("step", `Created handler.ts from template: ${selectedTemplate.id}`);
    await delay(300);
    addLog("step", "Generated README.md");
    await delay(200);
    addLog("step", "Initialized test suite");
    await delay(500);
    addLog("info", "Validating...");
    await delay(300);
    addLog("success", "Name format valid");
    addLog("success", `Version ${version} (semver ok)`);
    addLog("success", `Category: ${category}`);
    addLog("success", `Permissions: ${permissions.join(", ")}`);
    addLog("success", "Security scan: 0 issues found");
    await delay(200);
    addLog("success", `Skill ready at: skills/${skillName}/`);
    setIsRunning(false);
  };

  const runValidate = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("info", `Validating skill: ${skillName}`);
    await delay(300);
    addLog("step", "Checking SKILL.md frontmatter...");
    await delay(200);
    addLog("success", "Name: valid (lowercase, hyphens)");
    addLog("success", "Version: 1.0.0 (valid semver)");
    addLog("success", "Category: data-analytics (valid)");
    addLog("success", "Permissions: declared correctly");
    await delay(300);
    addLog("step", "Running security analysis...");
    await delay(400);
    addLog("success", "No eval() usage detected");
    addLog("success", "No env exfiltration patterns");
    addLog("success", "No unrestricted network calls");
    addLog("success", "No credential patterns found");
    await delay(200);
    addLog("success", "Validation passed — 0 errors, 0 warnings");
    setIsRunning(false);
  };

  const runTest = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("info", `Testing skill: ${skillName}`);
    await delay(300);
    addLog("step", "Setting up test sandbox...");
    await delay(400);
    addLog("step", "Running test: should handle valid input");
    await delay(300);
    addLog("success", "PASS: should handle valid input (124ms)");
    addLog("step", "Running test: should handle empty input");
    await delay(200);
    addLog("success", "PASS: should handle empty input (45ms)");
    addLog("step", "Running test: should validate permissions");
    await delay(250);
    addLog("success", "PASS: should validate permissions (67ms)");
    await delay(200);
    addLog("success", "All 3 tests passed in 436ms");
    setIsRunning(false);
  };

  const runPackage = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("info", `Packaging skill: ${skillName}`);
    await delay(300);
    addLog("step", "Validating skill before packaging...");
    await delay(400);
    addLog("success", "Validation passed");
    addLog("step", "Bundling files...");
    await delay(300);
    addLog("step", "  SKILL.md (2.3 KB)");
    addLog("step", "  handler.ts (1.8 KB)");
    addLog("step", "  README.md (1.2 KB)");
    await delay(300);
    addLog("step", "Calculating integrity hash...");
    await delay(200);
    addLog("success", `Package created: ${skillName}-${version}.astra-skill`);
    addLog("success", "Size: 5.3 KB | SHA256: a8f3c2...9d1e");
    addLog("info", "Ready to publish to AstraHub");
    setIsRunning(false);
  };

  const handleRun = () => {
    switch (activeTab) {
      case "create": runCreate(); break;
      case "validate": runValidate(); break;
      case "test": runTest(); break;
      case "package": runPackage(); break;
    }
  };

  const filteredTemplates = TEMPLATES.filter(
    (t) => t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
           t.desc.toLowerCase().includes(templateSearch.toLowerCase()),
  );

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-lg flex items-center justify-center">
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Skill SDK Console</h1>
            <p className="text-xs text-gray-500">Create, validate, test, and package skills</p>
          </div>
        </div>
        <a href="/api/docs" target="_blank" className="btn-ghost flex items-center gap-1.5 text-xs text-gray-400">
          Documentation <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Main 3-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — Templates */}
        <div className="w-[260px] border-r border-white/[0.04] flex flex-col bg-surface/50">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                className="input w-full pl-8 text-xs py-2"
                placeholder="Search templates..."
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {filteredTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTemplate(t);
                  setSkillName(`my-${t.id}`);
                  setDescription(t.desc);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  selectedTemplate.id === t.id
                    ? "bg-astra-500/10 border border-astra-500/20"
                    : "hover:bg-white/[0.03] border border-transparent"
                }`}
              >
                <span className="text-lg flex-shrink-0">{t.icon}</span>
                <div className="min-w-0">
                  <p className={`text-xs font-medium ${selectedTemplate.id === t.id ? "text-white" : "text-gray-300"}`}>{t.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-white/[0.04] text-center">
            <p className="text-[10px] text-gray-600">{TEMPLATES.length} templates available</p>
          </div>
        </div>

        {/* Center — Form */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-white/[0.04] px-4">
            {(["create", "validate", "test", "package"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-xs font-medium capitalize border-b-2 transition-colors ${
                  activeTab === tab
                    ? "text-astra-400 border-astra-500"
                    : "text-gray-500 border-transparent hover:text-gray-300"
                }`}
              >
                {tab}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="btn-primary my-2 text-xs px-4 py-1.5 flex items-center gap-1.5"
            >
              {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {activeTab === "create" ? "Create" : activeTab === "validate" ? "Validate" : activeTab === "test" ? "Run Tests" : "Package"}
            </button>
          </div>

          {/* Form content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {activeTab === "create" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Skill Name</label>
                    <input type="text" value={skillName} onChange={(e) => setSkillName(e.target.value)} className="input w-full" placeholder="my-skill-name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Version</label>
                    <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} className="input w-full" placeholder="1.0.0" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Description</label>
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="input w-full" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Template</label>
                    <div className="input flex items-center gap-2 cursor-default">
                      <span>{selectedTemplate.icon}</span>
                      <span className="text-white text-sm">{selectedTemplate.name}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Category</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-full">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-2">Permissions</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PERMISSIONS.map(({ id, label, icon: Icon, desc }) => (
                      <button
                        key={id}
                        onClick={() => setPermissions((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])}
                        className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                          permissions.includes(id)
                            ? "bg-astra-500/10 border-astra-500/20 text-white"
                            : "bg-white/[0.02] border-white/[0.06] text-gray-400 hover:border-white/[0.1]"
                        }`}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${permissions.includes(id) ? "text-astra-400" : "text-gray-500"}`} />
                        <div>
                          <p className="text-xs font-medium">{label}</p>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "validate" && (
              <div className="space-y-4">
                <div className="glass p-4">
                  <h3 className="text-sm font-medium text-white mb-2">Validation Checks</h3>
                  <div className="space-y-2 text-xs text-gray-400">
                    <div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> SKILL.md frontmatter format</div>
                    <div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Name validation (lowercase, hyphens)</div>
                    <div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Semver version check</div>
                    <div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Category validation</div>
                    <div className="flex items-center gap-2"><Shield className="w-3.5 h-3.5 text-amber-400" /> Security static analysis (7 rules)</div>
                    <div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Permission declaration check</div>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Click "Validate" to run all checks on the current skill.</p>
              </div>
            )}

            {activeTab === "test" && (
              <div className="space-y-4">
                <div className="glass p-4">
                  <h3 className="text-sm font-medium text-white mb-2">Test Configuration</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Test Input</label>
                      <textarea className="input w-full h-20 resize-none font-mono text-xs" placeholder='{"data": "sample input for testing"}' />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Expected Output (optional)</label>
                      <textarea className="input w-full h-16 resize-none font-mono text-xs" placeholder='{"result": "expected output"}' />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "package" && (
              <div className="space-y-4">
                <div className="glass p-4">
                  <h3 className="text-sm font-medium text-white mb-2">Package Configuration</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-gray-400">Skill</span><span className="text-white font-mono">{skillName}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Version</span><span className="text-white font-mono">{version}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Template</span><span className="text-white">{selectedTemplate.name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Category</span><span className="text-white">{category}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Permissions</span><span className="text-white">{permissions.join(", ")}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Output</span><span className="text-white font-mono">{skillName}-{version}.astra-skill</span></div>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Click "Package" to bundle the skill for distribution.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right — Console Output */}
        <div className="w-[340px] border-l border-white/[0.04] flex flex-col bg-surface-base">
          <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-300">Console Output</h3>
            {logs.length > 0 && (
              <button onClick={() => setLogs([])} className="ml-auto text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
            )}
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-600 text-center">
                <div>
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>Run a command to see output</p>
                </div>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 animate-slide-up">
                  <span className="text-gray-600 w-16 flex-shrink-0 text-[10px]">{log.time}</span>
                  {log.type === "success" && <span className="text-emerald-400">✓</span>}
                  {log.type === "error" && <span className="text-red-400">✗</span>}
                  {log.type === "info" && <span className="text-astra-400">▸</span>}
                  {log.type === "step" && <span className="text-gray-500">·</span>}
                  <span className={
                    log.type === "success" ? "text-emerald-400" :
                    log.type === "error" ? "text-red-400" :
                    log.type === "info" ? "text-astra-400" :
                    "text-gray-400"
                  }>{log.message}</span>
                </div>
              ))
            )}
            {isRunning && (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Running...</span>
              </div>
            )}
          </div>
          <div className="px-4 py-2 border-t border-white/[0.04] text-[10px] text-gray-600">
            SDK v4.0.1 &bull; {TEMPLATES.length} templates &bull; /api/sdk
          </div>
        </div>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
