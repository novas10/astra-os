# AstraOS — Figma Make Prompts

> Copy-paste each prompt into **Figma Make** to generate the screens.
> Design system: Dark theme, accent color `#6366F1` (indigo), font Inter/Geist, 1440×900 desktop.

---

## 0. Design System & Token Sheet

```
Design a dark-mode design system token sheet for "AstraOS" — an AI agent operating system.

Layout: 1440×900, organized in labeled sections.

Color palette:
- Background: #0A0A0F (base), #111118 (surface), #1A1A24 (elevated), #252532 (card)
- Accent: #6366F1 (indigo primary), #818CF8 (indigo light), #4F46E5 (indigo dark)
- Status: #10B981 (success/green), #F59E0B (warning/amber), #EF4444 (error/red), #3B82F6 (info/blue)
- Text: #F8FAFC (primary), #94A3B8 (secondary), #64748B (muted)
- Border: #1E293B

Typography using Inter:
- H1: 28px bold, H2: 22px semibold, H3: 18px semibold, H4: 15px medium
- Body: 14px regular, Caption: 12px regular, Code: 13px JetBrains Mono

Show component samples: buttons (primary, secondary, ghost, danger), input fields, toggles, badges (success, warning, error, info), cards, tabs, sidebar nav items, dropdown, modal, tooltip, avatar, status dot indicator.

Include the AstraOS logo mark — a stylized "A" with orbital rings suggesting an OS/AI brain, in indigo gradient.
```

---

## 1. Login & Auth Screen

```
Design a dark login page for "AstraOS" — an AI agent operating system.

Screen: 1440×900. Split layout.

Left side (60%): Deep dark background #0A0A0F with a large ambient glow of indigo (#6366F1) in the center. Show a stylized 3D mesh brain or neural network visualization with soft indigo and purple particle effects. Overlay the AstraOS logo (stylized "A" with orbital rings) and tagline: "Your AI. Your Rules. Your OS." in white.

Right side (40%): Dark card #111118 with rounded corners, vertically centered.
- "Welcome back" heading, "Sign in to AstraOS" subtext in #94A3B8
- Email input field with mail icon
- Password input field with lock icon and show/hide toggle
- "Remember me" checkbox + "Forgot password?" link in indigo
- Primary button "Sign In" full-width, indigo #6366F1 with hover glow
- Divider "or continue with"
- SSO buttons row: Google, GitHub, SAML SSO — outlined dark buttons with logos
- Footer: "Don't have an account? Request Access"

Subtle grain texture overlay on the whole page. Premium, futuristic feel like Linear or Vercel.
```

---

## 2. Main Dashboard (Home)

```
Design the main dashboard for "AstraOS" — a dark-themed AI agent operating system control center.

Screen: 1440×900. Layout: fixed left sidebar (240px) + main content area with 24px padding.

LEFT SIDEBAR (dark #111118):
- AstraOS logo + wordmark at top
- User avatar "K" with "kowsi" name and "Admin" role badge
- Nav sections with icons:
  MAIN: Dashboard (active, indigo highlight), Agents, Conversations, Skills
  BUILD: Workflows, Marketplace, SDK Console
  OBSERVE: Traces & Metrics, Memory, Security
  ADMIN: Vault, Settings
- Each nav item has a subtle icon (Lucide style), active item has indigo left border + indigo bg tint
- Bottom: collapse button, "v4.0.1" version badge, dark/light mode toggle

MAIN CONTENT:
Row 1 — Greeting bar: "Good afternoon, kowsi" with current date. Right side: search bar (⌘K), notification bell with red dot, quick-action "+" button.

Row 2 — 4 stat cards in a row, glass-morphism style (#1A1A24 with subtle border):
  - "Active Agents" → 7 (green dot) with +2 trend arrow
  - "Live Sessions" → 23 with sparkline
  - "Skills Loaded" → 55 with category breakdown mini bar
  - "Uptime" → 99.97% with green status ring

Row 3 — Two charts side by side:
  Left: "Request Volume (24h)" area chart with indigo gradient fill, showing peaks during work hours. X-axis: hours, Y-axis: requests.
  Right: "LLM Provider Usage" donut chart — Claude 45% (indigo), GPT-4o 30% (green), Gemini 15% (blue), Ollama 10% (orange). Legend below.

Row 4 — Two panels:
  Left: "Active Channels" — grid of channel badges: REST ✓, WebSocket ✓, Telegram ✓, WhatsApp ✓, Discord ✓, Slack ✓, Teams ○, WebChat ✓. Green dot for active, gray for inactive.
  Right: "Security Status" — 4 items: GatewayShield ✓ Active, CredentialVault ✓ Sealed, SkillSandbox ✓ Enforced, RBAC ✓ 4 Roles. Grade badge: "A+" in green circle.

Modern, clean, data-dense but not cluttered. Inspired by Vercel/Railway dashboards.
```

