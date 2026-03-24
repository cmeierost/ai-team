# AI Team - Architecture

## Documentation Map

- [README.md](README.md) - repository front door, setup, and navigation.
- [COPILOT-CONTEXT.md](COPILOT-CONTEXT.md) - tactical implementation briefing for coding agents.
- [docs/architecture/overview.md](docs/architecture/overview.md) - concise human-readable summary of the current architecture.
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md) - Mermaid diagrams for package boundaries and runtime flows.
- [docs/api/contracts.md](docs/api/contracts.md) - transport-facing API documentation for the API server surface.
- [docs/implementation/web-state-architecture.md](docs/implementation/web-state-architecture.md) - target frontend state split and migration guidance.

## Purpose

AI Team is a TypeScript monorepo for running a file-backed virtual software organization across multiple user surfaces.

The architecture optimizes for:

- thin adapters at the edges
- typed service boundaries in the middle
- reusable UI-free logic in `@ai-team/core`
- transport flexibility for local and remote clients
- runtime state rooted under `.ai-team/`

## Implementation Entry Points

Use this as a “where should I change code?” index.

| What | Where |
| --- | --- |
| Mediator command payload/response/event contracts | [packages/service/src/contracts.ts](packages/service/src/contracts.ts) |
| Service command dispatch, `invoke()`, `stream()`, and runtime event bridging | [packages/service/src/index.ts](packages/service/src/index.ts) |
| Thin chat bootstrap: env checks, agent resolution, session selection, orchestrator setup | [packages/service/src/commands/chat/index.ts](packages/service/src/commands/chat/index.ts) |
| Chat turn controller: slash commands, NL forwarding, handoffs, turn loop | [packages/service/src/orchestrator/chat-orchestrator.ts](packages/service/src/orchestrator/chat-orchestrator.ts) |
| Single-turn LLM pipeline: context build, tool dispatch, handoff/hire detection | [packages/service/src/orchestrator/send-turn.ts](packages/service/src/orchestrator/send-turn.ts) |
| Handoff protocol and context mutation | [packages/service/src/orchestrator/handoff.ts](packages/service/src/orchestrator/handoff.ts) |
| Pipeline extension interfaces | [packages/service/src/orchestrator/pipeline.ts](packages/service/src/orchestrator/pipeline.ts) |
| Workflow continuation persistence | [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts) |
| Session lifecycle and persisted chat behavior | [packages/service/src/session-manager.ts](packages/service/src/session-manager.ts) |
| Task lifecycle and task-oriented state | [packages/service/src/task-manager.ts](packages/service/src/task-manager.ts) |
| Local typed client façade and local service wiring | [packages/api-client/src/index.ts](packages/api-client/src/index.ts) |
| Browser-safe HTTP/WebSocket client | [packages/api-client-http/src/index.ts](packages/api-client-http/src/index.ts) |
| Browser WebSocket chat transport | [packages/api-client-http/src/websocket.ts](packages/api-client-http/src/websocket.ts) |
| API server transport assembly | [packages/api-server/src/server.ts](packages/api-server/src/server.ts) |
| API server HTTP routes | [packages/api-server/src/routes/](packages/api-server/src/routes/) |
| API server WebSocket chat bridge | [packages/api-server/src/ws/chat-handler.ts](packages/api-server/src/ws/chat-handler.ts) |
| File-path permission rights policy engine | [packages/permission/](packages/permission/) |
| Core tools and question primitives | [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts) |
| Permission adapter: Agent/FileTreeConfig → PermissionEngine bridge | [packages/core/src/context/permission-adapter.ts](packages/core/src/context/permission-adapter.ts) |
| Model-facing command metadata | [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts) |
| IDE bridge contracts and discovery file | [packages/ide-interface/src/index.ts](packages/ide-interface/src/index.ts) |
| VS Code extension activation and IDE-local server | [packages/vscode/src/extension.ts](packages/vscode/src/extension.ts), [packages/vscode/src/ide-local-server.ts](packages/vscode/src/ide-local-server.ts) |
| Web frontend bootstrap and routing | [packages/web/src/main.tsx](packages/web/src/main.tsx), [packages/web/src/App.tsx](packages/web/src/App.tsx) |
| Current web chat/runtime hotspot | [packages/web/src/components/ChatPanel.tsx](packages/web/src/components/ChatPanel.tsx) |

