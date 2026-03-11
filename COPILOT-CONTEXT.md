# AI Team - Copilot Context

## Current Snapshot (March 2026)

Monorepo packages currently present:

- `packages/core` - UI-free domain logic, shared types, tools, workspace-backed operations.
- `packages/access` - standalone file-path access rights policy engine (layered contexts, operation-aware, structured verdicts with delegation).
- `packages/service` - application orchestration, mediator contracts, chat runtime, workflow/session/task state.
- `packages/api-client` - typed local in-process client façade.
- `packages/api-client-http` - browser-safe remote HTTP/WebSocket client.
- `packages/api-server` - REST/WebSocket transport layer for remote/browser clients.
- `packages/ide-interface` - shared IDE bridge contracts and discovery/wire protocol.
- `packages/cli` - terminal adapter and operator workflows.
- `packages/vscode` - VS Code adapter and IDE-local review/open-file integration surface.
- `packages/web` - browser UI for dashboard, graph, portfolio, chat, sessions, tasks, and context views.

## What This Project Is

AI Team is a multi-surface toolset for running a virtual software organization with explicit context boundaries and file-backed runtime state.

- Agents, skills, prompts, and workspace customization live under `.ai-team/`.
- `@ai-team/core` owns reusable UI-free domain logic.
- `@ai-team/service` owns application orchestration and mediator contracts.
- Adapters and transport layers expose that runtime through CLI, web, VS Code, and API surfaces.

For customization layout, treat `.ai-team/` as the durable source of truth and `.github/` as an optional Copilot bootstrap/compatibility layer.

## Fast Architecture Summary

### Local command path

`CLI -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/* (+ provider APIs)`

### Remote browser path

`Web -> @ai-team/api-client-http -> @ai-team/api-server -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/* (+ provider APIs)`

### IDE integration path

`CLI or api-server -> @ai-team/ide-interface -> @ai-team/vscode IDE-local server -> VS Code-native review/open-file UX`

## Runtime Artifacts

- `.ai-team/config.json` - non-secret provider/model/config state.
- `.ai-team/.env` - secrets.
- `.ai-team/agents/*.agent.md` - Copilot-facing agent portfolio files.
- `.ai-team/agents/*.agent.yml` - ai-team runtime metadata sidecars.
- `.ai-team/private/ai-team.db` - SQLite database for chat sessions, messages, and metadata.
- `.ai-team/proposals/` - persisted code-edit proposals for review/replay flows.
- `.ai-team/.ide-server.json` - active IDE-local server discovery file when the VS Code extension is running.

## Where to Read First

- [ARCHITECTURE.md](ARCHITECTURE.md) - canonical architecture, boundaries, and invariants.
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - coding rules and validation guidance.
- [docs/architecture/overview.md](docs/architecture/overview.md) - concise human-oriented architecture summary.
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md) - Mermaid package and flow diagrams.
- [docs/api/contracts.md](docs/api/contracts.md) - transport-facing API docs for the API server surface.
- [docs/implementation/web-state-architecture.md](docs/implementation/web-state-architecture.md) - frontend state boundaries and migration target.
- [packages/core/README.md](packages/core/README.md)
- [packages/access/README.md](packages/access/README.md)
- [packages/api-server/README.md](packages/api-server/README.md)
- [packages/web/README.md](packages/web/README.md)

## Implementation Hotspots