---

## 3. Agents Management Page

```
Design an Agents management page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Same sidebar as dashboard (show collapsed version, 64px, icons only).

TOP BAR: "Agents" heading with count badge "(7)", search input, filter dropdown (All, Active, Paused, Error), and "+ Create Agent" primary indigo button.

STATS ROW: 4 mini cards — Total: 7, Active: 5, Paused: 1, Error: 1

AGENT CARDS GRID (3 columns):

Card 1 — "Atlas" (primary agent):
- Status: green dot "Active"
- Model badge: "Claude Sonnet 4" in indigo pill
- Channels: Telegram, WhatsApp, Discord icons
- Skills: 12 bound
- Messages: 1,847 | Tokens: 245K
- Footer: Pause, Settings, Analytics buttons (icon buttons)

Card 2 — "Sentinel" (security agent):
- Status: green dot "Active"
- Model: "GPT-4o" in green pill
- Channels: REST, WebSocket
- Skills: 8 bound
- Messages: 923 | Tokens: 156K

Card 3 — "Trader" (trading agent):
- Status: amber dot "Paused"
- Model: "Claude Opus 4" in purple pill
- Channels: WebSocket
- Skills: 15 bound
- Messages: 3,201 | Tokens: 890K

Card 4 — "Support" (customer agent):
- Status: green dot "Active"
- Model: "Gemini 2.5" in blue pill
- Channels: WebChat, Slack, Teams
- Skills: 10 bound

Card 5 — "Coder" (dev assistant):
- Status: red dot "Error"
- Model: "Ollama/Llama3" in orange pill
- Error message preview: "Context window exceeded"

Each card: dark #1A1A24 background, subtle border, rounded-xl, hover: slight elevation + border glow. Model badges color-coded by provider.

Bottom: Pagination or "Load more" button.

Clean, card-based layout. Visual hierarchy through color-coded status indicators.
```

---

## 4. Create Agent Modal

```
Design a "Create Agent" modal dialog for "AstraOS" — dark theme.

Screen: 1440×900 with darkened backdrop overlay. Modal: 640px wide, centered, dark #1A1A24 bg, rounded-2xl, subtle shadow.

Header: "Create New Agent" with X close button.

Form fields:
1. "Agent Name" — text input with placeholder "e.g., Atlas, Sentinel..."
2. "Model" — dropdown selector showing provider icons:
   - Claude Sonnet 4 (Anthropic) — recommended badge
   - Claude Opus 4 (Anthropic)
   - GPT-4o (OpenAI)
   - o3 (OpenAI)
   - Gemini 2.5 Pro (Google)
   - Ollama Local (Custom)
3. "System Prompt" — large textarea (5 rows) with placeholder "Define the agent's personality and behavior..."
4. "Channels" — multi-select checkboxes in a 2-column grid: REST, WebSocket, Telegram, WhatsApp, Discord, Slack, Teams, WebChat, Signal, Matrix
5. "Skills" — searchable multi-select with skill pills: weather, web-search, code-executor, file-manager, email-assistant...
6. "Max Tokens" — number input, default 4096
7. "Temperature" — slider 0.0 to 2.0, default 0.7

Footer: "Cancel" ghost button + "Create Agent" indigo primary button.

Clean form design with proper spacing, labels above inputs, subtle field descriptions in muted text.
```

