# AI Team - Copilot Context

## Purpose

Quick runtime briefing for coding agents. Keep this file short; use linked docs for deep detail.

## Active local backlog

- The durable long-term backlog lives in [`.ai-team/tasks/`](.ai-team/tasks/).
- Use local task files as the source of truth for multi-session work; do not rely on chat history alone.
- Architecture docs intentionally describe both current state and target direction while the transition is in progress.

## Project in one minute

- TypeScript monorepo with CLI, Web, VS Code, and API surfaces.
- `.ai-team/` is the source of truth for runtime/configuration artifacts.
- `.github/` is compatibility/bootstrap only.

## Critical boundaries

- Keep `@ai-team/core` UI-free.
- Keep orchestration in `@ai-team/service`.
- Keep container primitives in `@ai-team/container` and service-specific registrations in `@ai-team/service`.
- Treat `@ai-team/api-contracts` (service interfaces) and `@ts-http` (remote/browser) as different clients.
- Keep `@ai-team/vscode` as a thin IDE adapter over shared contracts.
- In web: TanStack Query for server state; Zustand for live runtime client state.
- Treat mediator-oriented naming as transitional: target direction is `service interfaces` + internal `service-layer mediator` + outward `UI notifier`.
- Prefer strict dependency injection across the logic ↔ infrastructure boundary.
- Prefer function injection where simpler; if parameter count grows beyond 5, inject a deps object or refactor to a class.

## Runtime paths

- Local: `CLI -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- Remote: `Web -> @ts-http -> @ai-team/api-server -> @ai-team/api-contracts -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- IDE: `CLI/API -> @ai-team/ide-interface -> @ai-team/vscode IDE-local server`

## Key runtime artifacts

- `.ai-team/config.json` (non-secret config)
- `.ai-team/.env` (secrets)
- `.ai-team/agents/*.agent.md`
- `.ai-team/agents/*.perm` (path permissions)
- `.ai-team/private/ai-team.db` (sessions/messages)
- `.ai-team/proposals/` (code-edit proposals)

## Chat thread invariant

- A session is one agent's private LLM context. `previousSessionId` links handoff sessions into a human-visible thread.
- The root session persists the thread's active session, return stack, and navigation timestamp. Explicit-session resume uses `IThreadManager`'s persisted cursor; bare `ait chat` opens the exact session with the latest real message or persisted tool activity, excluding mirrored handoff copies and using persisted row order to break timestamp ties. `ait chat <agent>` always creates a new root session for that agent. See `docs/implementation/chat-startup-resume.md`.
- Mirrored handoff summaries share one `handoffId` and appear once in the presentation transcript. Never pass the full thread transcript to an agent model.
- Startup selection and handoff transitions are service-owned; adapters pass intent and render typed events, including `cancelled` command outcomes.

## Command parameter invariant

- A command receives one schema-validated object regardless of whether it was invoked with JSON, positional slash syntax, a workflow, or an LLM tool call.
- `CommandDispatcher` owns parsing, context/workflow derivation, human completion of missing required values, and final validation. Command implementations do not parse raw slash tails.
- Explicit caller values win; missing `agentId`/`sessionId`-style fields may come from `ExecutionContext`, and declared workflow bindings may come from the last result or workflow state.
- Agent tool calls use the same binding and validation path but never prompt. Runtime-owned and workflow-bound fields are hidden from LLM schemas.
- Tool names derive from required command metadata as `group_key`; for example `group: cli`, `key: run` becomes `cli_run`.
- Deep reference: `docs/implementation/command-dispatch-and-parameters.md`.

## Workflow return invariant

- `WorkflowDefinition.return` optionally declares `{ command, args? }`.
- The workflow runner resolves that contract against current state and carries
  it in `ExecutionContext.workflowReturn`; outer workflow identities are carried
  in `ExecutionContext.workflowStack`.
- `/return` dispatches the active workflow return command when configured;
  otherwise it returns the previous command step's response. Never add
  workflow-specific return logic to the slash command.
- Chat uses `session-handoff-return`, which resolves the persisted parent frame
  and invokes `com_handoff` with `navigationIntent: back`. The handoff path owns
  summary generation, persistence, cursor restoration, and stack pop.

## Permission model essentials

- File rights are enforced through `packages/core/src/context/index.ts`, backed by `fs-context` (`ContextRuntime` + parsers/matchers).
- Keep per-agent path rules in `.ai-team/agents/<agent-id>.perm` (not in frontmatter).
- Inheritance: `write => read + list`, `read => list`; explicit deny wins.

## Read next (detailed docs)

1. `docs/architecture/overview.md`
2. `.ai-team/tasks/`
3. `.github/copilot-instructions.md`
4. `docs/architecture/diagrams.md`
5. `ARCHITECTURE.md` (deep architecture narrative)
6. `docs/architecture/implementation-entry-points.md` (deep code-navigation index)
7. `docs/api/contracts.md` (only for API/transport work)
8. `docs/implementation/web-state-architecture.md`

Default posture: do not load items 5–7 unless the task requires them.

## High-value implementation hotspots

- `packages/service/src/contracts.ts`
- `packages/service/src/index.ts`
- `packages/service/src/orchestrator/chat-orchestrator.ts`
- `packages/service/src/orchestrator/send-turn.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/context/index.ts`
- `fs-context/src/context-runtime.ts`
- `packages/api-server/src/server.ts`

- `packages/vscode/src/extension.ts`
- `packages/web/src/components/ChatPanel.tsx`

## UI Verification

For any change affecting `packages/web`, use the **Chrome / browser MCP tools** to visually inspect the result in the running app before marking the task done:

- `open_browser_page` — open the app or a specific route
- `mcp_microsoft_pla_browser_run_code` — run JS in the browser context
- `mcp_microsoft_pla_browser_console_messages` — read console errors and warnings

Do not rely on a successful build alone for UI work. Open the browser, navigate to the affected screen, and confirm visually.

## Duplication Verification

Run fuzzy duplication scanning on the affected scope periodically (especially for larger refactors/features), and prompt the user from time to time when a scan is recommended:

- `pnpm --filter @aspect/duplication build`
- `node analysis/duplication/dist/cli/fuzzy-dup.js <scope> --format text`

Examples:

- `node analysis/duplication/dist/cli/fuzzy-dup.js packages/service --match-length 12 --fuzz 2 --gap-tolerance 1 --max-hole-size 1`
- `node analysis/duplication/dist/cli/fuzzy-dup.js packages/web --format text`

## Change rule

If architecture/boundaries/runtime storage changes, update:

- `ARCHITECTURE.md`
- `COPILOT-CONTEXT.md`
- `docs/architecture/overview.md`
- `docs/architecture/diagrams.md`
- relevant files under `.ai-team/tasks/`
- affected package `README.md`