- [packages/service/src/contracts.ts](packages/service/src/contracts.ts) - mediator request/event and command type contracts.
- [packages/service/src/index.ts](packages/service/src/index.ts) - command dispatch and runtime event wiring.
- [packages/service/src/commands/chat/index.ts](packages/service/src/commands/chat/index.ts) - thin chat bootstrap.
- [packages/service/src/orchestrator/chat-orchestrator.ts](packages/service/src/orchestrator/chat-orchestrator.ts) - orchestration rules, handoff loop, slash/NL routing.
- [packages/service/src/orchestrator/send-turn.ts](packages/service/src/orchestrator/send-turn.ts) - single-turn LLM pipeline and tool dispatch.
- [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts) - question/workflow continuation persistence.
- [packages/service/src/session-manager.ts](packages/service/src/session-manager.ts) - persisted chat/session behavior.
- [packages/service/src/task-manager.ts](packages/service/src/task-manager.ts) - task lifecycle and state.
- [packages/service/src/storage/proposal-store.ts](packages/service/src/storage/proposal-store.ts) - persisted code-edit proposal storage.
- [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts) - tool registry + question tools.
- [packages/core/src/tools/tool-descriptors.ts](packages/core/src/tools/tool-descriptors.ts) - built-in tool and command descriptors for AccessEngine.
- [packages/core/src/context/access-adapter.ts](packages/core/src/context/access-adapter.ts) - Agent/FileTreeConfig → AccessEngine bridge.
- [packages/access/src/engine.ts](packages/access/src/engine.ts) - AccessEngine — core policy evaluation.
- [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts) - command metadata for model-facing guidance.
- [packages/api-client/src/index.ts](packages/api-client/src/index.ts) - local typed client and in-process wiring.
- [packages/api-client-http/src/index.ts](packages/api-client-http/src/index.ts) - remote browser client.
- [packages/api-client-http/src/websocket.ts](packages/api-client-http/src/websocket.ts) - remote chat streaming transport.
- [packages/api-server/src/server.ts](packages/api-server/src/server.ts) - REST/WebSocket server setup and route registration.
- [packages/api-server/src/routes/](packages/api-server/src/routes/) - API endpoint implementations.
- [packages/api-server/src/ws/chat-handler.ts](packages/api-server/src/ws/chat-handler.ts) - browser chat stream bridge.
- [packages/api-server/src/routes/ide.ts](packages/api-server/src/routes/ide.ts) - persistent IDE bridge and proposal replay.
- [packages/ide-interface/src/index.ts](packages/ide-interface/src/index.ts) - IDE discovery file and wire protocol.
- [packages/vscode/src/extension.ts](packages/vscode/src/extension.ts) - extension activation and IDE-local wiring.
- [packages/vscode/src/ide-local-server.ts](packages/vscode/src/ide-local-server.ts) - local WebSocket server and client tracking.
- [packages/vscode/src/decorations/code-edit-decorator.ts](packages/vscode/src/decorations/code-edit-decorator.ts) - proposal diff/review lifecycle.
- [packages/web/src/context/TeamContext.tsx](packages/web/src/context/TeamContext.tsx) - shared frontend bootstrap/client state.
- [packages/web/src/components/ChatPanel.tsx](packages/web/src/components/ChatPanel.tsx) - current chat runtime hotspot.
- [packages/web/src/components/ContextPanel.tsx](packages/web/src/components/ContextPanel.tsx) - sidebar composition point for sessions/tasks/artifacts.
- [packages/web/src/hooks/useArtifactsQuery.ts](packages/web/src/hooks/useArtifactsQuery.ts) - Query-backed artifacts loading.
- [packages/web/src/hooks/useSessionsForAgent.ts](packages/web/src/hooks/useSessionsForAgent.ts) - session query/mutation boundary.

## Working Agreement

When implementing changes:

- Prefer small, package-local edits first.
- Respect the boundary rules in [ARCHITECTURE.md](ARCHITECTURE.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md).
- Keep `@ai-team/core` UI-free.
- Keep orchestration behavior in `@ai-team/service` unless there is a clear shared-domain reason to move it.
- Treat `@ai-team/api-client` and `@ai-team/api-client-http` as different client surfaces with different responsibilities.
- Treat `@ai-team/vscode` as an IDE adapter over shared contracts, not as a place to accumulate business logic.
- For `packages/web`, describe the current architecture honestly: hybrid today, with Query/runtime-store/presenter split as the target direction.

## When Architecture Changes

When architecture, package boundaries, runtime storage, or execution paths change, update the relevant docs in the same change:

- `ARCHITECTURE.md`
- `COPILOT-CONTEXT.md`
- `docs/architecture/overview.md`
- `docs/architecture/diagrams.md`
- package `README.md` files affected by the change

## Near-Term Direction

- Keep CLI, web, and IDE experiences aligned through shared service/runtime contracts rather than duplicating orchestration logic in each adapter.
- Continue moving `packages/web` toward clearer server-state/runtime-state/view boundaries.
- Keep IDE proposal/open-file workflows flowing through `@ai-team/ide-interface` instead of coupling editor behavior directly into service/core.
