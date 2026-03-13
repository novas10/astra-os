# AstraOS v4.0.1 — Launch Manual

> Practical guide for launching, operating, and developing AstraOS.
> Last updated: 2026-03-13

---

## Current State

### What's Ready

| Component | Status | Notes |
|-----------|--------|-------|
| Backend (Gateway, AgentLoop, 14+ channels) | Ready | TypeScript compiled, all routes wired |
| Dashboard (13 pages, glassmorphism UI) | Ready | React 19 + Vite 6 + Tailwind |
| Security (GatewayShield, Vault, Sandbox) | Ready | AES-256-GCM, Ed25519 signing |
| Skills Engine (55+ bundled) | Ready | Auto-loaded from `skills/` |
| MCP + A2A protocols | Ready | Client + Server |
| GraphRAG Memory | Ready | FTS5 + Vector + Knowledge Graph |
| Docker (multi-stage build) | Ready | Dashboard served via express.static |
| Deploy configs (Railway, Render, Fly, K8s) | Ready | One-click deploy buttons |
| OpenAPI docs (Swagger UI) | Ready | `/docs` endpoint |
| CLI onboarding wizard | Ready | `npx astra-os` |
| Setup scripts (bash + PowerShell) | Ready | Cross-platform |
| Integration + SDK tests | Ready | Vitest |

### What Needs Attention Before Public Launch

| Item | Priority | Action Needed |
|------|----------|---------------|
| npm publish | HIGH | Run `npm login` then `npm publish` (ENEEDAUTH on current machine) |
| GitHub repo visibility | HIGH | Make repo public at github.com/AstraOS-India/astra-os |
| .env secrets | HIGH | Never commit real API keys — only `.env.example` |
| Gateway test fix | LOW | `should accept api_key from query params` test fails (intentional — security hardening removed query param auth) |
| Bundle size | LOW | Dashboard is 1MB minified — add code splitting with `React.lazy()` later |

---

## How to Launch (Step by Step)

### Step 1 — Local Dev (Your Machine)

```bash
# 1. Install dependencies
npm install
cd packages/dashboard && npm install && cd ../..

# 2. Create your .env
cp .env.example .env
# Edit .env — add at least one LLM key:
#   ANTHROPIC_API_KEY=sk-ant-...
#   or OPENAI_API_KEY=sk-...
#   or OLLAMA_BASE_URL=http://localhost:11434

# 3. Generate security keys
node -e "const c=require('crypto'); console.log('JWT_SECRET='+c.randomBytes(32).toString('hex')); console.log('MASTER_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
# Paste the output into .env

# 4. Build everything
npm run build          # Backend TypeScript → dist/
npm run dashboard:build # Dashboard → packages/dashboard/dist/

# 5. Start
npm start              # Production mode on :3000
# OR
npm run dev            # Dev mode with hot-reload
```

### Step 2 — Verify

```bash
# Health check
curl http://localhost:3000/health

# Dashboard (production mode serves it on same port)
# Open http://localhost:3000 in browser

# Dashboard (dev mode — separate Vite server)
npm run dashboard:dev
# Open http://localhost:5173 in browser

# API docs
# Open http://localhost:3000/docs

# Send a test message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"message": "Hello!", "userId": "test"}'
```

### Step 3 — Dashboard Dev Workflow

For active dashboard development, run two terminals:

```bash
# Terminal 1 — Backend
npm run dev

# Terminal 2 — Dashboard (hot-reload)
npm run dashboard:dev
```

The dashboard dev server (`:5173`) proxies API requests to the backend (`:3000`).

For production, build the dashboard and it's served by the backend directly:

```bash
npm run build:all    # Builds backend + dashboard
npm start            # Serves everything on :3000
```

### Step 4 — Docker Deploy

```bash
# Build and run
cp .env.example .env   # Edit with real keys
docker compose up -d

# Verify
curl http://localhost:3000/health

# View logs
docker compose logs -f

# Stop
docker compose down
```