---

## 5. Workflow Builder

```
Design a visual Workflow Builder page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Minimal top bar with "Workflows" breadcrumb, workflow name "Customer Support Bot" (editable), and action buttons: Save, Run ▶, Export.

LEFT PANEL (220px) — Node palette, collapsible categories:
  AI & Logic: LLM Call, Condition, Transform, Run Code
  Flow Control: Parallel, Loop, Delay, Human Input
  Actions: Tool Call, API Request, Send Email, Memory Store
  Data: Search, Image Gen, File Op, Webhook Trigger
Each node type has an icon and is draggable. Color-coded by category (indigo for AI, green for flow, amber for actions, blue for data).

CENTER — Canvas area (dark grid background #0A0A0F with subtle dots):
Show a sample workflow with 6 connected nodes:
  1. "Webhook Trigger" (blue) → 2. "LLM Call: Classify Intent" (indigo) → branches to:
     3a. "Condition: Is Billing?" (green) → 4a. "API Call: Fetch Invoice" (amber) → 5. "LLM Call: Generate Response" (indigo)
     3b. "Condition: Is Technical?" (green) → 4b. "Tool Call: Search Docs" (amber) → connects to 5
  5 → 6. "Send Email" (amber)

Nodes: rounded rectangles with colored left border, icon, label, and mini status indicator. Connected by smooth bezier curves with animated flow dots (indigo).

RIGHT PANEL (280px) — Node config (shown when node selected):
  Selected: "LLM Call: Classify Intent"
  - Label input
  - Model dropdown: Claude Sonnet 4
  - Prompt textarea: "Classify the customer intent..."
  - Output variable: {{intent}}
  - Temperature slider: 0.3

Bottom bar: execution status — "Last run: 2.3s ago • 6/6 steps completed ✓" with green progress bar.

Inspired by n8n/Zapier but darker, more premium. Smooth, modern node-based UI.
```

---

## 6. Skills Marketplace

```
Design a Skills Marketplace page for "AstraOS" — dark theme AI agent OS.

Screen: 1440×900. Same collapsed sidebar.

TOP: "Skill Marketplace" heading, search bar with "Search 200+ skills..." placeholder, and category filter pills: All, Productivity, Developer Tools, Data & Analytics, Communication, AI & ML, Automation, Security.

FEATURED BANNER: Full-width gradient card (indigo to purple), "Featured: AI Web Search" — "Real-time web search powered by multiple search engines" with Install button and 4.8★ rating, 12K downloads.

SKILL GRID (3 columns, scrollable):
Each skill card (#1A1A24, rounded-xl):
- Skill icon (emoji or custom) top-left
- Skill name bold
- Author in muted text with verified ✓ badge
- One-line description
- Bottom row: star rating (★ 4.5), download count (2.3K), price ("Free" green badge or "$4.99")
- "Install" indigo outline button, changes to "Installed ✓" green for already installed ones

Show 9 skill cards:
1. "Web Scraper" ★4.7 — 8.2K downloads — Free
2. "SQL Assistant" ★4.9 — 5.1K — Free
3. "Slack Manager" ★4.3 — 3.4K — Free
4. "Image Analyzer" ★4.6 — 6.7K — $2.99
5. "Code Reviewer" ★4.8 — 9.1K — Free
6. "Email Assistant" ★4.4 — 4.2K — Free
7. "CSV Analyzer" ★4.5 — 2.8K — Free
8. "Blog Writer" ★4.2 — 1.9K — $4.99
9. "Security Scanner" ★4.7 — 7.3K — Free

TABS below grid: "Browse" (active) | "Installed (55)" | "Updates (3)"

App-store feel, clean cards with good info density. Inspired by VS Code extensions marketplace.
```

---

## 7. Memory Inspector

