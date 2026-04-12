# AI Team - Copilot Context

## Purpose

Quick runtime briefing for coding agents. Keep this file short; use linked docs for deep detail.

## Project in one minute

- TypeScript monorepo with CLI, Web, VS Code, and API surfaces.
- `.ai-team/` is the source of truth for runtime/configuration artifacts.
- `.github/` is compatibility/bootstrap only.

## Critical boundaries

- Keep `@ai-team/core` UI-free.
- Keep orchestration in `@ai-team/service`.
- Keep container primitives in `@ai-team/container` and service-specific registrations in `@ai-team/service`.
- Treat `@ai-team/api-client` (local/in-process) and `@ai-team/api-client-http` (remote/browser) as different clients.
- Keep `@ai-team/vscode` as a thin IDE adapter over shared contracts.
- In web: TanStack Query for server state; Zustand for live runtime client state.

## Runtime paths

- Local: `CLI -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- Remote: `Web -> @ai-team/api-client-http -> @ai-team/api-server -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- IDE: `CLI/API -> @ai-team/ide-interface -> @ai-team/vscode IDE-local server`

## Key runtime artifacts

- `.ai-team/config.json` (non-secret config)
- `.ai-team/.env` (secrets)
- `.ai-team/agents/*.agent.md`
- `.ai-team/agents/*.perm` (path permissions)
- `.ai-team/private/ai-team.db` (sessions/messages)
- `.ai-team/proposals/` (code-edit proposals)

## Permission model essentials

- File rights are enforced through `packages/core/src/context/index.ts`, backed by `file-context` (`ContextRuntime` + parsers/matchers).
- Keep per-agent path rules in `.ai-team/agents/<agent-id>.perm` (not in frontmatter).
- Inheritance: `write => read + list`, `read => list`; explicit deny wins.

## Read next (detailed docs)

1. `ARCHITECTURE.md`
2. `.github/copilot-instructions.md`
3. `docs/architecture/overview.md`
4. `docs/architecture/diagrams.md`
5. `docs/api/contracts.md`
6. `docs/implementation/web-state-architecture.md`

## High-value implementation hotspots

- `packages/service/src/contracts.ts`
- `packages/service/src/index.ts`
- `packages/service/src/orchestrator/chat-orchestrator.ts`
- `packages/service/src/orchestrator/send-turn.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/context/index.ts`
- `file-context/src/context-runtime.ts`
- `packages/api-server/src/server.ts`
- `packages/api-client-http/src/websocket.ts`
- `packages/vscode/src/extension.ts`
- `packages/web/src/components/ChatPanel.tsx`

## UI Verification

For any change affecting `packages/web`, use the **Chrome / browser MCP tools** to visually inspect the result in the running app before marking the task done:

- `open_browser_page` — open the app or a specific route
- `mcp_microsoft_pla_browser_run_code` — run JS in the browser context
- `mcp_microsoft_pla_browser_console_messages` — read console errors and warnings

Do not rely on a successful build alone for UI work. Open the browser, navigate to the affected screen, and confirm visually.

## Change rule

If architecture/boundaries/runtime storage changes, update:

- `ARCHITECTURE.md`
- `COPILOT-CONTEXT.md`
- `docs/architecture/overview.md`
- `docs/architecture/diagrams.md`
- affected package `README.md`
