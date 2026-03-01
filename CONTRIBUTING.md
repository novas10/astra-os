# Contributing to AstraOS

Thank you for your interest in contributing to AstraOS! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- Docker (optional, for sandbox features)
- Git

### Setup

```bash
git clone https://github.com/AstraOS-India/astra-os
cd astra-os
npm install
cp .env.example .env
# Add at least one LLM provider key to .env
npm run dev
```

### Dashboard Setup

```bash
cd packages/dashboard
npm install
npm run dev
# Dashboard runs on http://localhost:5173
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feature/my-feature`
3. **Make your changes** following the code style guidelines below
4. **Run checks** before committing:
   ```bash
   npm run typecheck    # TypeScript type checking
   npm run lint         # ESLint
   npm run test         # Vitest test suite
   npm run build        # Full build
   ```
5. **Commit** with a descriptive message (see commit conventions below)
6. **Push** and open a Pull Request

## Code Style

- **TypeScript** — All source code is TypeScript with strict mode
- **Formatting** — Prettier with the project's `.prettierrc` config
- **Linting** — ESLint with `@typescript-eslint` rules
- **Naming** — camelCase for variables/functions, PascalCase for classes/types/interfaces
- **Imports** — Use relative imports within `src/`, group by: node builtins, external packages, internal modules
- **Error handling** — Always type errors as `(err as Error).message`, never use bare `catch(e)`

Run formatting and linting:

```bash
npm run format       # Auto-format with Prettier
npm run lint:fix     # Auto-fix lint issues
```

## Commit Conventions

Use conventional commit messages:

```
feat: add Zalo channel adapter
fix: prevent path traversal in DockerSandbox
docs: update API endpoint table in README
test: add MemoryEngine vector search tests
refactor: extract embedding logic to EmbeddingProvider
chore: update dependencies
```

## Project Structure

```
src/
├── core/           # AgentLoop, ReAct engine, context compactor
├── llm/            # LLM providers (Anthropic, OpenAI, Gemini, Ollama)
├── channels/       # Gateway + 12 channel adapters
├── memory/         # MemoryEngine, EmbeddingProvider, VectorStore, GraphRAG
├── tools/          # BrowserEngine, ComputerUse, VisionEngine
├── skills/         # SkillsEngine, SkillGenerator, SkillMigrator, AstraHub CLI
├── sandbox/        # DockerSandbox, SafeSandbox (hybrid execution)
├── voice/          # VoiceEngine (Talk Mode, TTS, STT, VAD)
├── canvas/         # CanvasServer (A2UI interactive rendering)
├── mcp/            # MCP client + server + registry
├── a2a/            # A2A protocol (agent cards, task lifecycle)
├── agents/         # AgentRouter (multi-agent orchestration)
├── workflow/       # WorkflowEngine (DAG execution)
├── auth/           # RBAC + multi-tenancy
├── middleware/     # Auth, rate limiting
├── security/       # GatewayShield, CredentialVault, SkillSandbox
├── enterprise/     # SSO, AuditLog, BillingEngine, DataResidency
├── edge/           # EdgeRuntime (Ollama offline-first)
├── marketplace/    # MarketplaceServer
├── telemetry/      # OpenTelemetry tracer + metrics
├── heartbeat/      # HeartbeatEngine (cron scheduler)
├── utils/          # Logger
├── docs/           # OpenAPI spec + Swagger UI
└── __tests__/      # Vitest test suites
packages/
└── dashboard/      # React + Vite + Tailwind admin UI
```

## Adding a New Channel Adapter

1. Create `src/channels/MyChannelAdapter.ts`
2. Implement the adapter pattern (see `SlackAdapter.ts` as reference)
3. Wire webhook routes in `Gateway.ts`
4. Add env vars to `.env.example`
5. Add channel detection in `Gateway.getActiveChannels()`
6. Add tests in `src/__tests__/`
7. Update README channel table

## Adding a New Skill

1. Create a folder under `skills/` with a `SKILL.md` file
2. Or use the SkillGenerator: `POST /api/skills/generate`
3. Skills are auto-loaded and matched by trigger keywords
4. See `skills/bundled/` for examples

## Adding a New LLM Provider

1. Create `src/llm/MyProvider.ts` implementing the `LLMProvider` interface
2. Add `chat()` and `chatStream()` methods
3. Register in `src/llm/ProviderRegistry.ts`
4. Add env var to `.env.example`
5. Add tests

## Testing

```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
```

Tests use Vitest and are located in `src/__tests__/`. When adding features, include tests for:
- Happy path
- Error cases
- Edge cases (empty input, invalid data)
- Security (path traversal, injection attempts)

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if you change APIs or behavior
- Ensure all CI checks pass (typecheck, lint, test, build)
- Link related issues in the PR description

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include reproduction steps, expected vs actual behavior
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