```
Design a Memory Inspector page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

TOP: "Memory" heading with brain icon.

STATS ROW — 4 cards showing memory tiers:
- "Episodic" — 2,847 entries, 12.3 MB, JSONL icon — blue accent
- "Semantic" — 1,923 entries, 8.7 MB, search icon — green accent
- "Vector" — 15,420 embeddings, 45.2 MB, cube icon — purple accent
- "Knowledge Graph" — 892 entities, 2,341 relations, 12 communities — indigo accent

TABS: Search | Knowledge Graph | Statistics

SEARCH TAB (active):
- Search bar: "Search memories..." with mode selector dropdown: Hybrid (default), Semantic, Keyword
- Search results list (5 results shown):
  Each result card:
  - Relevance score badge (0.94, 0.87, etc.) color-coded (green >0.8, yellow >0.6)
  - Memory content preview (2 lines truncated)
  - Metadata row: source (episodic/semantic), timestamp, agent name, channel
  - Tags/entities highlighted in indigo pills

KNOWLEDGE GRAPH visualization (shown as preview):
- Small network graph visualization in a card
- Nodes as circles (sized by connections), edges as lines
- Color-coded by community (Louvain)
- "Open Full Graph →" link

Right side panel: "Memory Activity" mini chart showing writes over 7 days (sparkline bar chart).

Clean data exploration UI. Scientific/analytical feel with good visual hierarchy.
```

---

## 8. Security Dashboard

```
Design a Security Dashboard for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

TOP LEFT: "Security" heading with shield icon.
TOP RIGHT: "Run Security Scan" indigo button with scan icon.

GRADE CARD (large, centered top):
- Large circular progress ring showing score "96/100"
- Letter grade "A+" in the center, green colored
- Below: "Your AstraOS instance is well-protected"
- 4 mini stats: 8 Active Protections, 1 Warning, 3 Blocked IPs, 47 Events (24h)

PROTECTIONS GRID (2 columns, 8 items):
Each protection as a row item:
1. CSRF Protection — ✓ Active (green badge)
2. Brute Force Guard — ✓ Active
3. Token Guard — ✓ Active
4. Path Traversal Block — ✓ Active
5. XSS Prevention — ✓ Active
6. SQL Injection Shield — ✓ Active
7. Rate Limiter — ⚠ Warning (amber badge) — "High traffic detected"
8. CORS Policy — ✓ Active

BOTTOM ROW — Two panels:

Left: "Blocked IPs" table:
| IP Address | Reason | Blocked At | Expires |
| 45.33.32.156 | Brute force | 2h ago | 24h |
| 103.21.244.0 | Rate limit | 5h ago | 12h |
| 198.51.100.1 | Path traversal | 1d ago | 7d |

Right: "Recent Events" feed:
- 🔴 Critical: "Brute force attempt blocked" — 45.33.32.156 — 2h ago
- 🟡 Medium: "Rate limit triggered" — /api/chat — 3h ago
- 🟢 Low: "New API key created" — admin — 5h ago
- 🟡 Medium: "Failed login attempt" — user@email.com — 6h ago
- 🟢 Low: "Security scan completed" — score: 96 — 1d ago

Color-coded severity. Security-focused, command-center feel.
```

---

## 9. Vault (Credential Manager)

```
Design a Credential Vault page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

TOP: "Credential Vault" heading with lock icon, "Vault Status: Sealed 🟢" badge.
Right: "+ Add Credential" indigo button.

STATUS CARDS ROW (4 cards):
- "Encryption" — AES-256-GCM — lock icon — green
- "Key Source" — Environment Variable — key icon — blue
- "Stored Credentials" — 12 — database icon — indigo
- "Last Access" — 3 minutes ago — clock icon — gray

CREDENTIALS TABLE (main content):
| Name | Service | Value | Expires | Last Used | Actions |
|------|---------|-------|---------|-----------|---------|
| 🔑 ANTHROPIC_API_KEY | Anthropic | sk-ant-••••••••hX4f | Never | 3 min ago | 🗑 |
| 🔑 OPENAI_API_KEY | OpenAI | sk-••••••••j9Kp | Never | 1h ago | 🗑 |
| 🔑 TELEGRAM_BOT_TOKEN | Telegram | 7483••••••••:AAH | Never | 5 min ago | 🗑 |
| 🔑 DISCORD_TOKEN | Discord | MTI3••••••••.GR | Dec 2026 | 2h ago | 🗑 |
| 🔑 SLACK_WEBHOOK | Slack | https://hooks.slack••• | Never | 1d ago | 🗑 |
| 🔑 WHATSAPP_TOKEN | WhatsApp | EAAx••••••••ZD | Mar 2026 ⚠ | 10m ago | 🗑 |

Expiring soon items highlighted with amber warning icon.

BOTTOM: "Access Audit Log" collapsible section:
| Action | Credential | Actor | Timestamp | IP |
| READ | ANTHROPIC_API_KEY | agent:atlas | 3 min ago | 127.0.0.1 |
| CREATE | WHATSAPP_TOKEN | admin@astra | 2d ago | 192.168.1.1 |
| ROTATE | OPENAI_API_KEY | admin@astra | 5d ago | 192.168.1.1 |

Secure, vault-like aesthetic. Masked values, audit trail visible.
```