The Docker image:
- Builds backend and dashboard in separate stages
- Copies dashboard to `/app/public` (served via `express.static`)
- Runs as non-root `astra` user
- Exposes port 3000 (API + Dashboard) and 18793 (Canvas)
- Health checks every 30s

### Step 5 — Cloud Deploy (One-Click)

**Railway:**
1. Click "Deploy on Railway" badge in README
2. Set env vars: `ANTHROPIC_API_KEY`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`
3. Railway auto-builds using `railway.toml`

**Render:**
1. Click "Deploy to Render" badge in README
2. Set `ANTHROPIC_API_KEY` (JWT_SECRET and MASTER_ENCRYPTION_KEY are auto-generated)
3. Render uses `render.yaml` blueprint

**Fly.io:**
```bash
fly launch --name my-astra-os
fly secrets set ANTHROPIC_API_KEY=sk-ant-... JWT_SECRET=$(openssl rand -hex 32) MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)
fly deploy
```

### Step 6 — Publish to npm

```bash
# One-time: login to npm
npm login

# Publish
npm publish

# After publish, anyone can run:
npx astra-os    # Interactive setup wizard
```

---

## Day-to-Day Development Workflow

### Commands You'll Use Most

| Command | What It Does |
|---------|-------------|
| `npm run dev` | Start backend with hot-reload |
| `npm run dashboard:dev` | Start dashboard with hot-reload |
| `npm run build:all` | Build backend + dashboard for production |
| `npm start` | Run production build |
| `npm test` | Run all tests |
| `npm run typecheck` | Check TypeScript types without building |
| `npm run lint:fix` | Auto-fix lint issues |

### Making Changes

**Backend changes** (`src/`):
1. Edit TypeScript files in `src/`
2. `npm run dev` auto-reloads on save
3. Test: `npm test`
4. Type-check: `npm run typecheck`

**Dashboard changes** (`packages/dashboard/src/`):
1. `npm run dashboard:dev` gives hot-reload
2. Edit React components in `packages/dashboard/src/pages/`
3. Design tokens are in `packages/dashboard/tailwind.config.js`
4. Component classes are in `packages/dashboard/src/index.css`
5. Routes are in `packages/dashboard/src/App.tsx`

**Adding a new dashboard page:**
1. Create `packages/dashboard/src/pages/MyPage.tsx`
2. Add route in `App.tsx` (add to `NAV_SECTIONS` and the route switch)
3. The page auto-gets the sidebar, topbar, and design system

**Adding a new API endpoint:**
1. Add the route in `src/channels/Gateway.ts`
2. Add the endpoint to `src/docs/openapi.yaml`
3. Add a test in `src/__tests__/`

**Adding a new skill:**
1. Create `skills/my-skill/SKILL.md`
2. Restart — auto-loaded

### Git Workflow

```bash
# Check status
git status

# Stage and commit
git add -A
git commit -m "feat: description of change"

# Push
git push origin main
```

Branch convention (when you want it):
- `main` — stable, deployable
- `feat/xyz` — new features
- `fix/xyz` — bug fixes

---

## Architecture Quick Reference

```
Request Flow:
  Client → GatewayShield (security) → Express routes → Auth middleware
         → AgentRouter → AgentLoop (ReAct) → LLM Provider
         → Tools / Skills / Memory → Response

Key Files:
  src/channels/Gateway.ts    — All routes, static serving, WebSocket
  src/core/AgentLoop.ts      — ReAct engine, tool execution
  src/llm/ProviderRegistry.ts — Multi-LLM switching
  src/skills/SkillsEngine.ts — Skill loading + matching
  src/memory/MemoryEngine.ts — GraphRAG hybrid memory