## System Model

AI Team has three important runtime shapes:

1. **Local command path** for CLI-driven work.
2. **Remote browser path** for the web UI.
3. **IDE integration path** for editor-local review/open-file workflows.

### Layered architecture

```text
Adapters / Transports
  ├─ @ai-team/cli
  ├─ @ai-team/vscode
  ├─ @ai-team/web
  ├─ @ai-team/api-server
  └─ @ai-team/api-client-http

Typed clients / integration contracts
  ├─ @ai-team/api-client
  └─ @ai-team/ide-interface

Application orchestration
  └─ @ai-team/service

UI-free domain + workspace logic
  └─ @ai-team/core

Standalone policy engine
  └─ @ai-team/permission

Runtime state + external integrations
  ├─ .ai-team/*
  └─ LLM / provider APIs
```

### Execution paths

- **CLI local path**: `@ai-team/cli -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- **Web remote path**: `@ai-team/web -> @ai-team/api-client-http -> @ai-team/api-server -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- **VS Code IDE integration path**: `CLI or api-server -> @ai-team/ide-interface -> @ai-team/vscode IDE-local server -> VS Code-native review/open-file UX`

## Package Responsibilities

### `@ai-team/permission`

- Standalone file-path permission rights policy engine.
- Provides layered, context-based access control with deny-before-allow semantics.
- Operation-aware: understands shell command and tool call path extraction via `CommandRegistry` and `ToolRegistry`.
- Returns structured verdicts with per-path breakdown, alternative-context suggestions, and delegation support.
- Used by `@ai-team/core` through an opt-in adapter layer (`permission-adapter.ts`) that bridges `Agent`, `FileTreeConfig`, and built-in tool/command definitions.

### `@ai-team/core`

- Owns UI-free domain logic, shared types, Zod-backed schemas, and workspace-backed file/domain operations.
- Owns the core concepts for agents, teams, skills, context, tools, and file-backed runtime behavior under `.ai-team/`.
- Must remain adapter-agnostic and UI-free.

### `@ai-team/service`

- Owns application orchestration on top of core.
- Defines mediator contracts in `src/contracts.ts`.
- Implements `invoke()` and `stream()` in `src/index.ts`.
- Owns chat runtime orchestration, including slash command routing, NL forwarding, handoff flow, tool execution flow, question flow, and workflow continuation.
- Owns backend managers such as sessions, tasks, workflow state, and proposal persistence used by adapters and transports.

### `@ai-team/api-client`

- Owns the typed in-process client façade used by local adapters and the API server.
- Wraps `@ai-team/service` for command-style operations.
- Exposes local convenience helpers for agent metadata, content editing, and other local workflows that are not pure remote mediator calls.
- Provides `createLocalAiTeamClient()` as the standard local runtime entry point.

### `@ai-team/api-server`

- Owns HTTP and WebSocket transport adaptation for browser and remote clients.
- Mounts REST routes, Swagger/OpenAPI docs, AsyncAPI docs, and the chat WebSocket endpoint.
- Uses the local `@ai-team/api-client` plus shared service/session managers to expose backend capabilities remotely.
- Brokers optional IDE-facing integration paths such as proposal replay and editor notifications.

### `@ai-team/api-client-http`

- Owns the browser-safe remote client for the API server.
- Provides REST helpers plus WebSocket chat streaming for the web UI.
- Shares service/core types where practical, but does not currently provide full parity with the local in-process client surface.
- Should be treated as the **remote transport client**, not as the canonical client for every workflow.

### `@ai-team/ide-interface`

