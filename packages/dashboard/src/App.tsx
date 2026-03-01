import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import {
  LayoutDashboard, Bot, MessageSquare, Package, Workflow,
  Brain, Settings, Activity, Shield, Users, Zap, Lock,
} from "lucide-react";
import HomePage from "./pages/HomePage";
import AgentsPage from "./pages/AgentsPage";
import ConversationsPage from "./pages/ConversationsPage";
import MarketplacePage from "./pages/MarketplacePage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage";
import MemoryPage from "./pages/MemoryPage";
import TracesPage from "./pages/TracesPage";
import SettingsPage from "./pages/SettingsPage";
import SecurityPage from "./pages/SecurityPage";
import SkillsPage from "./pages/SkillsPage";
import VaultPage from "./pages/VaultPage";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/agents", icon: Bot, label: "Agents" },
  { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/marketplace", icon: Package, label: "Marketplace" },
  { to: "/workflows", icon: Workflow, label: "Workflows" },
  { to: "/memory", icon: Brain, label: "Memory" },
  { to: "/traces", icon: Activity, label: "Traces" },
  { to: "/security", icon: Shield, label: "Security" },
  { to: "/skills", icon: Zap, label: "Skills" },
  { to: "/vault", icon: Lock, label: "Vault" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-astra-500 to-astra-700 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">AstraOS</h1>
              <p className="text-xs text-gray-500">Admin Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active" : ""}`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-astra-600 rounded-full flex items-center justify-center">
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Admin</p>
              <p className="text-xs text-gray-500">Enterprise</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-950">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/workflows" element={<WorkflowBuilderPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
