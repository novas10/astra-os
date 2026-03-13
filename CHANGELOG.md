# Changelog

All notable changes to AstraOS are documented here.

## [4.2.0] - 2026-03-13

### Platform — One Step Ahead

#### 8 New LLM Providers (4 → 12 total)
- **AWS Bedrock** — Full SigV4 signing using Node.js crypto, Converse API
- **Mistral** — mistral-large-latest, codestral, pixtral
- **OpenRouter** — OpenAI-compatible with X-Title header, org/model routing
- **Cohere** — v2 Chat API, content block parsing, TOOL_CALL handling
- **Groq** — Ultra-fast inference, OpenAI-compatible
- **DeepSeek** — deepseek-chat, deepseek-reasoner
- **Together** — Open-source models (Llama, Mixtral)
- **HuggingFace** — Per-model URL pattern inference

#### 7 New Channel Adapters (14 → 21+ total)
- **IRC** — Raw TCP/TLS, PING/PONG, PRIVMSG, auto-reconnect
- **Twitch** — TMI over WSS, IRC tags parsing, channel join/part
- **LINE** — Messaging API webhook, HMAC-SHA256 signature verification
- **Feishu/Lark** — Event subscription, tenant access token lifecycle
- **Mattermost** — WebSocket + REST, personal access token auth
- **Nextcloud Talk** — OCS API long-polling, Basic auth
- **Nostr** — NIP-01 events, NIP-04 AES-256-CBC encrypted DMs, multi-relay

#### Advanced AI (NEW — no competitor has these)
- **Agent Orchestrator** — 6 multi-agent patterns: pipeline, parallel, supervisor, debate, consensus, hierarchical. Execution tracing, retry with backoff
- **Reasoning Engine** — 5 strategies: chain-of-thought, tree-of-thought, self-consistency, reflection, metacognition. Confidence scoring
- **Real-time Collaboration** — Shared sessions with presence (active/idle/away), history replay, collaborative workflows, agent-to-agent messaging
- **Model Fallback** — Circuit breaker (5 failures → open, 30s half-open), rolling 100-request health window, p50/p95/p99 latency, cost-aware routing
- **Budget Manager** — Per-user/tenant/session token limits, cost calculation with MODEL_PRICING table, 80/90/100% alerts, usage analytics

#### Plugin SDK (NEW)
- **Plugin types** — AstraPlugin interface, PluginContext, PluginManifest
- **PluginSDK** — definePlugin(), createPluginLogger(), createPluginConfig(), createPluginVault(), validateManifest()
- **PluginLoader** — Dynamic loading from plugins/ directory, topological sort for dependency resolution, hot-reload via fs.watch
- **PluginManager** — Lifecycle orchestrator, hook routing (onMessage, onResponse, onToolCall), circuit breaker health monitoring, cron scheduling
- **3 example plugins** — hello-world, auto-tagger, usage-reporter

#### 4 New Embedding Providers (2 → 6 total)
- **Gemini** — text-embedding-004, 768 dimensions, outputDimensionality control
- **Mistral** — mistral-embed, 1024 dimensions, native batch
- **Voyage AI** — voyage-3, 1024 dimensions, native batch
- **Cohere** — embed-v4.0, input_type semantics (search_document/search_query), `asQueryProvider()` helper

#### 3 New TTS Engines (1 → 4 total)
- **OpenAI TTS** — tts-1, tts-1-hd, gpt-4o-mini-tts; 6 voices (alloy, echo, fable, onyx, nova, shimmer)
- **Edge TTS** — Free Microsoft Edge TTS via WebSocket, SSML, no API key needed
- **Google Cloud TTS** — WaveNet/Neural2 voices, multi-language support

#### i18n System (NEW — 7 languages)
- Singleton I18n class with t(key, params?), CLDR pluralization via Intl.PluralRules
- formatNumber(), formatCurrency(), formatDate(), formatRelativeTime()
- Locale files: English, Hindi, Tamil, Chinese, Japanese, Spanish, Arabic