- Owns the shared IDE bridge contracts, discovery file shape, and adapter factory used by CLI, API server, and the VS Code extension.
- Defines how non-IDE runtimes discover and talk to a running editor instance.
- Keeps IDE message protocols out of the service/core layers.

### `@ai-team/cli`

- Owns terminal parsing, prompts, rendering, and process-level UX.
- Delegates business operations to `@ai-team/api-client`.
- Can forward proposal/open-file actions into the IDE bridge when VS Code is available.

### `@ai-team/vscode`

- Owns editor-native activation, commands, views, panels, decorations, and IDE-local integration UX.
- Starts an IDE-local WebSocket server for initialized workspaces and writes `.ai-team/.ide-server.json` for discovery.
- Acts as the IDE endpoint for open-file requests and code-edit review requests coming through `@ai-team/ide-interface`.
- Keeps reusable business logic out of the extension package; the extension translates shared IDE messages into VS Code-native UX.

### `@ai-team/web`

- Owns the browser UI for dashboard, team graph, employee list, portfolio/editor, chat, session/thread graph, and context/task/permission surfaces.
- Uses the remote transport path through `@ai-team/api-client-http` and `@ai-team/api-server` rather than importing lower runtime layers directly into browser code.
- Is currently a hybrid frontend architecture: some data access is extracted into query hooks, while several feature screens still combine fetching, orchestration, and rendering.
- Target direction remains TanStack Query for persisted API-backed state, narrow runtime controllers/stores for live chat state, and prop-driven presentational views where practical.

## Runtime State Model

All durable runtime state lives under `.ai-team/` in the workspace.

- `.ai-team/config.json` - non-secret provider/model/configuration state.
- `.ai-team/.env` - secrets and provider tokens.
- `.ai-team/agents/*.agent.md` - Copilot-facing agent portfolio files.
- `.ai-team/agents/*.agent.yml` - ai-team runtime metadata sidecars for those agent portfolios.
- `.ai-team/agents/*.perm` - per-agent file-path access policy files (read/write/create/delete + optional deny via `!pattern`).
- `.ai-team/private/ai-team.db` - SQLite database for sessions, messages, and related metadata.
- `.ai-team/proposals/` - persisted code-edit proposals used by review/replay flows.
- `.ai-team/.ide-server.json` - discovery file for the active IDE-local server when the VS Code extension is running.

Compatibility/bootstrap artifacts may also exist under `.github/`, but `.ai-team/` remains the durable runtime source of truth.

## File-System Access Model

The current file-path access model is centered on `@ai-team/permission` and per-agent `.perm` files.

- Agent metadata (`.agent.yml`) no longer carries file-path read/write/create/delete rules.
- Per-agent path policy lives in `.ai-team/agents/<agent-id>.perm`.
- Global file-tree defaults still come from `.ai-team/config.json` (`fileTree.readPaths`, `writePaths`, `createPaths`, `deletePaths`).
- Effective evaluation is engine-based across CLI/service/API paths.
- Rights inheritance is enforced as:
  - `write => read + list`
  - `read => list`
- Explicit deny/ignore rules retain precedence over inherited allows.

## Command and Transport Model

`@ai-team/service` is the mediator boundary for application operations.

- Request contract: `MediatorRequest<TCommand>`.
- Unary execution: `invoke(request, context)`.
- Streaming execution: `stream(request, context)`.
- Stream contract: `MediatorEvent<TCommand>` with `started`, `status`, `progress`, `log`, `token`, `tool`, `question`, `handoff`, `result`, `error`, `done`, and `aborted` variants.

### Local adapters

- CLI flows use the local in-process client path.
- The service emits runtime events which `stream()` converts into adapter-facing mediator events.

### Remote browser transport

- Snapshot/resource reads and mutations flow through REST.
- Active chat generation flows through WebSocket.
- The browser transport is mediator-event-driven rather than a bespoke frontend-only protocol.

### IDE integration transport

