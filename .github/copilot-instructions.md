# AI Team coding-agent instructions

## Big picture

- This is a TypeScript monorepo for a file-backed virtual software organization with three user surfaces: CLI, VS Code, and Web.
- The main runtime path is `adapter -> @ai-team/api-client or @ai-team/api-client-http -> @ai-team/service -> @ai-team/core -> .ai-team/*`.
- Keep `packages/core` UI-free: no `vscode`, `react`, `react-dom`, or `electron` imports there.
- Put reusable business logic in `packages/core/src/**`; keep adapters thin in `packages/cli`, `packages/vscode`, and `packages/web`.
- Service orchestration lives in `packages/service/src/**`; read `ARCHITECTURE.md` and `COPILOT-CONTEXT.md` first for cross-package work.

## Key hotspots

- Chat + tool orchestration: `packages/service/src/orchestrator/chat-orchestrator.ts`, `packages/service/src/orchestrator/slash-commands.ts`, `packages/service/src/commands/chat/index.ts`
- Mediator contracts and command dispatch: `packages/service/src/contracts.ts`, `packages/service/src/index.ts`
- Tool registry and permission-aware tools: `packages/core/src/tools/index.ts`
- Service DI wiring: `packages/service/src/container/bootstrap.ts` and `packages/service/src/container/container.ts`; prefer token-based registrations and existing singleton patterns.
- Runtime storage and agent loading: `packages/core/src/storage/index.ts`; agent discovery currently supports `**/agent.md`, `**/*.agent.md`, and legacy `.ai-team/agents/*.md`.
- API surfaces: `packages/api-server/src/routes/**`, `packages/api-client/src/index.ts`, `packages/api-client-http/src/**`

## Repository-specific conventions

- Validate external or untrusted input with `zod`.
- Use `async`/`await` in command and service flows; follow the style in `packages/cli/src/commands/*.ts`.
- Use typed/domain errors in core; adapters should turn failures into user-friendly output and explicit non-zero exits.
- Do not create new runtime storage locations if `.ai-team/` already covers the use case.
- When editing agent files, preserve YAML frontmatter + Markdown body structure.
- For agent identity, `aiTeamId` / `aiTeamName` override `id` / `name`; if identity is missing, `*.agent.md` filename can provide the fallback ID.
- For ai-team customization work, use `.ai-team/ai-team-way.md` as the canonical doctrine for agent personality, reporting lines, collaboration behavior, and artifact boundaries.

## Runtime state and security

- Treat `.ai-team/.env`, provider tokens, and `.ai-team/private/**` as sensitive; never print or commit secrets.
- Non-secret config belongs in `.ai-team/config.json`.
- Permission/context checks must happen before file or tool access.

## Workflows and verification

- Install with `pnpm install`.
- Build all packages with `pnpm -r build`; when shared contracts or multiple packages change, run this before finishing.
- Root dev flow is `pnpm dev:web`, which starts both `@ai-team/api-server` and `@ai-team/web`; ports are managed by the root `api:kill` / `server:kill` / `web:kill` scripts.
- Targeted checks:
	- `packages/core/**`: `pnpm --filter @ai-team/core build` and `pnpm --filter @ai-team/core exec -- vitest run`
	- `packages/cli/**`: `pnpm --filter @ai-team/cli build` and `pnpm --filter @ai-team/cli exec vitest run`
	- `packages/vscode/**`: `pnpm --filter @ai-team/vscode build`
	- `packages/web/**`: `pnpm --filter @ai-team/web build` or manual `pnpm dev:web` verification for UI work

## Change policy

- Prefer the smallest change set that preserves existing behavior.
- Avoid dependency upgrades, broad renames, and cross-package refactors unless the task truly requires them.
- If architecture, package boundaries, runtime storage, or verification commands change, update `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, this file, and affected package `README.md` files in the same change.
