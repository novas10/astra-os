# Changelog

All notable changes to AstraOS are documented here.

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
