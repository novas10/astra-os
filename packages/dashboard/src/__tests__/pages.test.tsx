/**
 * Dashboard Page Component Tests
 * Verifies all 11 pages render without crashing + specific feature tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// Mock api module — prevent real HTTP calls
vi.mock("../lib/api", () => ({
  fetchAgents: vi.fn().mockResolvedValue([]),
  fetchSkills: vi.fn().mockResolvedValue([]),
  fetchSkillsEcosystem: vi.fn().mockResolvedValue(null),
  fetchMetrics: vi.fn().mockResolvedValue({}),
  fetchTraces: vi.fn().mockResolvedValue([]),
  fetchSecurityOverview: vi.fn().mockResolvedValue({ grade: "A", score: 95, protections: [] }),
  fetchSettings: vi.fn().mockResolvedValue({}),
  fetchVaultCredentials: vi.fn().mockResolvedValue([]),
  fetchWorkflows: vi.fn().mockResolvedValue([]),
  fetchConversations: vi.fn().mockResolvedValue([]),
  searchMarketplace: vi.fn().mockResolvedValue({ skills: [] }),
  fetchInstalledMarketplace: vi.fn().mockResolvedValue([]),
  fetchMarketplaceCategories: vi.fn().mockResolvedValue([]),
  searchMemory: vi.fn().mockResolvedValue({ results: "" }),
  createAgent: vi.fn(),
  pauseAgent: vi.fn(),
  resumeAgent: vi.fn(),
  deleteAgent: vi.fn(),
  saveWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  updateSettings: vi.fn(),
  runSecurityScan: vi.fn(),
  installSkill: vi.fn(),
  generateSkill: vi.fn(),
  migrateFromClawHub: vi.fn(),
}));

// Wrapper with QueryClient + Router
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Dynamically import pages to test
const pages = [
  { name: "HomePage", path: "../pages/HomePage" },
  { name: "AgentsPage", path: "../pages/AgentsPage" },
  { name: "SkillsPage", path: "../pages/SkillsPage" },
  { name: "MarketplacePage", path: "../pages/MarketplacePage" },
  { name: "SecurityPage", path: "../pages/SecurityPage" },
  { name: "SettingsPage", path: "../pages/SettingsPage" },
  { name: "TracesPage", path: "../pages/TracesPage" },
  { name: "VaultPage", path: "../pages/VaultPage" },
  { name: "MemoryPage", path: "../pages/MemoryPage" },
  { name: "ConversationsPage", path: "../pages/ConversationsPage" },
];

describe("Dashboard Pages — Smoke Tests", () => {
  let Wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    Wrapper = createWrapper();
  });

  for (const { name, path } of pages) {
    it(`${name} renders without crashing`, async () => {
      const mod = await import(/* @vite-ignore */ path);
      const Page = mod.default;
      const { container } = render(<Page />, { wrapper: Wrapper });
      expect(container.firstChild).toBeTruthy();
    });
  }
});

describe("HomePage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows dashboard title", async () => {
    const mod = await import("../pages/HomePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/dashboard/i)).toBeTruthy();
  });

  it("shows stat cards", async () => {
    const mod = await import("../pages/HomePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/request volume/i)).toBeTruthy();
  });

  it("shows quick access section", async () => {
    const mod = await import("../pages/HomePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/quick access/i)).toBeTruthy();
  });
});

describe("AgentsPage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows agents heading with icon", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Agents")).toBeTruthy();
  });

  it("shows Create Agent button", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/create agent/i)).toBeTruthy();
  });

  it("shows stats row", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Total Agents")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("shows search input", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByPlaceholderText(/search agents/i)).toBeTruthy();
  });

  it("shows empty state when no agents", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/no agents yet/i)).toBeTruthy();
  });
});

describe("SkillsPage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows skills heading", async () => {
    const mod = await import("../pages/SkillsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Skills")).toBeTruthy();
  });

  it("shows Generate Skill button", async () => {
    const mod = await import("../pages/SkillsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/generate skill/i)).toBeTruthy();
  });

  it("shows category sidebar", async () => {
    const mod = await import("../pages/SkillsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Categories")).toBeTruthy();
    expect(screen.getByText("Developer Tools")).toBeTruthy();
  });

  it("shows ClawHub migration section", async () => {
    const mod = await import("../pages/SkillsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/migrate from clawhub/i)).toBeTruthy();
  });
});

describe("MemoryPage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows memory inspector heading", async () => {
    const mod = await import("../pages/MemoryPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Memory Inspector")).toBeTruthy();
  });

  it("shows 4 memory tiers", async () => {
    const mod = await import("../pages/MemoryPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Episodic (JSONL)")).toBeTruthy();
    expect(screen.getByText("Semantic (FTS5)")).toBeTruthy();
    expect(screen.getByText("Vector Embeddings")).toBeTruthy();
    expect(screen.getByText("GraphRAG")).toBeTruthy();
  });

  it("shows search/graph/stats tabs", async () => {
    const mod = await import("../pages/MemoryPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Knowledge Graph")).toBeTruthy();
    expect(screen.getByText("Statistics")).toBeTruthy();
  });
});

describe("SettingsPage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows settings heading", async () => {
    const mod = await import("../pages/SettingsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("shows all sidebar sections", async () => {
    const mod = await import("../pages/SettingsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("LLM Providers")).toBeTruthy();
    expect(screen.getByText("Authentication")).toBeTruthy();
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Channels")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Storage")).toBeTruthy();
  });

  it("shows general settings form by default", async () => {
    const mod = await import("../pages/SettingsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText("General Settings")).toBeTruthy();
    expect(screen.getByText("Instance Name")).toBeTruthy();
  });
});

describe("SecurityPage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows security heading", async () => {
    const mod = await import("../pages/SecurityPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/security/i)).toBeTruthy();
  });
});

describe("MarketplacePage", () => {
  let Wrapper: ReturnType<typeof createWrapper>;
  beforeEach(() => { Wrapper = createWrapper(); });

  it("shows marketplace heading", async () => {
    const mod = await import("../pages/MarketplacePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/marketplace/i)).toBeTruthy();
  });
});