#### Daemon Mode (NEW)
- **DaemonManager** — Cross-platform: auto-detects OS, install/uninstall/start/stop/restart/status
- **systemd** — Security-hardened unit file for Linux
- **launchd** — macOS plist for persistent background service
- **Windows** — Service wrapper for Windows Service Manager

#### Dashboard — 3 New Pages (14 → 17 total)
- **Plugins** — Plugin management with health monitoring, enable/disable, install
- **Budget** — Usage tracking, cost analytics, alert thresholds, model pricing
- **i18n** — Locale management, translation browser, format previews

#### CI/CD Enhancements
- **Security scanning job** — npm audit, secret detection, license compliance
- **npm publish job** — Automatic npm publish on tagged releases with provenance
- **Test count guard** — Warning if test count drops below 600

#### Testing — 602 tests (293 → 602, +105%)
- **llm-providers.test.ts** — 83 tests: all 8 providers, ProviderRegistry, ModelFallback, BudgetManager
- **channel-adapters.test.ts** — 53 tests: all 7 new channel adapters
- **plugins.test.ts** — 67 tests: PluginSDK, PluginLoader, PluginManager
- **advanced-features.test.ts** — 106 tests: AgentOrchestrator, ReasoningEngine, RealtimeEngine, I18n, TTSProviders, DaemonManager
- Fixed LINE adapter timingSafeEqual buffer length bug
- Aligned gateway test with CVE-2026-25253 security hardening (query param auth rejection)

#### Bug Fixes
- **LINE adapter** — Fixed `timingSafeEqual` crash when signature lengths differ (added buffer length pre-check)
- **Gateway static serving** — Dashboard now served via express.static in production (was missing)

### Vajra Trading Engine v3.1 — Complete Institutional Forex Arsenal

#### 9 New Technical Indicators
- **Fibonacci Extensions** — 1.0, 1.272, 1.414, 1.618, 2.0, 2.618 projection levels for TP targeting
- **Parabolic SAR** — Wilder's trend reversal + trailing stop with acceleration factor
- **Heikin-Ashi** — Noise-reduced candles for trend clarity
- **Chaikin Money Flow (CMF)** — Volume flow direction confirmation (-1 to +1)
- **Hull Moving Average (HMA)** — Low-lag moving average using WMA composition
- **TTM Squeeze** — Bollinger inside Keltner = volatility compression detection
- **Aroon** — Trend timing (periods since highest high / lowest low)
- **Elder Ray** — Bull/Bear power (high/low vs EMA)
- **Choppiness Index** — Trend vs chop detection (<38.2 trending, >61.8 choppy)

#### 13 New SMC/ICT Concepts
- **RSI Divergence** — Regular + hidden divergence (4 types) with swing-matching
- **MACD Divergence** — Regular + hidden divergence on histogram peaks/troughs
- **Breaker Blocks** — Failed order blocks that flip polarity (bull OB → bear breaker)
- **Mitigation Blocks** — OBs with >50% fill (partially mitigated, still relevant)
- **Optimal Trade Entry (OTE)** — ICT 62-79% Fibonacci retracement zone
- **Judas Swing / Inducement** — Fake breakout beyond structure that reverses in 1-3 candles
- **Session Range Analysis** — Asian/London/NY high-low-mid-range tracking
- **Market Maker Model** — Accumulation → Manipulation → Distribution → Expansion phases
- **Displacement Detection** — Institutional moves: body >70% of range + >2x ATR
- **Anchored VWAP** — VWAP from specific swing point
- **Wyckoff Phases** — Spring (bullish reversal) + Upthrust (bearish reversal)
- **Harmonic Patterns** — Gartley, Butterfly, Bat, Crab detection via Fibonacci ratios
- **Supply/Demand Zones** — Base-departure zones with freshness tracking

#### 3 New Trading Strategies (5 → 8 total)
- **ICT Silver Bullet** — FVG fill during 10-11 AM NY / 2-3 PM NY / 3-4 AM NY with displacement
- **Divergence Strategy** — RSI divergence + MACD confirmation + structure validation
- **Session Breakout** — Asian range breakout on London Open with volume + ADX confirmation