Dashboard:
  packages/dashboard/src/App.tsx         — Layout, sidebar, routing
  packages/dashboard/src/pages/*.tsx     — 13 page components
  packages/dashboard/src/lib/api.ts      — API client
  packages/dashboard/tailwind.config.js  — Design tokens
  packages/dashboard/src/index.css       — Component classes
```

### Ports

| Port | Service | When |
|------|---------|------|
| 3000 | Backend API + Dashboard (prod) | Always |
| 5173 | Dashboard Vite dev server | `npm run dashboard:dev` |
| 18793 | Canvas / A2UI hub | When Canvas is used |
| 11434 | Ollama (if using local LLM) | External |

### Data Storage

| What | Where | Backed Up? |
|------|-------|-----------|
| SQLite DB | `.astra-data/astra.db` | Copy file (checkpoint WAL first) |
| Memory | `.astra-memory/` | Copy directory |
| Credential vault | `.astra-vault/` | Copy directory (encrypted) |
| Skills | `skills/` | In git |
| Logs | `logs/` | Optional |

---

## Connecting Channels (Quick Setup)

### Telegram (Easiest to start)

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
2. Copy the token
3. Add to `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC-DEF...`
4. Restart AstraOS
5. Set webhook: `curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/webhook/telegram"`

### WhatsApp

1. Create Meta Business App → WhatsApp Business API
2. `.env`: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN`
3. Webhook URL: `https://your-domain.com/webhook/whatsapp`

### Discord

1. Discord Developer Portal → New Application → Bot
2. `.env`: `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`

### Slack

1. Slack API → Create App → Enable Events
2. `.env`: `SLACK_BOT_TOKEN=xoxb-...`, `SLACK_SIGNING_SECRET`
3. Event URL: `https://your-domain.com/webhook/slack`

---

## Personalization

### Agent Personality — `SOUL.md`

Edit `SOUL.md` in the project root to define your agent's behavior:

```markdown
---
name: Aria
persona: Friendly AI assistant
tone: Professional, warm
guardrails:
  - Never share internal details
  - Always confirm before destructive actions
---

You are Aria, an AI assistant that...
```

### Multi-Agent — `AGENTS.md`

Define specialized agents with their own channels, skills, and models:

```markdown
## Support Agent
description: Customer support
channels: [whatsapp, webchat]
skills: [email-assistant, document-qa]
model: claude-haiku

## DevOps Agent
description: Infrastructure
channels: [slack, teams]
skills: [docker-manager, ci-monitor]
model: claude-sonnet
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module` | Run `npm run build` |
| No LLM provider | Add at least one API key to `.env` |
| Port 3000 in use | Change `PORT=3001` in `.env` |
| Dashboard blank (prod) | Run `npm run dashboard:build` — the backend serves `public/` |
| Dashboard blank (dev) | Run `npm run dashboard:dev` separately |
| Ollama refused | Run `ollama serve` first, check `curl localhost:11434/api/tags` |
| SQLite locked | Ensure only one instance is running |
| npm publish fails | Run `npm login` first |
| Docker build fails | `docker compose build --no-cache` |
| Tests failing | `npx vitest run --reporter=verbose` for details |

---

## Quick Reference Card

| What | How |
|------|-----|
| Start dev | `npm run dev` |
| Start dashboard dev | `npm run dashboard:dev` |
| Build everything | `npm run build:all` |
| Start production | `npm start` |
| Run tests | `npm test` |
| Health check | `curl http://localhost:3000/health` |
| Send message | `POST /api/chat` `{"message":"...","userId":"..."}` |
| Stream response | `POST /api/chat/stream` (SSE) |
| API docs | http://localhost:3000/docs |
| Dashboard | http://localhost:3000 (prod) or http://localhost:5173 (dev) |
| Agent card | `GET /.well-known/agent.json` |
| Security report | `GET /api/security/report` |
| List skills | `GET /api/skills` |
| Metrics | `GET /api/metrics` |
| Docker start | `docker compose up -d` |
| Onboarding wizard | `npx astra-os` |

---

*AstraOS v4.0.1 — Where there is Astra, there is victory.*