---

## 10. Settings Page

```
Design a Settings page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed main sidebar + settings sub-sidebar.

SETTINGS SIDEBAR (200px, left):
Sections with icons:
- General (active, indigo highlight)
- LLM Providers
- Authentication
- Users & Roles
- Organizations
- Security
- Channels
- Storage
- Notifications
- Appearance

MAIN CONTENT — "General Settings":

Section 1: "Instance Configuration"
- Instance Name: text input → "AstraOS Production"
- Default Model: dropdown → "Claude Sonnet 4"
- Max Concurrent Agents: number input → 10
- Log Level: dropdown → "info" (options: debug, info, warn, error)
- Timezone: dropdown → "Asia/Kolkata (IST)"

Section 2: "LLM Providers" (preview cards):
4 provider cards in a row:
- Anthropic — Claude — "Connected ✓" green — models: Sonnet 4, Opus 4, Haiku
- OpenAI — GPT — "Connected ✓" green — models: GPT-4o, o3
- Google — Gemini — "Connected ✓" green — models: 2.5 Pro, 2.5 Flash
- Ollama — Local — "Running ✓" green — models: Llama3, Mistral

Section 3: "System Info"
- Version: 4.0.1
- Node.js: v22.x
- Platform: linux/arm64
- Memory: 512MB / 2GB
- Skills: 55 loaded
- Uptime: 14d 3h 22m

Footer: "Save Changes" indigo button + "Reset to Defaults" ghost button.

Clean settings layout with clear sections, good use of whitespace. Inspired by GitHub/Linear settings.
```

---

## 11. Conversations / Chat View

```
Design a Conversations page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

LEFT PANEL (320px) — Active Sessions list:
- Search bar: "Filter sessions..."
- Session list items:
  Each: avatar/channel icon, session ID (truncated), channel badge (Telegram, API, WebSocket, etc.), "last active" timestamp, unread dot indicator.

  5 sessions shown:
  1. 🟢 sess_a8f3... — Telegram — "2 min ago" — unread blue dot
  2. 🟢 sess_b2c1... — WebSocket — "5 min ago"
  3. 🟢 sess_c7d4... — WhatsApp — "12 min ago"
  4. 🟡 sess_d1e5... — Discord — "1h ago"
  5. ⚪ sess_e9f2... — REST API — "3h ago"

RIGHT PANEL — Chat view (selected session):
Top bar: session ID, channel "Telegram", agent "Atlas", duration "12 min", "End Session" red button.

Chat messages:
- User message (right, dark bubble): "What's the weather in Coimbatore today?"
- Agent message (left, indigo-tinted bubble): "🌤 Currently in Coimbatore: 28°C, partly cloudy. Humidity 65%. Today's high: 32°C, low: 24°C."
  - Below: tool usage indicator — "Used: weather-alerts" in muted text with tool icon
- User: "Set a reminder for my meeting at 3 PM"
- Agent: "✅ Reminder set for 3:00 PM today. I'll notify you 10 minutes before."
  - Tool: "Used: smart-scheduler"
- User: "Thanks! Also check my portfolio"
- Agent: "📊 Your portfolio summary: NIFTY +1.2%, Gold ₹87,450 (+0.3%), Total P&L: +₹12,340 today."
  - Tool: "Used: stock-watcher, finance-guru"

Bottom: input area (disabled/view-only for admin monitoring), with note "Monitoring mode — messages are read-only"

Real-time chat monitoring interface. Clean message bubbles with tool attribution.
```