#### 12-Factor Confluence (was 9)
- **Divergence Confirmation (7%)** — Double divergence aligned = 95, single = 80, conflicting = 30
- **Session Context (6%)** — Asian range breakout during London = 90, inside range = 40
- **Fibonacci Confluence (4%)** — Price in OTE zone = 90-95, aligned direction boost
- Rebalanced existing weights: Trend(17), Volume(12), Agreement(8), S/R(13), Momentum(8), Candles(7), KillZone(5), Structure(8), Entry(5)

#### Win-Rate Hierarchy (GET /api/vajra/hierarchy)
- **Tier 1 Foundation (70-85%)** — HTF Trend, BOS/CHoCH, Liquidity Sweeps, OTE+OB
- **Tier 2 Confirmation (+10-15%)** — Divergence, Session Range, Volume Profile, Entry Quality
- **Tier 3 Refinement (+5-10%)** — Fib Extensions, Breaker Blocks, Market Maker Model, Harmonics
- **Tier 4 Edge (+2-5%)** — Wyckoff, TTM Squeeze, Displacement, Silver Bullet timing

## [4.1.0] - 2026-03-01

### Vajra Trading Engine v3.0 — Institutional-Grade SMC

- **FVG Integration** — Fair Value Gaps now wired into `smartMoneySignal()`: FVG+OB confluence (+0.10 confidence), FVG-only entries (0.65 base), previously dead code
- **Kill Zone Confluence** — New factor in 9-factor scoring: London Open, NY Open, NY Close, NSE Close kill zones boost score to 85; crypto gets 70 baseline (24/7)
- **Liquidity Sweep Detection** — Detects institutional stop hunts (wick beyond swing level + body rejection) with strong/moderate/weak grading; boosts confidence +0.15
- **Premium/Discount Zones (ICT)** — Blocks longs in premium zone, shorts in discount zone; wired into S/R confluence factor
- **Volume-Confirmed BOS/CHoCH** — Structure breaks now require 2/3 confirmations: volume (>1.2x avg), momentum bar (body >=60% range), displacement (>1.5x ATR)
- **Structure Health Analysis** — Tracks consecutive HH/HL/LL/LH patterns; gates entries on health score (penalty if <60)
- **Entry Candle Quality** — Pin bar (85), engulfing (80), inside bar breakout (75), rejection wick (70) scoring; adjusts SMC confidence
- **Multi-Timeframe Confirmation** — HTF context (1m->15m, 5m->1h, 15m->4h, 1h->4h, 4h->1d) with EMA50/200 trend + structure health; HTF-aligned strong = 95, counter-trend = 15
- **Structure-Based SL/TP** — SL at min(OB low, FVG bottom, swing low) - 0.3 ATR; TP at swing targets + liquidity zones (replaces arbitrary ATR multiples)
- **9-Factor Confluence** — Trend(20), Volume(15), Agreement(10), S/R(15), Momentum(10), Candles(10), KillZone(5), StructureHealth(10), EntryQuality(5); threshold raised 65->72
- **SMC-Weighted Agreement** — SMC strategy counts 2x in multi-strategy consensus scoring
- **Volume Profile in S/R** — VAH, VAL, POC from `volumeProfile()` now factor into S/R confluence scores
- **Adaptive Learner Expanded** — 3 new learnable weights (killZone, structureHealth, entryQuality) with SMC-performance-based adaptation rules

### Testing
- **284 unit tests** across 10 test suites (up from 272)
- 12 new SMC v3.0 tests: BOS/CHoCH strength validation, structure health, liquidity sweeps, premium/discount zones, entry quality, kill zones, 9-factor confluence

## [4.0.0] - 2026-03-01

