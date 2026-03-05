import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings, Key, Users, Building, Shield, Bell,
  Globe, Server, Save, CheckCircle,
} from "lucide-react";
import { fetchSettings, updateSettings } from "../lib/api";

interface SettingSection {
  id: string;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: SettingSection[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "providers", label: "LLM Providers", icon: Server },
  { id: "auth", label: "Authentication", icon: Key },
  { id: "users", label: "Users & Roles", icon: Users },
  { id: "tenants", label: "Organizations", icon: Building },
  { id: "security", label: "Security", icon: Shield },
  { id: "channels", label: "Channels", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
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

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your AstraOS instance</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar */}
        <nav className="w-52 space-y-1 flex-shrink-0">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeSection === id
                  ? "text-white bg-astra-600/20 border-l-2 border-astra-500"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {activeSection === "general" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">General Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Instance Name</label>
                    <input type="text" defaultValue="AstraOS" className="input w-full" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Default Model</label>
                    <select
                      value={getVal("defaultModel", "gpt-4o")}
                      onChange={(e) => setVal("defaultModel", e.target.value)}
                      className="input w-full"
                    >
                      <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="gemini-2.5-pro-preview-06-05">gemini-2.5-pro-preview-06-05</option>
                      <option value="llama3.1">llama3.1</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Max Agents</label>
                    <input
                      type="number"
                      value={getVal("maxAgents", "50")}
                      onChange={(e) => setVal("maxAgents", e.target.value)}
                      className="input w-32"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Log Level</label>
                    <select className="input w-full">
                      <option>debug</option>
                      <option>info</option>
                      <option>warn</option>
                      <option>error</option>
                    </select>
                  </div>
                </div>
              </div>
              <button
                onClick={() => saveMutation.mutate({
                  defaultModel: getVal("defaultModel", "gpt-4o"),
                  maxAgents: parseInt(getVal("maxAgents", "50")),
                })}
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
                {saveMutation.isSuccess ? "Saved" : "Save Changes"}
              </button>
            </div>
          )}

          {activeSection === "providers" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">LLM Provider Configuration</h3>
                <div className="space-y-4">
                  {[
                    { name: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", models: "claude-sonnet, claude-opus" },
                    { name: "OpenAI (GPT)", envKey: "OPENAI_API_KEY", models: "gpt-4o, o1, o3" },
                    { name: "Google (Gemini)", envKey: "GEMINI_API_KEY", models: "gemini-2.5-pro, gemini-2.5-flash" },
                    { name: "Ollama (Local)", envKey: "OLLAMA_BASE_URL", models: "llama3.1, mistral, codestral" },
                  ].map((provider) => (
                    <div key={provider.name} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-white">{provider.name}</h4>
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
              <button
                onClick={() => {
                  const data: Record<string, unknown> = {};
                  Object.entries(providerRefs.current).forEach(([key, el]) => {
                    if (el?.value) data[key] = el.value;
                  });
                  if (Object.keys(data).length > 0) saveMutation.mutate(data);
                }}
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
                {saveMutation.isSuccess ? "Saved" : "Save Providers"}
              </button>
            </div>
          )}

          {activeSection === "auth" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">Authentication</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">JWT Secret</label>
                    <input type="password" placeholder="••••••••••••" className="input w-full" ref={(el) => { authRefs.current["JWT_SECRET"] = el; }} />
                    <p className="text-xs text-gray-500 mt-1">Used to sign JWT tokens. Auto-generated if not set.</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Token TTL (seconds)</label>
                    <input type="number" defaultValue={86400} className="input w-32" ref={(el) => { authRefs.current["TOKEN_TTL"] = el; }} />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">API Keys</label>
                    <textarea
                      placeholder="One key per line"
                      rows={3}
                      className="input w-full"
                      ref={(el) => { authRefs.current["ASTRA_API_KEYS"] = el; }}
                    />
                    <p className="text-xs text-gray-500 mt-1">Comma-separated or one per line.</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  const data: Record<string, unknown> = {};
                  Object.entries(authRefs.current).forEach(([key, el]) => {
                    if (el?.value) data[key] = el.value;
                  });
                  if (Object.keys(data).length > 0) saveMutation.mutate(data);
                }}
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
                {saveMutation.isSuccess ? "Saved" : "Save Auth Settings"}
              </button>
            </div>
          )}

          {activeSection === "users" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">User Management</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Manage users and their roles (Admin, Developer, Operator, Viewer).
                </p>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-astra-600 rounded-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Admin</p>
                        <p className="text-xs text-gray-500">admin@astra-os.dev</p>
                      </div>
                    </div>
                    <span className="badge bg-astra-900/50 text-astra-400 border border-astra-800">admin</span>
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
                <h3 className="text-lg font-semibold text-white mb-4">Multi-Tenancy</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Manage organizations, plans, quotas, and API key scoping.
                </p>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-white">Default Organization</p>
                      <p className="text-xs text-gray-500">ID: default</p>
                    </div>
                    <span className="badge-green">Enterprise</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><p className="text-gray-500">Agents</p><p className="text-white">Unlimited</p></div>
                    <div><p className="text-gray-500">Messages/day</p><p className="text-white">Unlimited</p></div>
                    <div><p className="text-gray-500">Skills</p><p className="text-white">Unlimited</p></div>
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
                <h3 className="text-lg font-semibold text-white mb-4">Security Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div>
                      <p className="text-sm font-medium text-white">Path Traversal Protection</p>
                      <p className="text-xs text-gray-500">path.resolve() + startsWith() in sandbox</p>
                    </div>
                    <span className="badge-green">Active</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div>
                      <p className="text-sm font-medium text-white">XSS Prevention</p>
                      <p className="text-xs text-gray-500">HTML sanitization + CSP headers in Canvas</p>
                    </div>
                    <span className="badge-green">Active</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div>
                      <p className="text-sm font-medium text-white">Rate Limiting</p>
                      <p className="text-xs text-gray-500">Sliding window, per-IP, 60 req/min</p>
                    </div>
                    <span className="badge-green">Active</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div>
                      <p className="text-sm font-medium text-white">Docker Isolation</p>
                      <p className="text-xs text-gray-500">Non-root containers, read-only filesystem</p>
                    </div>
                    <span className="badge-green">Active</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "channels" && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-white mb-4">Channel Configuration</h3>
                <div className="space-y-3">
                  {[
                    { name: "REST API", status: "active", config: "Always enabled" },
                    { name: "WebSocket", status: "active", config: "Always enabled" },
                    { name: "Telegram", status: "config", config: "TELEGRAM_BOT_TOKEN" },
                    { name: "WhatsApp", status: "config", config: "WHATSAPP_VERIFY_TOKEN" },
                    { name: "Discord", status: "config", config: "DISCORD_APP_ID" },
                    { name: "Slack", status: "config", config: "SLACK_BOT_TOKEN" },
                    { name: "Microsoft Teams", status: "config", config: "TEAMS_APP_ID" },
                    { name: "Signal", status: "config", config: "SIGNAL_PHONE_NUMBER" },
                    { name: "Matrix", status: "config", config: "MATRIX_ACCESS_TOKEN" },
                    { name: "Google Chat", status: "config", config: "GOOGLE_CHAT_SERVICE_ACCOUNT" },
                    { name: "iMessage", status: "config", config: "BLUEBUBBLES_PASSWORD" },
                  ].map((ch) => (
                    <div key={ch.name} className="flex items-center justify-between bg-gray-800 rounded-lg p-3 border border-gray-700">
                      <div className="flex items-center gap-3">
                        <Globe className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium text-white">{ch.name}</p>
                          <p className="text-xs text-gray-500 font-mono">{ch.config}</p>
                        </div>
                      </div>
                      {ch.status === "active" ? (
                        <span className="badge-green">Active</span>
                      ) : (
                        <span className="badge-yellow">Needs Config</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-4">Notifications</h3>
              <p className="text-sm text-gray-400">Configure alerts for system events, errors, and anomalies.</p>
              <div className="mt-4 space-y-3">
                {["Self-healing events", "High error rate", "Session limit reached", "New skill published"].map((event) => (
                  <div key={event} className="flex items-center justify-between bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <span className="text-sm text-white">{event}</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" defaultChecked className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-astra-600" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
