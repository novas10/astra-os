# AstraOS v4.0 — Step-by-Step Guide

A complete guide to installing, configuring, and operating AstraOS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Running AstraOS](#4-running-astraos)
5. [First Interaction](#5-first-interaction)
6. [Agent Personality (SOUL.md)](#6-agent-personality-soulmd)
7. [Multi-Agent Setup (AGENTS.md)](#7-multi-agent-setup-agentsmd)
8. [Connecting Channels](#8-connecting-channels)
9. [Skills](#9-skills)
10. [Security Setup](#10-security-setup)
11. [Voice / Talk Mode](#11-voice--talk-mode)
12. [MCP Protocol](#12-mcp-protocol)
13. [A2A Protocol](#13-a2a-protocol)
14. [Workflows (DAG Engine)](#14-workflows-dag-engine)
15. [Admin Dashboard](#15-admin-dashboard)
16. [Enterprise Features](#16-enterprise-features)
17. [Docker Deployment](#17-docker-deployment)
18. [Edge / Offline Deployment](#18-edge--offline-deployment)
19. [Observability](#19-observability)
20. [Development & Testing](#20-development--testing)
21. [Troubleshooting](#21-troubleshooting)

---

## 1. Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 20.x | 22.x (LTS) |
| npm | 9.x | 10.x |
| OS | Windows 10 / macOS 12 / Ubuntu 20.04 | Latest LTS |
| RAM | 2 GB | 4 GB+ |
| Docker | 24.x (optional) | Latest (for sandbox/production) |
| Git | 2.x | Latest |

**LLM Provider** — You need at least ONE API key:
- [Anthropic](https://console.anthropic.com/) (Claude) — recommended default
- [OpenAI](https://platform.openai.com/) (GPT-4o)
- [Google AI Studio](https://aistudio.google.com/) (Gemini)
- [Ollama](https://ollama.ai/) (local, free, no API key needed)

---

## 2. Installation

### Option A: Clone from GitHub

```bash
git clone https://github.com/novas10/astra-os.git
cd astra-os
npm install
```

### Option B: Docker (skip to [Section 17](#17-docker-deployment))

```bash
git clone https://github.com/novas10/astra-os.git
cd astra-os
cp .env.example .env
# Edit .env with your API keys
docker compose up -d
```

### Verify Installation

```bash
# Should complete with no errors
npm run build
```

---

## 3. Configuration

### Step 3.1 — Create your .env file

```bash
cp .env.example .env
```

### Step 3.2 — Add an LLM provider key

Open `.env` in any text editor and set at least one:

```bash
# Pick ONE or more:
ANTHROPIC_API_KEY=sk-ant-api03-...     # Claude (recommended)
OPENAI_API_KEY=sk-proj-...             # GPT-4o
GEMINI_API_KEY=AIza...                 # Gemini
OLLAMA_BASE_URL=http://localhost:11434 # Local (free, no key needed)
```

**To use Ollama (fully free, local):**
1. Install Ollama from https://ollama.ai
2. Pull a model: `ollama pull llama3.2`
3. Set in `.env`:
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434
   DEFAULT_MODEL=llama3.2
   ```

### Step 3.3 — Set security keys (recommended)

```bash
# API keys for authenticating requests to AstraOS
ASTRA_API_KEYS=my-secret-key-1,my-secret-key-2

# Encryption key for CredentialVault (64-char hex string)
# Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MASTER_ENCRYPTION_KEY=your-64-char-hex-key

# JWT secret for auth tokens
JWT_SECRET=a-strong-random-string
```

### Step 3.4 — Configure server (optional)

```bash
PORT=3000                              # API server port
HOST=0.0.0.0                           # Listen address
NODE_ENV=development                   # or "production"
ASTRA_BASE_URL=http://localhost:3000   # Public-facing URL
```

### Full .env reference

See [.env.example](.env.example) for all 80+ environment variables with descriptions.

---

## 4. Running AstraOS

### Development mode (with hot-reload)

```bash
npm run dev
```

You should see output like:

```
AstraOS v3.5 | REST: :3000 | SSE: :3000/api/chat/stream
Protocols: MCP, A2A | Providers: anthropic, openai, gemini, ollama
Memory: FTS5 + Vector + GraphRAG | Skills: 55 loaded
Security: GatewayShield (A+) | CredentialVault | SkillSandbox
```

### Production mode

```bash
npm run build
npm start
```

### Verify it's running

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "version": "3.5.0",
  "uptime": 12,
  "providers": ["anthropic"],
  "channels": ["rest", "websocket"],
  "protocols": ["mcp", "a2a"],
  "memory": "graphrag",
  "skills": 55,
  "security": { "grade": "A+" }
}
```

---

## 5. First Interaction

### Send a chat message via REST API

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-key-1" \
  -d '{
    "message": "Hello! What can you do?",
    "userId": "user-1"
  }'
```

### Stream a response (SSE)

```bash
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-key-1" \
  -d '{
    "message": "Write me a haiku about coding",
    "userId": "user-1"
  }'
```

### Use a specific model

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Explain quantum computing",
    "userId": "user-1",
    "model": "gpt-4o"
  }'
```

### WebSocket (real-time)

Connect to `ws://localhost:3000` and send JSON messages:

```json
{
  "type": "chat",
  "message": "Hello from WebSocket",
  "userId": "user-1"
}
```

---

## 6. Agent Personality (SOUL.md)

The `SOUL.md` file in the project root defines your agent's personality. AstraOS reads it at startup and injects it as system context for every conversation.

### Edit SOUL.md

```markdown
---
name: Aria
voice: professional-yet-friendly
traits:
  - helpful
  - precise
  - security-conscious
constraints:
  - Never execute destructive commands without confirmation
  - Redact sensitive data in logs
---

You are Aria, a customer support agent for Acme Corp.
Be friendly, concise, and always offer follow-up help.
```

### Key fields

| Field | Purpose |
|-------|---------|
| `name` | Agent's display name |
| `voice` | Communication tone |
| `traits` | Behavioral characteristics |
| `constraints` | Hard rules the agent must follow |
| Body text | Detailed personality instructions |

Changes take effect on next restart (`npm run dev`).

---

## 7. Multi-Agent Setup (AGENTS.md)

The `AGENTS.md` file configures multiple specialized agents. Each agent gets its own skills, channels, model, and personality.

### Example AGENTS.md

```markdown
## Support Agent

\```yaml
description: Customer support agent
skills:
  - email-assistant
  - document-qa
channels:
  - whatsapp
  - webchat
model: claude-haiku
maxConcurrent: 20
\```

Friendly support agent that handles customer queries.

## DevOps Agent

\```yaml
description: Infrastructure specialist
skills:
  - docker-manager
  - ci-monitor
  - server-monitor
channels:
  - slack
  - teams
model: claude-sonnet
maxConcurrent: 5
\```

Handles deployments, CI/CD, and server monitoring.
```

### How routing works

1. A message arrives on a channel (e.g., WhatsApp)
2. AstraOS checks which agent is assigned to that channel
3. The matching agent processes the message with its assigned skills and model
4. If no specific agent matches, the default agent (from SOUL.md) handles it

---

## 8. Connecting Channels

### WhatsApp (Meta Business API)

1. Create a Meta Business App at https://developers.facebook.com
2. Set up WhatsApp Business API
3. Add to `.env`:
   ```bash
   WHATSAPP_VERIFY_TOKEN=my-verify-token
   WHATSAPP_PHONE_ID=123456789
   WHATSAPP_ACCESS_TOKEN=EAAx...
   ```
4. Set webhook URL in Meta dashboard: `https://your-domain.com/webhook/whatsapp`

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Add to `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   ```
3. Set webhook: `https://your-domain.com/webhook/telegram`

### Discord

1. Create an app at https://discord.com/developers
2. Add a Bot, copy the token
3. Add to `.env`:
   ```bash
   DISCORD_APP_ID=1234567890
   DISCORD_BOT_TOKEN=MTIz...
   ```

### Slack

1. Create an app at https://api.slack.com/apps
2. Enable Event Subscriptions, set URL: `https://your-domain.com/webhook/slack`
3. Add to `.env`:
   ```bash
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=abc123...
   ```

### Microsoft Teams

1. Register a Bot in Azure Bot Service
2. Add to `.env`:
   ```bash
   TEAMS_APP_ID=your-app-id
   TEAMS_APP_PASSWORD=your-app-password
   ```

### Signal

1. Set up [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api)
2. Add to `.env`:
   ```bash
   SIGNAL_PHONE_NUMBER=+1234567890
   SIGNAL_CLI_REST_URL=http://localhost:8080
   ```

### Matrix

```bash
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=syt_...
MATRIX_USER_ID=@mybot:matrix.org
```

### WebChat (Embeddable Widget)

WebChat starts automatically. Configure in `.env`:

```bash
WEBCHAT_PORT=18790
WEBCHAT_TITLE=My AI Assistant
WEBCHAT_PRIMARY_COLOR=#6366f1
```

Embed in any website:

```html
<iframe src="http://localhost:18790" width="400" height="600"></iframe>
```

### Phone (Telnyx)

```bash
TELNYX_API_KEY=KEY_...
TELNYX_CONNECTION_ID=123456
TELNYX_PHONE_NUMBER=+1234567890
```

### Verify active channels

```bash
curl http://localhost:3000/health
# Check the "channels" array in the response
```

---

## 9. Skills

AstraOS ships with **55 bundled skills** across 10 categories that are auto-loaded on startup.

### List installed skills

```bash
curl http://localhost:3000/api/skills
```

### Install from AstraHub marketplace

```bash
# Search
curl "http://localhost:3000/api/marketplace/search?q=weather"

# Install
curl -X POST http://localhost:3000/api/marketplace/skills/weather-alerts/install
```

### Create a custom skill

1. Create a folder: `skills/my-skill/`
2. Create `skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
version: 1.0.0
description: Does something useful
author: Your Name
triggers:
  - keyword1
  - keyword2
permissions:
  - network:outbound
---

When the user asks about keyword1 or keyword2, do the following:
1. Step one
2. Step two
3. Return the result
```

3. Restart AstraOS — the skill is auto-loaded

### Generate a skill from template

```bash
# List 23 available templates
curl http://localhost:3000/api/skills/templates

# Generate from template
curl -X POST http://localhost:3000/api/skills/generate \
  -H "Content-Type: application/json" \
  -d '{
    "template": "api-connector",
    "name": "my-api-skill",
    "author": "YourName"
  }'
```

### Migrate from OpenClaw / ClawHub

```bash
curl -X POST http://localhost:3000/api/skills/migrate \
  -H "Content-Type: application/json" \
  -d '{"source": "clawhub", "skillId": "some-skill"}'
```

---

## 10. Security Setup

AstraOS has three security subsystems that work out of the box.

### GatewayShield

Active by default. Provides:
- CSRF protection (double-submit cookie)
- Brute force lockout (10 attempts / 30 min)
- Security headers (HSTS, CSP, X-Frame-Options)
- IP allowlist/denylist

Configure in `.env`:

```bash
# Optional IP filtering
ASTRA_IP_ALLOWLIST=192.168.1.0/24,10.0.0.0/8
ASTRA_IP_DENYLIST=
ASTRA_CORS_ORIGINS=http://localhost:5173,https://yourdomain.com
```

Check security status:

```bash
curl http://localhost:3000/api/security/report
```

### CredentialVault

Encrypted storage for API keys and secrets.

```bash
# Set the master encryption key in .env
MASTER_ENCRYPTION_KEY=<64-char-hex>

# Store a credential via API
curl -X POST http://localhost:3000/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api-key",
    "value": "secret-value",
    "expiresIn": "30d"
  }'

# Check vault status
curl http://localhost:3000/api/credentials/status
```

### SkillSandbox

Automatically scans all skills on install for:
- Dangerous code patterns (AST-level analysis)
- Permission violations
- Ed25519 signature verification for trusted publishers

Flagged skills are quarantined until manually approved.

---

## 11. Voice / Talk Mode

### Prerequisites

- ElevenLabs API key (TTS): https://elevenlabs.io
- Deepgram API key (STT): https://deepgram.com — OR — OpenAI Whisper key

### Configure

```bash
ELEVENLABS_API_KEY=your-key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
DEEPGRAM_API_KEY=your-key
# OR
STT_API_KEY=your-openai-key
```

### Usage

```bash
# Text-to-Speech
curl -X POST http://localhost:3000/api/voice/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from AstraOS", "voiceId": "EXAVITQu4vr4xnSDxMaL"}'

# Speech-to-Text
curl -X POST http://localhost:3000/api/voice/stt \
  -F "audio=@recording.wav"
```

### WebSocket Talk Mode

Connect to `ws://localhost:3000` for full-duplex voice:
- Interrupt support (agent stops mid-sentence)
- Wake word detection
- Push-to-talk mode
- Voice Activity Detection (VAD)

---

## 12. MCP Protocol

AstraOS is both an MCP **client** (uses external MCP tools) and **server** (exposes its tools to other agents).

### As MCP Server

Other MCP-compatible tools can discover AstraOS tools at:

```
http://localhost:3000/mcp
```

All 17+ AstraOS tools are exposed via JSON-RPC 2.0.

### As MCP Client

Connect to external MCP servers by configuring them in your startup. External tools are automatically injected into the agent's tool set.

### Configure

```bash
MCP_SERVER_PORT=0  # 0 = same port as main server
```

---

## 13. A2A Protocol

AstraOS implements Google's Agent-to-Agent protocol for inter-agent communication.

### Agent Card

Your agent's capabilities are advertised at:

```bash
curl http://localhost:3000/.well-known/agent.json
```

### Send a task to AstraOS from another A2A agent

```bash
# Send a task
curl -X POST http://localhost:3000/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{
    "id": "task-1",
    "message": {
      "role": "user",
      "parts": [{"type": "text", "text": "Analyze this data"}]
    }
  }'

# Stream task progress (SSE)
curl -N -X POST http://localhost:3000/a2a/tasks/sendSubscribe \
  -H "Content-Type: application/json" \
  -d '{
    "id": "task-2",
    "message": {
      "role": "user",
      "parts": [{"type": "text", "text": "Generate a report"}]
    }
  }'
```

---

## 14. Workflows (DAG Engine)

Create multi-step workflows as directed acyclic graphs.

### Node types

| Type | Purpose |
|------|---------|
| `llm_call` | Call an LLM with a prompt |
| `tool_call` | Execute a tool |
| `condition` | Branch based on a condition |
| `parallel` | Run multiple nodes concurrently |
| `loop` | Iterate over items |
| `human_input` | Pause and wait for user input |
| `transform` | Transform data between steps |

### Create a workflow

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "data-pipeline",
    "nodes": [
      {"id": "fetch", "type": "tool_call", "tool": "web_scraper", "config": {"url": "..."}},
      {"id": "analyze", "type": "llm_call", "prompt": "Analyze this data: {{fetch.output}}"},
      {"id": "report", "type": "tool_call", "tool": "report_generator"}
    ],
    "edges": [
      {"from": "fetch", "to": "analyze"},
      {"from": "analyze", "to": "report"}
    ]
  }'
```

### Execute a workflow

```bash
curl -X POST http://localhost:3000/api/workflows/data-pipeline/run
```

Workflows support **checkpointing** — if a step fails, you can resume from the last successful step.

---

## 15. Admin Dashboard

The admin dashboard is a React + Vite + Tailwind application with dark mode.

### Start the dashboard

```bash
cd packages/dashboard
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Dashboard pages

| Page | What it shows |
|------|--------------|
| **Home** | Agent count, active sessions, request rate, error rate, token usage |
| **Agents** | Create/edit/delete agents, assign channels and skills |
| **Conversations** | Browse and search all conversations across all channels |
| **Marketplace** | Browse, install, rate, and review skills from AstraHub |
| **Workflow Builder** | Visual DAG editor using React Flow — drag-and-drop nodes |
| **Memory** | Browse episodic memory, visualize the knowledge graph |
| **Traces** | OpenTelemetry trace viewer, log search, error analysis |
| **Settings** | LLM providers, channel config, RBAC roles, environment |

### Build for production

```bash
npm run dashboard:build
# Output goes to packages/dashboard/dist/
```

---

## 16. Enterprise Features

### SSO (Single Sign-On)

Supports SAML 2.0 and OpenID Connect (PKCE with S256).

```bash
# SAML
SSO_SAML_ENTRY_POINT=https://idp.example.com/sso
SSO_SAML_ISSUER=astra-os
SSO_SAML_CERT=<base64-cert>

# OIDC (Google, Azure AD, Okta, Auth0)
SSO_OIDC_ISSUER=https://accounts.google.com
SSO_OIDC_CLIENT_ID=your-client-id
SSO_OIDC_CLIENT_SECRET=your-client-secret
```

```bash
# List configured SSO providers
curl http://localhost:3000/api/sso/providers
```

### RBAC (Role-Based Access Control)

4 built-in roles:

| Role | Permissions |
|------|------------|
| **Admin** | Full access — manage users, agents, settings, billing |
| **Developer** | Create/edit agents, skills, workflows, view traces |
| **Operator** | Monitor agents, view conversations, manage channels |
| **Viewer** | Read-only access to dashboards and conversations |

### Multi-Tenancy

Plan-based quotas:

| Plan | Agents | Messages/day | Channels |
|------|--------|-------------|----------|
| Free | 1 | 100 | 2 |
| Pro ($49/mo) | 10 | 10,000 | All |
| Team ($199/mo) | 50 | 100,000 | All |
| Enterprise | Unlimited | Unlimited | All |

### Audit Log

Immutable SHA-256 chain-hashed audit trail.

```bash
# Query audit log
curl http://localhost:3000/api/admin/audit?limit=50

# Verify integrity (tamper detection)
curl http://localhost:3000/api/admin/audit/verify

# GDPR data export
curl http://localhost:3000/api/admin/audit/export?userId=user-1

# GDPR right to erasure
curl -X DELETE http://localhost:3000/api/admin/audit/erase?userId=user-1
```

### Billing (Stripe)

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
```

```bash
# List plans
curl http://localhost:3000/api/billing/plans

# Create checkout session
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Content-Type: application/json" \
  -d '{"plan": "pro", "tenantId": "tenant-1"}'
```

### Data Residency

7 regions with AES-256-GCM encryption at rest:

| Region | Location |
|--------|----------|
| `in-south` | India South |
| `in-central` | India Central |
| `eu` | European Union |
| `us-east` | US East |
| `us-west` | US West |
| `sg` | Singapore |
| `local` | On-Premise |

```bash
# List available regions
curl http://localhost:3000/api/admin/data-residency/regions
```

---

## 17. Docker Deployment

### Quick start with Docker Compose

```bash
# 1. Clone and configure
git clone https://github.com/novas10/astra-os.git
cd astra-os
cp .env.example .env
# Edit .env with your API keys

# 2. Start everything
docker compose up -d

# 3. Verify
curl http://localhost:3000/health
```

This starts:
- **astra-os** on port 3000 (API) + 18793 (Canvas)
- **redis** on port 6379 (session store, rate limiting)

### Build and run manually

```bash
# Build the image
docker build -t astra-os .

# Run
docker run -d \
  --name astra-os \
  -p 3000:3000 \
  -p 18793:18793 \
  --env-file .env \
  astra-os
```

### With Qdrant vector database (optional)

Uncomment the `qdrant` section in `docker-compose.yml`:

```yaml
qdrant:
  image: qdrant/qdrant:latest
  container_name: astra-qdrant
  ports:
    - "6333:6333"
  volumes:
    - qdrant-data:/qdrant/storage
```

Then set in `.env`:

```bash
QDRANT_URL=http://astra-qdrant:6333
QDRANT_API_KEY=your-key
```

### Docker commands

```bash
npm run docker:build    # Build image
npm run docker:up       # Start containers
npm run docker:down     # Stop containers
docker compose logs -f  # View logs
```

---

## 18. Edge / Offline Deployment

AstraOS can run fully offline using Ollama for local LLM inference.

### Setup

1. Install Ollama: https://ollama.ai
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ollama pull nomic-embed-text  # For embeddings
   ```
3. Configure `.env`:
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_EMBEDDING_MODEL=nomic-embed-text
   DEFAULT_MODEL=llama3.2
   ```

### Edge modes

| Mode | Description |
|------|------------|
| **Standalone** | Fully offline, no cloud connection |
| **Sync** | Works offline, syncs when connectivity is restored |
| **Gateway** | Routes to cloud LLMs when available, falls back to local |

```bash
# Check edge runtime status
curl http://localhost:3000/api/edge/status
```

---

## 19. Observability

### OpenTelemetry

AstraOS emits traces, metrics, and spans for every agent run, tool call, and LLM request.

```bash
# Enable in .env
OTEL_ENABLED=true
TELEMETRY_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=astra-os
```

### View metrics and traces

```bash
# Metrics summary
curl http://localhost:3000/api/metrics

# Recent traces
curl http://localhost:3000/api/traces
```

### Compatible backends

- [Jaeger](https://www.jaegertracing.io/) — traces
- [Grafana](https://grafana.com/) + Tempo — traces + dashboards
- [Prometheus](https://prometheus.io/) — metrics
- Any OTLP-compatible collector

### Logging

```bash
LOG_LEVEL=info    # debug, info, warn, error
LOG_FORMAT=json   # Structured JSON logs for production
```

---

## 20. Development & Testing

### Available scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with hot-reload (ts-node-dev) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm run test` | Run all 169 tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run lint` | Check for linting errors |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Type-check without emitting |

### Project structure

```
astra-os/
├── src/
│   ├── core/           # AgentLoop (ReAct engine), context compactor
│   ├── llm/            # 4 LLM providers (Anthropic, OpenAI, Gemini, Ollama)
│   ├── channels/       # Gateway + 12 channel adapters
│   ├── memory/         # MemoryEngine, EmbeddingProvider, VectorStore, GraphRAG
│   ├── tools/          # BrowserEngine, ComputerUse, VisionEngine
│   ├── skills/         # SkillsEngine, SkillGenerator, SkillMigrator, AstraHub
│   ├── sandbox/        # DockerSandbox, SafeSandbox
│   ├── voice/          # VoiceEngine (Talk Mode)
│   ├── canvas/         # CanvasServer (A2UI)
│   ├── mcp/            # MCP client + server + registry
│   ├── a2a/            # A2A protocol
│   ├── agents/         # AgentRouter (multi-agent)
│   ├── workflow/       # WorkflowEngine (DAG)
│   ├── auth/           # RBAC + multi-tenancy
│   ├── middleware/     # Auth, rate limiting
│   ├── security/       # GatewayShield, CredentialVault, SkillSandbox
│   ├── enterprise/     # SSO, AuditLog, Billing, DataResidency
│   ├── edge/           # EdgeRuntime (Ollama offline)
│   ├── marketplace/    # MarketplaceServer
│   ├── telemetry/      # OpenTelemetry
│   ├── heartbeat/      # HeartbeatEngine (cron)
│   ├── utils/          # Logger
│   ├── docs/           # OpenAPI spec + Swagger UI
│   └── __tests__/      # 5 test suites, 169 tests
├── packages/
│   └── dashboard/      # React + Vite + Tailwind admin UI
├── skills/             # Bundled + custom skills (SKILL.md format)
├── SOUL.md             # Agent personality config
├── AGENTS.md           # Multi-agent routing config
├── .env.example        # All environment variables
├── Dockerfile          # Multi-stage Docker build
├── docker-compose.yml  # Docker Compose with Redis
└── .github/workflows/  # CI/CD pipeline
```

### API Documentation

Swagger UI is available at:

```
http://localhost:3000/docs
```

Raw OpenAPI 3.1 spec:

```
http://localhost:3000/docs/openapi.json
```

---

## 21. Troubleshooting

### "Cannot find module" errors on startup

```bash
# Rebuild
npm run build

# Or in dev mode
npm run dev
```

### "No LLM provider configured"

Make sure at least one API key is set in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# OR
OPENAI_API_KEY=sk-...
# OR
OLLAMA_BASE_URL=http://localhost:11434
```

### Port already in use

```bash
# Change the port in .env
PORT=3001
```

### Docker build fails

```bash
# Ensure Docker is running
docker info

# Rebuild without cache
docker compose build --no-cache
docker compose up -d
```

### Tests failing

```bash
# Run tests with verbose output
npx vitest run --reporter=verbose

# Run a specific test suite
npx vitest run src/__tests__/core/AgentLoop.test.ts
```

### ESLint errors

```bash
# Auto-fix
npm run lint:fix

# Check what's left
npm run lint
```

### Memory/SQLite errors

```bash
# Delete and recreate the memory directory
rm -rf .astra-memory
npm run dev
# Memory is auto-initialized on startup
```

### Ollama connection refused

```bash
# Make sure Ollama is running
ollama serve

# Check it's accessible
curl http://localhost:11434/api/tags
```

### Channel webhook not receiving messages

1. Ensure your server is publicly accessible (use ngrok for local dev)
2. Verify the webhook URL is correctly set in the platform's dashboard
3. Check logs: `LOG_LEVEL=debug npm run dev`

---

## 22. Vajra Trading Engine

Vajra is AstraOS's self-improving AI trading system. It learns from every trade outcome.

### Quick Start

1. **No configuration needed for paper trading** — Vajra starts with `broker: "paper"` by default.
2. Access the trading terminal at http://localhost:5173/trading
3. Access the WebSocket feed at `ws://localhost:3000/ws/vajra`

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vajra/performance` | GET | Strategy performance metrics |
| `/api/vajra/performance/:strategy` | GET | Performance for a specific strategy |
| `/api/vajra/best-strategy/:regime` | GET | Best strategy for a market regime |
| `/api/vajra/weights` | GET | Current adaptive weights |
| `/api/vajra/learn` | POST | Trigger a learning cycle |
| `/api/vajra/backtest` | POST | Run a backtest simulation |
| `/api/vajra/sentiment/:symbol` | GET | Sentiment score for a symbol |
| `/api/vajra/sentiment/headlines` | POST | Ingest headlines for sentiment |

### How the Feedback Loop Works

```
Trade closes → TradeJournal (SQLite) + MemoryEngine (FTS5+Vector)
            → StrategyTracker updates per-strategy/regime metrics
            → AdaptiveLearner re-optimizes confluence weights
            → Backtester validates new weights against history
            → Live weights updated for next signal generation
            → Dashboard shows real-time performance + learning status
```

### Dashboard Pages

- **Terminal** (`/trading`) — Live charts, order entry, position management
- **Risk** (`/trading/risk`) — Portfolio risk metrics, drawdown analysis
- **Journal** (`/trading/journal`) — Trade log with filters and stats
- **Scanner** (`/trading/scanner`) — Market scanning and signal detection
- **Performance** (`/trading/performance`) — Strategy × regime heatmap, sortable metrics
- **Learning** (`/trading/learning`) — Adaptive weight visualization, backtest UI

### Broker Configuration (Optional)

```bash
# .env
VAJRA_BROKER=paper              # paper | alpaca
VAJRA_ACCOUNT_BALANCE=100000
VAJRA_ALPACA_KEY=your-key       # For live/paper Alpaca trading
VAJRA_ALPACA_SECRET=your-secret
VAJRA_ALPACA_PAPER=true
```

---

## Quick Reference Card

| What | How |
|------|-----|
| Start dev server | `npm run dev` |
| Send a message | `POST /api/chat` with `{"message": "...", "userId": "..."}` |
| Stream response | `POST /api/chat/stream` (SSE) |
| Health check | `GET /health` |
| API docs | http://localhost:3000/docs |
| Dashboard | http://localhost:5173 |
| Trading terminal | http://localhost:5173/trading |
| Agent card (A2A) | `GET /.well-known/agent.json` |
| Security report | `GET /api/security/report` |
| List skills | `GET /api/skills` |
| Trading performance | `GET /api/vajra/performance` |
| Trigger learning | `POST /api/vajra/learn` |
| Metrics | `GET /api/metrics` |
| Docker start | `docker compose up -d` |
| Run tests | `npm run test` |
| Build | `npm run build` |

---

*AstraOS v4.0 — Where there is Astra, there is victory.*