---

## 12. Traces & Metrics (Observability)

```
Design a Traces & Metrics observability page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

TOP: "Traces & Metrics" heading with activity icon.

COUNTER ROW — 4 metric cards:
- "Total Requests" — 24,892 — trending up ↑12% — blue
- "Tool Calls" — 8,341 — sparkline — green
- "Self-Heals" — 23 — stable — amber
- "Errors" — 47 — trending down ↓8% — red

LATENCY CHART (full width):
"Response Latency Distribution" — histogram/bar chart showing latency buckets:
<100ms, 100-500ms, 500ms-1s, 1-2s, 2-5s, >5s
Color gradient from green (fast) to red (slow). Avg: 340ms, P50: 280ms, P99: 2.1s shown as overlay labels.

TRACES TABLE (main content, full width):
| Span | Duration | Status | Start Time | Agent |
|------|----------|--------|------------|-------|
| 🟣 chat.completion | 1.2s | ✓ 200 | 14:23:01 | Atlas |
| 🟢 tool.weather | 0.3s | ✓ 200 | 14:23:02 | Atlas |
| 🟣 chat.completion | 0.8s | ✓ 200 | 14:22:45 | Sentinel |
| 🔴 chat.completion | 5.2s | ✗ 500 | 14:22:30 | Coder |
| 🟢 tool.web-search | 0.6s | ✓ 200 | 14:22:28 | Atlas |
| 🟡 chat.stream | 2.1s | ✓ 200 | 14:21:55 | Support |
| 🟢 memory.search | 0.1s | ✓ 200 | 14:21:50 | Atlas |

Duration color-coded: green <1s, yellow 1-3s, red >3s.
Expandable rows showing span attributes (key-value pairs).

Filter bar: time range selector (1h, 6h, 24h, 7d), status filter, agent filter.

OpenTelemetry-inspired observability dashboard. Clean data table with visual indicators.
```

---

## 13. SDK Console

```
Design a Skill SDK Console page for "AstraOS" — dark theme AI operating system.

Screen: 1440×900. Collapsed sidebar.

TOP: "Skill SDK" heading with code icon, "Documentation ↗" link button.

THREE-COLUMN LAYOUT:

LEFT (280px) — "Templates":
- Search: "Filter templates..."
- Template list (scrollable):
  - 📊 data-analyzer (selected, indigo bg)
  - 🔍 web-search
  - 📧 email-automation
  - 🤖 ai-assistant
  - 📁 file-processor
  - 🔐 security-tool
  - 📡 api-integration
  - 💬 chat-bot
  - 📈 trading-signal
  - 🛠 developer-tool
  Each with name and one-line description below.

CENTER (flex) — "Create & Test" workspace:
Top tabs: Create | Validate | Test | Package

CREATE tab (active):
- Form:
  - Skill Name: "my-data-analyzer"
  - Template: "data-analyzer" (pre-filled from left selection)
  - Description: "Analyze CSV and JSON data files"
  - Category: dropdown → "Data & Analytics"
  - Version: "1.0.0"
  - Permissions: checkboxes → ☑ network ☑ file-read ☐ file-write ☐ env-access
- "Create Skill →" indigo button

RIGHT (320px) — "Live Output" console:
Dark terminal-style panel (#0A0A0F) with monospace text:
```
> Creating skill: my-data-analyzer
✓ Generated SKILL.md frontmatter
✓ Created handler.ts from template
✓ Generated README.md
✓ Initialized test suite

> Validating...
✓ Name format valid
✓ Version 1.0.0 (semver ok)
✓ Category: data-analytics ✓
✓ Permissions declared
✓ Security scan: 0 issues

⚡ Skill ready at: skills/my-data-analyzer/
```

Bottom status bar: "SDK v4.0.1 • 23 templates available • Docs: /api/sdk"

Developer-focused, IDE-like feel. Clean three-panel layout with live terminal output.
```