- The service can emit `code_edit_proposal` runtime events.
- CLI and API server use `@ai-team/ide-interface` to forward proposals/open-file requests to a running VS Code extension.
- The extension renders diff/review UX and sends acknowledgements back so upstream layers can reconcile proposal state.

## ChatOrchestrator Pipeline

`packages/service/src/commands/chat/index.ts` is intentionally thin. It performs preflight checks, resolves the current agent/session, builds the orchestration context, and hands control to `ChatOrchestrator`.

The orchestration pipeline lives in `packages/service/src/orchestrator/`.

```text
chatCommand (commands/chat/index.ts)
  └─ ChatOrchestrator.run(message)
       ├─ 1. trySlashCommand()
       ├─ 2. tryNlForward()
       └─ 3. turn loop
            ├─ IContextCompressor
            ├─ IContextBuilder
            ├─ IContextEnricher[]
            ├─ IRagProvider
            ├─ IToolResolver + IMcpGateway
            ├─ ILlmSelector
            ├─ send-turn.ts
            └─ IOutputHandler
```

### Pipeline interfaces

All orchestration extension seams are defined in [packages/service/src/orchestrator/pipeline.ts](packages/service/src/orchestrator/pipeline.ts).

| Interface | Purpose |
| --- | --- |
| `ISlashCommand` | In-chat `/command` handler |
| `IContextCompressor` | History compression / summarization seam |
| `IContextBuilder` | Final prompt/context assembly |
| `IContextEnricher` | Role-aware system-message enrichment |
| `IRagProvider` | Retrieval-augmented context injection |
| `IToolResolver` | Local tool resolution per turn |
| `IMcpGateway` | External MCP tool discovery |
| `ILlmSelector` | Provider/model selection per turn |
| `IOutputHandler` | Completed-turn persistence and output routing |

### Turn dispatch precedence

Inside `ChatOrchestrator.run()` the service applies deterministic routing rules in this order:

1. **Slash commands**
2. **Natural-language forward detection**
3. **Regular turn loop** via `sendTurn()`
4. **Post-turn side effects** such as hire and handoff handling

This keeps orchestration behavior consistent across surfaces that use the same service pipeline.

## Architecture Invariants

1. **`@ai-team/core` stays UI-free** - no `vscode`, `react`, `react-dom`, or `electron` imports.
2. **Adapters stay thin** - UX lives at the edge; business logic flows through shared clients/service/core.
3. **`@ai-team/service` owns orchestration** - command dispatch, runtime events, workflow continuation, and chat control flow live there.
4. **Remote and local clients are different on purpose** - `@ai-team/api-client` is the in-process local façade; `@ai-team/api-client-http` is the remote/browser transport client.
5. **IDE integration is its own boundary** - `@ai-team/ide-interface` and `@ai-team/vscode` handle editor-local workflows without pushing IDE concerns down into service/core.
6. **Runtime state conventions remain under `.ai-team/`**.
7. **Typed command contracts remain centralized in service**.
8. **Web state should use the right tool for the job** - Query for persisted API state, runtime-specific controllers/stores for live chat behavior, and local state for tiny interactions.

## Change Guidance

When adding or changing capabilities:

1. Add or adjust reusable business/domain behavior in `@ai-team/core`.
2. Expose or adapt application operations through `@ai-team/service`.
3. Extend the relevant transport/client package:
   - `@ai-team/api-client` for local/in-process use
   - `@ai-team/api-client-http` and `@ai-team/api-server` for remote/browser use
   - `@ai-team/ide-interface` for IDE-facing integration
4. Wire UX in the appropriate adapter package (`cli`, `vscode`, or `web`).
5. Update architecture docs in the same change when the architecture, boundaries, runtime storage, or execution path changes.

## Related Reading

- [COPILOT-CONTEXT.md](COPILOT-CONTEXT.md)
- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md)
- [docs/api/contracts.md](docs/api/contracts.md)
- [docs/implementation/web-state-architecture.md](docs/implementation/web-state-architecture.md)
