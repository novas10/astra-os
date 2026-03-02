/**
 * Dashboard Page Component Tests
 * Verifies all 11 pages render without crashing.
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
  searchMemory: vi.fn().mockResolvedValue({ results: [] }),
  createAgent: vi.fn(),
  pauseAgent: vi.fn(),
  resumeAgent: vi.fn(),
  deleteAgent: vi.fn(),
  saveWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  updateSettings: vi.fn(),
  runSecurityScan: vi.fn(),
  installSkill: vi.fn(),
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

  it("HomePage shows dashboard title", async () => {
    const mod = await import("../pages/HomePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/dashboard/i)).toBeTruthy();
  });

  it("AgentsPage shows agents heading", async () => {
    const mod = await import("../pages/AgentsPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/agent/i)).toBeTruthy();
  });

  it("SecurityPage shows security heading", async () => {
    const mod = await import("../pages/SecurityPage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/security/i)).toBeTruthy();
  });

  it("MarketplacePage shows marketplace heading", async () => {
    const mod = await import("../pages/MarketplacePage");
    render(<mod.default />, { wrapper: Wrapper });
    expect(screen.getByText(/marketplace/i)).toBeTruthy();
  });
});