---

## 14. Trading Dashboard

```
Design a Trading Dashboard for "AstraOS" — dark theme AI agent operating system.

Screen: 1440×900. This is a specialized view for the trading agent.

TOP BAR: "Trading Engine" heading, market status badge "Markets Open 🟢", agent "Trader" status, "Auto-trade: OFF" toggle.

ROW 1 — Portfolio Summary Cards:
- "Portfolio Value" — ₹12,45,678 — +₹23,450 (+1.9%) today — green
- "Day P&L" — +₹23,450 — chart sparkline — green
- "Win Rate" — 67.3% — circular progress — indigo
- "Active Positions" — 5 — with risk indicator — blue

ROW 2 — Main Chart (60% width) + Signals Panel (40%):

LEFT: Large candlestick chart (NIFTY 50), dark background:
- Green/red candles, volume bars below
- Moving averages: SMA20 (blue), EMA50 (yellow), BB bands (gray fill)
- RSI indicator below: 58.3 (neutral zone)
- Time controls: 1m, 5m, 15m, 1h, 1D, 1W

RIGHT: "AI Signals" panel:
- Signal card 1: "BUY RELIANCE" — Confidence: 78% — green — "Bullish divergence on RSI + volume surge"
- Signal card 2: "HOLD TCS" — Confidence: 65% — gray — "Consolidation phase, wait for breakout"
- Signal card 3: "SELL HDFC" — Confidence: 72% — red — "Death cross forming on 4h chart"
- Each with: timestamp, strategy tag, risk level indicator

ROW 3 — Open Positions Table:
| Asset | Side | Entry | Current | P&L | Risk Score | Action |
| RELIANCE | LONG | ₹2,850 | ₹2,892 | +₹4,200 🟢 | Low | Close |
| INFY | LONG | ₹1,580 | ₹1,565 | -₹1,500 🔴 | Medium | Close |
| NIFTY FUT | SHORT | 22,450 | 22,380 | +₹5,250 🟢 | High | Close |
| GOLD | LONG | ₹87,200 | ₹87,450 | +₹2,500 🟢 | Low | Close |
| USD/INR | SHORT | 83.45 | 83.52 | -₹700 🔴 | Low | Close |

Bloomberg terminal-inspired but modern and clean. Data-rich trading interface.
```

---

## 15. Mobile Responsive — Dashboard

```
Design a mobile-responsive version of the AstraOS dashboard — dark theme.

Screen: 390×844 (iPhone 15 size).

TOP BAR: Hamburger menu icon, "AstraOS" wordmark centered, notification bell right.

CONTENT (scrollable):

Greeting: "Good afternoon, kowsi" with date.

Stat cards (2×2 grid, compact):
- Active Agents: 7 🟢
- Sessions: 23
- Skills: 55
- Uptime: 99.97%

Request Volume chart (full width, compact area chart, 120px tall).

Quick Actions (horizontal scroll pills):
"+ Agent", "New Workflow", "Search Memory", "Run Scan"

Active Agents list (compact cards):
- Atlas — Claude Sonnet 4 — Active 🟢
- Sentinel — GPT-4o — Active 🟢
- Trader — Claude Opus 4 — Paused 🟡

Recent Activity feed:
- "New session from Telegram" — 2m ago
- "Skill weather-alerts executed" — 5m ago
- "Security scan completed: A+" — 1h ago

BOTTOM NAV BAR (fixed):
5 icons: Home, Agents, Chat, Skills, Settings
Home is active (indigo).

Clean mobile layout, thumb-friendly touch targets, no clutter.
```

---

## Tips for Best Results in Figma Make

1. **Generate one screen at a time** — don't combine multiple screens
2. **After generating, manually adjust**: spacing, alignment, and exact colors
3. **Create components**: convert repeated elements (cards, nav items) into Figma components
4. **Use Auto Layout**: apply after generation for responsive behavior
5. **Add interactions**: use Figma prototyping to link screens together
6. **Export tokens**: use the design system sheet to create a tokens.json for dev handoff

---

*Generated for AstraOS v4.0.1 — 15 screens covering the complete platform UI*