### Vajra Trading Engine v2.0
- **Self-Improving AI Trading** — Agents learn from every trade outcome via feedback loop: Position closes → TradeJournal → StrategyTracker → AdaptiveLearner → Backtester → live weight updates
- **TradeJournal** — SQLite-backed trade log with full position lifecycle (entry, exit, P&L, R-multiple, strategy, regime)
- **StrategyTracker** — Per-strategy, per-regime performance tracking: win rate, Sharpe ratio, profit factor, consecutive losses, trend detection
- **AdaptiveLearner** — Automatic confluence and multi-factor weight optimization based on historical performance
- **Backtester** — Historical simulation engine with configurable weight sets and equity curve generation
- **SentimentAnalyzer** — Multi-source sentiment scoring for forex, crypto, and equities with headline ingestion
- **Memory Integration** — Trade outcomes saved to MemoryEngine (FTS5 + Vector) so agents can search past patterns via `memory_search`
- **Dashboard: Performance Page** — Strategy × regime heatmap, sortable metrics table, regime filtering, summary cards
- **Dashboard: Learning Page** — Confluence/multi-factor weight visualization, learning cycle trigger, backtester UI
- **Trading WebSocket** — Real-time market data streaming at `ws://localhost:3000/ws/vajra`
- **7 new API endpoints** — `/api/vajra/performance`, `/weights`, `/learn`, `/backtest`, `/sentiment`, `/best-strategy`, `/sentiment/headlines`
- **3 vajra skills updated** — forex, crypto, indian-market skills now reference learning endpoints and adaptive behavior

### Security
- **CORS middleware** — Origin-validated Cross-Origin Resource Sharing with preflight support (reads `ASTRA_CORS_ORIGINS` env var)
- **Input validation** — Message length limits (100K chars), type checking on `/api/chat`, `/api/chat/stream`, `/api/voice/*`
- **Sanitized error responses** — Production mode hides stack traces and internal error details; dev mode shows full details
- **Global error handler** — Express error-handling middleware catches unhandled errors across all routes
- **Graceful shutdown** — Drains in-flight HTTP requests and WebSocket connections with 10-second timeout on SIGTERM/SIGINT

### Observability
- **Request logging middleware** — Logs HTTP method, path, status code, and response duration for every request

### Testing
- **272 unit tests** across 10 test suites (up from 208/6)
- New test suites: RBAC (30 tests), MemoryEngine (8 tests), ProviderRegistry (14 tests), Middleware (12 tests)
- RBAC tests: permission matrix, JWT sign/verify, user CRUD, role middleware, API key rotation
- Memory tests: episodic JSONL, FTS5 indexing, hybrid search, stats
- Provider tests: model routing, heuristic fallback, conditional registration
- Middleware tests: CORS origin validation, preflight, error sanitization, request logger

### Build & Deploy
- **Dashboard in Docker** — Multi-stage Dockerfile now builds both backend and React dashboard
- **CI: dashboard job** — GitHub Actions validates dashboard TypeScript + Vite build
- **Dashboard ESLint config** — Separate `.eslintrc.cjs` for `packages/dashboard/`

## [3.5.0] - 2026-03-01

### Security
- **GatewayShield** — Comprehensive gateway security: CVE prevention (blocks auth tokens in URL query params), CSRF protection (double-submit cookie, SameSite=Strict), brute force lockout (10 attempts / 30-min), public exposure detection, security headers (HSTS, CSP, X-Frame-Options), IP allowlist/denylist, security grading (A+ to F)
- **CredentialVault** — AES-256-GCM encrypted credential storage with per-credential IV/salt, key rotation, access audit trail, auto-expiry, encrypted import/export
- **SkillSandbox** — Ed25519 cryptographic signing for verified publishers, AST-level static analysis, permission manifest enforcement, reputation scoring, quarantine system, community reporting
- Path traversal fix in DockerSandbox and SafeSandbox (`path.resolve()` + `startsWith()`)
- XSS prevention in Canvas with HTML sanitization and CSP headers
- Session memory leak fix with LRU eviction (cap 1000, 30-min TTL)

