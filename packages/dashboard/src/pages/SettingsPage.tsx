import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings, Key, Users, Building, Shield, Bell,
  Globe, Server, Save, CheckCircle, Info,
  Database, Cpu, HardDrive, Palette, Code, Lock,
  AlertTriangle, ExternalLink,
} from "lucide-react";
import { fetchSettings, updateSettings } from "../lib/api";

interface SettingSection {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
}

const SECTIONS: SettingSection[] = [
  { id: "general", label: "General", icon: Settings, description: "Instance name, model, logging" },
  { id: "providers", label: "LLM Providers", icon: Server, description: "API keys and model config" },
  { id: "auth", label: "Authentication", icon: Key, description: "JWT, API keys, tokens" },
  { id: "users", label: "Users & Roles", icon: Users, description: "RBAC management" },
  { id: "tenants", label: "Organizations", icon: Building, description: "Multi-tenancy config" },
  { id: "security", label: "Security", icon: Shield, description: "Hardening & protection" },
  { id: "channels", label: "Channels", icon: Globe, description: "Communication channels" },
  { id: "storage", label: "Storage", icon: Database, description: "Data & backup settings" },
  { id: "notifications", label: "Notifications", icon: Bell, description: "Alerts & events" },
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme & display" },
];

const PROVIDERS = [
  { name: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", models: "claude-sonnet-4, claude-opus-4", icon: "A", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { name: "OpenAI (GPT)", envKey: "OPENAI_API_KEY", models: "gpt-4o, o1, o3", icon: "O", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { name: "Google (Gemini)", envKey: "GEMINI_API_KEY", models: "gemini-2.5-pro, gemini-2.5-flash", icon: "G", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { name: "Ollama (Local)", envKey: "OLLAMA_BASE_URL", models: "llama3.1, mistral, codestral", icon: "L", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { name: "AWS Bedrock", envKey: "AWS_ACCESS_KEY_ID", models: "claude-3.5, titan, llama3", icon: "B", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { name: "Mistral", envKey: "MISTRAL_API_KEY", models: "mistral-large, codestral, pixtral", icon: "M", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  { name: "OpenRouter", envKey: "OPENROUTER_API_KEY", models: "any model via routing", icon: "R", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  { name: "Cohere", envKey: "COHERE_API_KEY", models: "command-r-plus, command-r", icon: "C", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { name: "Groq", envKey: "GROQ_API_KEY", models: "llama-3.3-70b, mixtral", icon: "Q", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  { name: "DeepSeek", envKey: "DEEPSEEK_API_KEY", models: "deepseek-chat, deepseek-reasoner", icon: "D", color: "bg-teal-500/20 text-teal-400 border-teal-500/30" },
  { name: "Together", envKey: "TOGETHER_API_KEY", models: "llama-405B, mixtral-8x22B", icon: "T", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { name: "HuggingFace", envKey: "HUGGINGFACE_API_KEY", models: "open-source models", icon: "H", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
];

const SECURITY_ITEMS = [
  { name: "Path Traversal Protection", desc: "path.resolve() + startsWith() in sandbox", status: "active" },
  { name: "XSS Prevention", desc: "HTML sanitization + CSP headers", status: "active" },
  { name: "Rate Limiting", desc: "Sliding window, per-IP, 60 req/min", status: "active" },
  { name: "Docker Isolation", desc: "Non-root containers, read-only filesystem", status: "active" },
  { name: "Credential Encryption", desc: "AES-256-GCM with master key", status: "active" },
  { name: "Skill Sandboxing", desc: "Ed25519 signature verification", status: "active" },
  { name: "CORS Protection", desc: "Configurable origin whitelist", status: "active" },
  { name: "Input Validation", desc: "Schema validation on all endpoints", status: "active" },
];

const CHANNELS = [
  { name: "REST API", status: "active", config: "Always enabled", icon: Code },
  { name: "WebSocket", status: "active", config: "Always enabled", icon: Globe },
  { name: "WebChat", status: "active", config: "Always enabled", icon: Globe },
  { name: "Telegram", status: "config", config: "TELEGRAM_BOT_TOKEN", icon: Globe },
  { name: "WhatsApp", status: "config", config: "WHATSAPP_VERIFY_TOKEN", icon: Globe },
  { name: "Discord", status: "config", config: "DISCORD_APP_ID", icon: Globe },
  { name: "Slack", status: "config", config: "SLACK_BOT_TOKEN", icon: Globe },
  { name: "Microsoft Teams", status: "config", config: "TEAMS_APP_ID", icon: Globe },
  { name: "Signal", status: "config", config: "SIGNAL_PHONE_NUMBER", icon: Globe },
  { name: "Matrix", status: "config", config: "MATRIX_ACCESS_TOKEN", icon: Globe },
  { name: "Google Chat", status: "config", config: "GOOGLE_CHAT_SERVICE_ACCOUNT", icon: Globe },
  { name: "iMessage", status: "config", config: "BLUEBUBBLES_PASSWORD", icon: Globe },
  { name: "Zalo", status: "config", config: "ZALO_OA_ACCESS_TOKEN", icon: Globe },
  { name: "Phone/SMS", status: "config", config: "TELNYX_API_KEY", icon: Globe },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [formState, setFormState] = useState<Record<string, string>>({});
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateSettings(data),
  });

  const providerRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const authRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const getVal = (key: string, fallback: string) => formState[key] ?? (settings as Record<string, unknown>)?.[key]?.toString() ?? fallback;
  const setVal = (key: string, value: string) => setFormState((s) => ({ ...s, [key]: value }));

  const SaveButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button
      onClick={onClick}
      disabled={saveMutation.isPending}
      className="btn-primary flex items-center gap-2"
    >
      {saveMutation.isPending ? (
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : saveMutation.isSuccess ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <Save className="w-4 h-4" />
      )}
      {saveMutation.isSuccess ? "Saved" : label}
    </button>
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-gray-500 to-gray-700 rounded-xl flex items-center justify-center">
            <Settings className="w-5 h-5 text-white" />
          </div>
          Settings
        </h1>
        <p className="text-gray-500 mt-1 ml-[52px]">Configure your AstraOS instance</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar */}
        <nav className="w-56 space-y-1 flex-shrink-0">
          {SECTIONS.map(({ id, label, icon: Icon, description }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                activeSection === id
                  ? "text-white bg-astra-600/20 border-l-2 border-astra-500"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <div>
                <p className="font-medium">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {activeSection === "general" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-astra-400" /> General Settings
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Instance Name</label>
                    <input
                      type="text"
                      value={getVal("instanceName", "AstraOS")}
                      onChange={(e) => setVal("instanceName", e.target.value)}
                      className="input w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">Displayed in the dashboard header and API responses.</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Default Model</label>
                    <select
                      value={getVal("defaultModel", "claude-sonnet-4-20250514")}
                      onChange={(e) => setVal("defaultModel", e.target.value)}
                      className="input w-full"
                    >
                      <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                      <option value="claude-opus-4-20250514">Claude Opus 4</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gemini-2.5-pro-preview-06-05">Gemini 2.5 Pro</option>
                      <option value="llama3.1">Llama 3.1 (Local)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Max Agents</label>
                      <input
                        type="number"
                        value={getVal("maxAgents", "50")}
                        onChange={(e) => setVal("maxAgents", e.target.value)}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Log Level</label>
                      <select
                        value={getVal("logLevel", "info")}
                        onChange={(e) => setVal("logLevel", e.target.value)}
                        className="input w-full"
                      >
                        <option>debug</option>
                        <option>info</option>
                        <option>warn</option>
                        <option>error</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Timezone</label>
                    <input
                      type="text"
                      value={getVal("timezone", "Asia/Kolkata")}
                      onChange={(e) => setVal("timezone", e.target.value)}
                      className="input w-full"
                      placeholder="e.g., Asia/Kolkata, America/New_York"
                    />
                  </div>
                </div>
              </div>
              <SaveButton
                onClick={() => saveMutation.mutate({
                  instanceName: getVal("instanceName", "AstraOS"),
                  defaultModel: getVal("defaultModel", "claude-sonnet-4-20250514"),
                  maxAgents: parseInt(getVal("maxAgents", "50")),
                  logLevel: getVal("logLevel", "info"),
                  timezone: getVal("timezone", "Asia/Kolkata"),
                })}
                label="Save Changes"
              />
            </div>
          )}

          {activeSection === "providers" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Server className="w-5 h-5 text-astra-400" /> LLM Provider Configuration
                </h3>
                <div className="space-y-4">
                  {PROVIDERS.map((provider) => (
                    <div key={provider.name} className="bg-white/[0.04] rounded-lg p-4 border border-white/[0.06] hover:border-white/[0.08] transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border text-sm font-bold ${provider.color}`}>
                            {provider.icon}
                          </div>
                          <h4 className="text-sm font-medium text-white">{provider.name}</h4>
                        </div>
                        <span className="badge-green text-xs">Connected</span>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">{provider.envKey}</label>
                        <input
                          type="password"
                          placeholder="••••••••••••"
                          className="input w-full mt-1"
                          ref={(el) => { providerRefs.current[provider.envKey] = el; }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Models: {provider.models}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-300">
                  API keys are stored encrypted with AES-256-GCM using your MASTER_ENCRYPTION_KEY.
                  They are never exposed in API responses or logs.
                </p>
              </div>
              <SaveButton
                onClick={() => {
                  const data: Record<string, unknown> = {};
                  Object.entries(providerRefs.current).forEach(([key, el]) => {
                    if (el?.value) data[key] = el.value;
                  });
                  if (Object.keys(data).length > 0) saveMutation.mutate(data);
                }}
                label="Save Providers"
              />
            </div>
          )}

          {activeSection === "auth" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-astra-400" /> Authentication
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">JWT Secret</label>
                    <input type="password" placeholder="••••••••••••" className="input w-full" ref={(el) => { authRefs.current["JWT_SECRET"] = el; }} />
                    <p className="text-xs text-gray-500 mt-1">Used to sign JWT tokens. Auto-generated during setup.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Token TTL (seconds)</label>
                      <input type="number" defaultValue={86400} className="input w-full" ref={(el) => { authRefs.current["TOKEN_TTL"] = el; }} />
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Refresh Token TTL</label>
                      <input type="number" defaultValue={604800} className="input w-full" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">API Keys</label>
                    <textarea
                      placeholder="One key per line"
                      rows={3}
                      className="input w-full"
                      ref={(el) => { authRefs.current["ASTRA_API_KEYS"] = el; }}
                    />
                    <p className="text-xs text-gray-500 mt-1">Comma-separated or one per line. Accepted via Authorization header or X-API-Key.</p>
                  </div>
                </div>
              </div>

              {/* SSO Section */}
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <ExternalLink className="w-5 h-5 text-astra-400" /> SSO Configuration
                </h3>
                <div className="space-y-3">
                  {[
                    { name: "SAML 2.0", desc: "Enterprise SSO via SAML providers", status: "Available" },
                    { name: "OIDC", desc: "OpenID Connect for Google, Azure AD, Okta", status: "Available" },
                  ].map((sso) => (
                    <div key={sso.name} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                      <div>
                        <p className="text-sm font-medium text-white">{sso.name}</p>
                        <p className="text-xs text-gray-500">{sso.desc}</p>
                      </div>
                      <span className="badge-blue">{sso.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <SaveButton
                onClick={() => {
                  const data: Record<string, unknown> = {};
                  Object.entries(authRefs.current).forEach(([key, el]) => {
                    if (el?.value) data[key] = el.value;
                  });
                  if (Object.keys(data).length > 0) saveMutation.mutate(data);
                }}
                label="Save Auth Settings"
              />
            </div>
          )}

          {activeSection === "users" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-astra-400" /> User Management
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Manage users and their roles. AstraOS supports 4 RBAC roles.
                </p>
                <div className="space-y-3">
                  {[
                    { name: "Admin", email: "admin@astra-os.dev", role: "admin", color: "bg-astra-900/50 text-astra-400 border-astra-800" },
                  ].map((user) => (
                    <div key={user.email} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-astra-600 rounded-full flex items-center justify-center">
                          <Users className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </div>
                      <span className={`badge border ${user.color}`}>{user.role}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-white/[0.04]">
                  <p className="text-xs text-gray-500 mb-3">Available Roles</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { role: "Admin", desc: "Full access to all features" },
                      { role: "Developer", desc: "Create agents, skills, workflows" },
                      { role: "Operator", desc: "Monitor and manage operations" },
                      { role: "Viewer", desc: "Read-only dashboard access" },
                    ].map(({ role, desc }) => (
                      <div key={role} className="bg-white/[0.03] rounded-lg p-3">
                        <p className="text-sm font-medium text-white">{role}</p>
                        <p className="text-xs text-gray-500">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button className="btn-primary flex items-center gap-2">
                <Users className="w-4 h-4" /> Add User
              </button>
            </div>
          )}

          {activeSection === "tenants" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Building className="w-5 h-5 text-astra-400" /> Multi-Tenancy
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Manage organizations, plans, quotas, and API key scoping.
                </p>
                <div className="bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-white">Default Organization</p>
                      <p className="text-xs text-gray-500">ID: default</p>
                    </div>
                    <span className="badge-green">Enterprise</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><p className="text-gray-500">Agents</p><p className="text-white font-medium">Unlimited</p></div>
                    <div><p className="text-gray-500">Messages/day</p><p className="text-white font-medium">Unlimited</p></div>
                    <div><p className="text-gray-500">Skills</p><p className="text-white font-medium">Unlimited</p></div>
                  </div>
                </div>
              </div>
              <button className="btn-primary flex items-center gap-2">
                <Building className="w-4 h-4" /> Add Organization
              </button>
            </div>
          )}

          {activeSection === "security" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" /> Security Settings
                </h3>
                <div className="space-y-3">
                  {SECURITY_ITEMS.map((item) => (
                    <div key={item.name} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                      <div>
                        <p className="text-sm font-medium text-white">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.desc}</p>
                      </div>
                      <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-300">
                  All security features are enabled by default. AstraOS follows OWASP Top 10 guidelines
                  and is designed for SOC 2, GDPR, and HIPAA compliance.
                </p>
              </div>
            </div>
          )}

          {activeSection === "channels" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-astra-400" /> Channel Configuration
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  AstraOS supports 14+ communication channels. Set the required environment variables to enable each channel.
                </p>
                <div className="space-y-2">
                  {CHANNELS.map((ch) => (
                    <div key={ch.name} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-3 border border-white/[0.06] hover:border-white/[0.08] transition-colors">
                      <div className="flex items-center gap-3">
                        <ch.icon className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium text-white">{ch.name}</p>
                          <p className="text-xs text-gray-500 font-mono">{ch.config}</p>
                        </div>
                      </div>
                      {ch.status === "active" ? (
                        <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          <AlertTriangle className="w-3 h-3" />
                          Needs Config
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSection === "storage" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-astra-400" /> Storage & Backups
                </h3>
                <div className="space-y-4">
                  {[
                    { name: "SQLite Database", path: ".astra-data/astra.db", size: "12.4 MB" },
                    { name: "Memory Store", path: ".astra-memory/", size: "5.2 MB" },
                    { name: "Logs", path: "logs/", size: "3.1 MB" },
                    { name: "Workspace", path: "workspace/", size: "1.8 MB" },
                  ].map((store) => (
                    <div key={store.name} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-4 border border-white/[0.06]">
                      <div>
                        <p className="text-sm font-medium text-white">{store.name}</p>
                        <p className="text-xs text-gray-500 font-mono">{store.path}</p>
                      </div>
                      <span className="text-sm text-white font-medium">{store.size}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">Backup Configuration</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Auto-backup interval</span>
                    <select className="input w-40">
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Retention period</span>
                    <select className="input w-40">
                      <option>7 days</option>
                      <option>30 days</option>
                      <option>90 days</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-astra-400" /> Notifications
              </h3>
              <p className="text-sm text-gray-400 mb-4">Configure alerts for system events, errors, and anomalies.</p>
              <div className="space-y-3">
                {[
                  "Self-healing events",
                  "High error rate (>5%)",
                  "Session limit reached",
                  "New skill published",
                  "Agent crash / restart",
                  "Security alert",
                  "Backup completed",
                  "Daily digest",
                ].map((event) => (
                  <div key={event} className="flex items-center justify-between bg-white/[0.04] rounded-lg p-3 border border-white/[0.06]">
                    <span className="text-sm text-white">{event}</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" defaultChecked className="sr-only peer" />
                      <div className="w-9 h-5 bg-white/[0.06] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-astra-600" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === "appearance" && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Palette className="w-5 h-5 text-astra-400" /> Appearance
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-2">Theme</label>
                  <div className="grid grid-cols-3 gap-3">
                    {["Dark", "Midnight", "OLED"].map((theme) => (
                      <button
                        key={theme}
                        className={`p-4 rounded-lg border text-center text-sm font-medium transition-colors ${
                          theme === "Dark"
                            ? "bg-astra-600/20 border-astra-500/50 text-astra-400"
                            : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:border-white/[0.08]"
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-2">Accent Color</label>
                  <div className="flex gap-3">
                    {[
                      { name: "Astra Purple", color: "bg-astra-500" },
                      { name: "Blue", color: "bg-blue-500" },
                      { name: "Green", color: "bg-emerald-500" },
                      { name: "Orange", color: "bg-orange-500" },
                      { name: "Pink", color: "bg-pink-500" },
                    ].map(({ name, color }) => (
                      <button
                        key={name}
                        title={name}
                        className={`w-8 h-8 rounded-full ${color} ring-2 ring-offset-2 ring-offset-gray-900 ${
                          name === "Astra Purple" ? "ring-white" : "ring-transparent"
                        } hover:ring-white transition-all`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
