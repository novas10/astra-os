import { useState } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Bot, MessageSquare, Package, Workflow,
  Brain, Settings, Activity, Shield, Zap, Lock,
  Code2, TrendingUp, Search, Bell, ChevronLeft,
  ChevronRight, Command, Moon, Sun, LogOut, User,
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
import SDKConsolePage from "./pages/SDKConsolePage";
import TradingPage from "./pages/TradingPage";
import LoginPage from "./pages/LoginPage";

const NAV_SECTIONS = [
  {
    label: "MAIN",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/agents", icon: Bot, label: "Agents" },
      { to: "/conversations", icon: MessageSquare, label: "Conversations" },
      { to: "/skills", icon: Zap, label: "Skills" },
    ],
  },
  {
    label: "BUILD",
    items: [
      { to: "/workflows", icon: Workflow, label: "Workflows" },
      { to: "/marketplace", icon: Package, label: "Marketplace" },
      { to: "/sdk", icon: Code2, label: "SDK Console" },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      { to: "/traces", icon: Activity, label: "Traces & Metrics" },
      { to: "/memory", icon: Brain, label: "Memory" },
      { to: "/security", icon: Shield, label: "Security" },
      { to: "/trading", icon: TrendingUp, label: "Trading" },
    ],
  },
  {
    label: "ADMIN",
    items: [
      { to: "/vault", icon: Lock, label: "Vault" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

function SearchBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-gray-500 text-sm hover:bg-white/[0.06] hover:border-white/[0.1] transition-all"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-gray-500">
          <Command className="w-2.5 h-2.5" />K
        </kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg mx-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="glass-strong p-1">
              <div className="flex items-center gap-3 px-4 py-3">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search agents, skills, workflows..."
                  className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
                />
                <kbd className="px-2 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-gray-500">ESC</kbd>
              </div>
              <div className="border-t border-white/[0.06] px-4 py-6 text-center text-sm text-gray-500">
                Start typing to search across your AstraOS instance
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  return (
    <aside className={`${collapsed ? "w-[68px]" : "w-[252px]"} bg-surface border-r border-white/[0.04] flex flex-col transition-all duration-300 ease-out`}>
      {/* Logo */}
      <div className={`${collapsed ? "px-3" : "px-4"} py-4 border-b border-white/[0.04]`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-astra-500 to-astra-700 rounded-lg flex items-center justify-center shadow-glow flex-shrink-0">
            <span className="text-white font-black text-sm">A</span>
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <h1 className="text-base font-bold text-white tracking-tight">AstraOS</h1>
              <p className="text-[10px] text-gray-600 font-medium">v4.0.1</p>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3 animate-fade-in">
          <SearchBar />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto space-y-0.5">
        {NAV_SECTIONS.map(({ label, items }) => (
          <div key={label}>
            {!collapsed && <p className="sidebar-section">{label}</p>}
            {collapsed && <div className="h-2" />}
            {items.map(({ to, icon: Icon, label: itemLabel }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? "active" : ""} ${collapsed ? "justify-center px-0" : ""}`
                }
                title={collapsed ? itemLabel : undefined}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                {!collapsed && <span className="animate-fade-in">{itemLabel}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={`${collapsed ? "px-2" : "px-3"} py-3 border-t border-white/[0.04] space-y-2`}>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-colors text-xs"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4" /><span className="animate-fade-in">Collapse</span></>}
        </button>

        {/* User */}
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3 px-1"}`}>
          <div className="w-8 h-8 bg-gradient-to-br from-astra-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-astra-500/20">
            <span className="text-white text-xs font-bold">K</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 animate-fade-in">
              <p className="text-sm font-medium text-white truncate">kowsi</p>
              <p className="text-[10px] text-gray-500">Admin</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  const location = useLocation();
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === "/") return null; // Home shows greeting instead
    const section = NAV_SECTIONS.flatMap(s => s.items).find(i => i.to === path);
    return section?.label || "AstraOS";
  };

  const title = getPageTitle();

  return (
    <div className="h-14 border-b border-white/[0.04] bg-surface/80 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30">
      <div>
        {title ? (
          <h2 className="text-sm font-semibold text-white">{title}</h2>
        ) : (
          <h2 className="text-sm font-medium text-gray-400">{getGreeting()}, <span className="text-white font-semibold">kowsi</span></h2>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button className="relative p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.04] transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-surface" />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem("astra_token"));

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        <main className="flex-1 overflow-y-auto bg-surface-base">
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
            <Route path="/sdk" element={<SDKConsolePage />} />
            <Route path="/trading" element={<TradingPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