### Added
- **MCP Protocol** — Full MCP client + server. Connect external MCP tools and expose all AstraOS tools via JSON-RPC 2.0
- **A2A Protocol** — Google Agent-to-Agent protocol with agent cards at `/.well-known/agent.json`, task lifecycle, SSE streaming
- **GraphRAG Memory** — Three-tier hybrid retrieval: FTS5 full-text + vector embeddings (OpenAI/Ollama) + entity-relationship knowledge graph with Louvain community detection and Reciprocal Rank Fusion
- **Computer Use** — Screenshot-based GUI automation: screenshot, click, double_click, type, key, scroll, cursor_position, drag
- **Talk Mode** — Full-duplex voice: interrupt support, wake word, push-to-talk, ElevenLabs TTS, Whisper/Deepgram STT, VAD with configurable sensitivity
- **SSE Streaming** — `POST /api/chat/stream` for real-time streaming responses from all 4 LLM providers
- **OpenTelemetry** — Traces, metrics, spans, counters, and histograms for agent runs, tool calls, and LLM requests
- **Admin Dashboard** — React + Vite + Tailwind dark-mode UI with 11 pages: Home, Agents, Conversations, Marketplace, Workflow Builder, Memory, Traces, Security, Skills, Vault, Settings
- **Visual Workflow Builder** — React Flow DAG editor with 7 node types: llm_call, tool_call, condition, parallel, loop, human_input, transform
- **DAG Workflow Engine** — Server-side DAG execution with checkpointing and resume-on-failure
- **Multi-Modal Vision** — Image analysis, document understanding, and chart interpretation via vision-capable LLMs
- **SSO** — SAML 2.0 + OpenID Connect (PKCE with S256) supporting Azure AD, Okta, Google Workspace, Auth0, OneLogin
- **RBAC** — 4 roles (Admin, Developer, Operator, Viewer), JWT auth, API key management, tenant isolation
- **Multi-Tenancy** — Plan-based quotas (Free/Pro/Team/Enterprise), tenant scoping, usage tracking
- **Audit Log** — Immutable SHA-256 chain-hashed trail with tamper detection, GDPR data export and erasure, SOC2/HIPAA compliance
- **Billing** — Stripe subscriptions, usage metering, invoices, Checkout sessions, Customer Portal, webhook handling
- **Data Residency** — 7 regions (India South, India Central, EU, US East, US West, Singapore, Local), AES-256-GCM encryption at rest, PII masking
- **Edge Runtime** — Offline-first with Ollama. Standalone, sync, and gateway modes with automatic reconnection
- **AstraHub Marketplace** — Search, browse, install, rate, review, and publish skills
- **SkillGenerator** — 23 templates for scaffolding production-ready skills
- **ClawHub Migration** — Import OpenClaw/ClawHub skills with automatic format conversion and security scanning
- **6 new channel adapters** — Signal, Matrix, Google Chat, iMessage (BlueBubbles), Zalo, Phone (Telnyx)
- **WebChat** — Embeddable chat widget with customizable theme
- **55 bundled skills** across 10 categories (Productivity, Developer, Data, Finance, IoT, Security, Content, Communication, AI/NLP, DevOps)
- **Config-first setup** — SOUL.md (agent personality) + AGENTS.md (multi-agent routing)
- **OpenAPI 3.1 spec** — Full API documentation at `/docs` via Swagger UI
- **Docker support** — Multi-stage Dockerfile + docker-compose with Redis
- **CI/CD** — GitHub Actions workflow for lint, typecheck, test, build
- **169 unit tests** across 5 test suites with Vitest

### Infrastructure
- TypeScript 5.x strict mode, 65 source files
- Express 4 gateway with 93+ REST API endpoints
- Multi-LLM support: Anthropic Claude, OpenAI GPT, Google Gemini, Ollama (local)
- Self-healing ReAct loop with automatic diagnosis and retry
- Context compaction for long conversations
- HeartbeatEngine with node-cron scheduling

## [2.0.0] - 2025-12-01

### Added
- Initial multi-LLM architecture (Anthropic, OpenAI, Gemini, Ollama)
- Self-healing ReAct agent loop with 17 tools
- Docker + process hybrid sandbox
- Browser CDP automation
- Voice AI (basic TTS/STT)
- Canvas/A2UI rendering
- Multi-agent routing
- Plugin skills via SKILL.md
- WhatsApp, Telegram, Discord, Slack, Teams adapters
- SQLite episodic + FTS5 memory
