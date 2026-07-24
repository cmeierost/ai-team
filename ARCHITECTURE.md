# AI Team - Architecture

> **Deep reference (on-demand):** This file is intentionally detailed and can be expensive to load in every chat.
> Start with `docs/architecture/overview.md` and open this file only when your task needs deeper architecture or code-entry-point detail.

## Documentation Map

- [README.md](README.md) - repository front door, setup, and navigation.
- [COPILOT-CONTEXT.md](COPILOT-CONTEXT.md) - tactical implementation briefing for coding agents.
- [`.ai-team/tasks/`](.ai-team/tasks/) - local long-running backlog for architecture transitions and planned features.
- [docs/architecture/overview.md](docs/architecture/overview.md) - concise human-readable summary of the current architecture.
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md) - Mermaid diagrams for package boundaries and runtime flows.
- [docs/architecture/implementation-entry-points.md](docs/architecture/implementation-entry-points.md) - deep code-entry-point index for architecture-heavy tasks.
- [docs/api/contracts.md](docs/api/contracts.md) - transport-facing API documentation for the API server surface.
- [docs/implementation/web-state-architecture.md](docs/implementation/web-state-architecture.md) - target frontend state split and migration guidance.

### Recommended read order (progressive disclosure)

1. `docs/architecture/overview.md` (short summary)
2. `docs/architecture/diagrams.md` (visual map)
3. `ARCHITECTURE.md` (this file, deep architecture narrative)
4. `docs/architecture/implementation-entry-points.md` (code-navigation deep dive)
5. `docs/api/contracts.md` (API/transport specifics only when relevant)

## Purpose

AI Team is a TypeScript monorepo for running a file-backed virtual software organization across multiple user surfaces.

The architecture optimizes for:

- thin adapters at the edges
- typed service boundaries in the middle
- reusable UI-free logic in `@ai-team/core`
- transport flexibility for local and remote clients
- runtime state rooted under `.ai-team/`

## Current state, target direction, and active backlog

This document intentionally describes both the **current implementation shape** and the **target direction** for the in-progress architecture transition.

- **Current state**
  - Several paths still use mediator-oriented naming for both business calls and UI-facing streaming.
  - The current web chat path is functional but still part of the architecture cleanup.
- **Target direction**
  - CLI and web should call transport-independent service interfaces.
  - The internal service-layer mediator should stay inside `@ai-team/service`.
  - Services should notify UI surfaces through a `UI notifier` stream.
  - Dependency injection should be strict across the logic ↔ infrastructure boundary.
  - `@ai-team/service` should depend on boundary interfaces in `@ai-team/core` rather than direct infrastructure implementations.
  - Concrete implementations belong in container/bootstrap wiring; `@ai-team/service` and its tests must not import `@ai-team/infrastructure` directly.
- **Active local backlog**
  - The durable backlog for this transition lives in [`.ai-team/tasks/`](.ai-team/tasks/).
  - Keep that backlog updated with current state, target state, decisions, open questions, and next steps.
  - The immediate roadmap is: docs/backlog alignment → messenger/mediator clarification → UI chat stabilization → DI and service/infrastructure decoupling.

## Implementation Entry Points

The detailed code-entry-point index was moved to keep this file lighter:

- [docs/architecture/implementation-entry-points.md](docs/architecture/implementation-entry-points.md)

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
  └─ @ai-team/api-server

Typed clients / integration contracts
  ├─ @ai-team/api-contracts
  └─ @ai-team/ide-interface

Runtime composition primitives
  └─ @ai-team/container

Application orchestration
  └─ @ai-team/service

UI-free domain + workspace logic
  └─ @ai-team/core

Permission runtime library
  └─ fs-context

Runtime state + external integrations
  ├─ .ai-team/*
  └─ LLM / provider APIs
```

### Execution paths

- **CLI local path**: `@ai-team/cli -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- **Web remote path**: `@ai-team/web -> @ts-http -> @ai-team/api-server -> @ai-team/api-contracts -> @ai-team/service -> @ai-team/core -> .ai-team/*`
- **VS Code IDE integration path**: `CLI or api-server -> @ai-team/ide-interface -> @ai-team/vscode IDE-local server -> VS Code-native review/open-file UX`

## Package Responsibilities

### `fs-context`

- Shared fs-context runtime library in the repository root.
- Provides `.perm` parsing helpers, glob matching, overlap analysis, and `ContextRuntime` for context/file rights lookups.
- Used by `@ai-team/core` context management (`packages/core/src/context/index.ts`) as the underlying permission runtime.

### `@ai-team/core`

- Owns UI-free domain logic, shared types, Zod-backed schemas, and workspace-backed file/domain operations.
- Owns the core concepts for agents, teams, skills, context, tools, and file-backed runtime behavior under `.ai-team/`.
- Must remain adapter-agnostic and UI-free.

### `@ai-team/container`

- Owns the lightweight runtime DI container (`ServiceContainer`), typed token key (`Token`), and container bootstrap helper primitives.
- Current state: also contains default service bootstrap wiring used by local and API-server execution paths.
- Target direction: should remain the place where startup chooses implementations while higher layers talk to interfaces.
- Depends only on shared contracts (`@ai-team/core`) and remains transport/UI agnostic.

### `@ai-team/service`

- Owns application orchestration on top of core.
- Current state: defines mediator-style contracts in `src/contracts.ts` and implements `invoke()` / `stream()` in `src/index.ts`.
- Target direction: exposes transport-independent service interfaces for UI callers, keeps the internal service-layer mediator private, and pushes UI-facing streaming into an explicit `UI notifier` concept.
- Owns chat runtime orchestration, including slash command routing, NL forwarding, handoff flow, tool execution flow, question flow, and workflow continuation.
- Owns backend managers such as sessions, tasks, workflow state, and proposal persistence used by adapters and transports.
- Boundary rule: `@ai-team/service` depends on `@ai-team/core` interfaces and container tokens only. Concrete implementations are selected during bootstrap and must not be imported directly from service code or service tests.
- Shortcut rule: **container command definitions may call `@ai-team/infrastructure` directly when the command is purely a config/data read with no orchestration logic, governance, or side-effects.** These commands do not need a service adapter layer. Commands with LLM orchestration, governance policy enforcement, agent mutation, or workflow state must continue to route through `@ai-team/service`.

## Unified command dispatch and parameter semantics

`ICommand` is the shared callable primitive for CLI, chat slash, workflow, and
LLM tool surfaces. `ICommandDescriptor.parameters` defines the canonical Zod
input object; adapters do not define independent parameter contracts.

`CommandDispatcher` owns the human-facing pipeline:

1. preserve the slash invocation and pass its raw argument tail to dispatch
2. parse schema-shaped JSON or normalize quoted/named/positional tokens
3. map a declared variadic tail to one array property
4. fill missing same-name values from `ExecutionContext`
5. apply explicit `contextParameters` and `workflowInputBindings`
6. ask an attached question service for required human values still missing
7. enforce `requiredAtRuntime` and perform final Zod parsing
8. execute the command with one validated object

Explicit caller values have precedence; runtime binding only fills missing or
`undefined` paths. Workflow bindings can read from the previous step result or
the workflow-carried state bag.

`ToolManager` reuses the runtime binding and validation logic for agent calls,
then performs authorization. It does not prompt. Context-owned,
workflow-bound, and explicitly hidden parameters are removed from the
LLM-facing schema.

Every tool-exposed command requires a group. Its canonical model-facing
identity is derived as snake-case `group_key`, avoiding hand-authored aliases
that drift from registration metadata.

Slash commands persist the original developer line and a separate
`slash:<token>` tool result. Commands return presentation data in
`CommandResponse`; UI adapters render the tool lifecycle event rather than
commands writing directly to a terminal. The detailed contract and `/run`
example live in
[`docs/implementation/command-dispatch-and-parameters.md`](docs/implementation/command-dispatch-and-parameters.md).

Tool history is an append-only timeline. `message_tool_calls` stores the
invocation identity, input, and request timestamp before execution begins;
`message_tool_results` stores the correlated terminal outcome and its own
completion timestamp. Live and resumed clients therefore render request and
result as separate immutable transcript entries. A `start` event remains
ephemeral execution state and is not a durable transcript record. Legacy
combined rows are migrated into the split representation and remain readable
through the `ChatMessage.tool_calls` compatibility projection.

### `@ai-team/api-contracts`

- Defines the service interface contracts and wire protocol types.
- Provides type-safe request/response definitions.
- Used by both local and remote clients.

### `@ai-team/api-server`

- Owns HTTP and WebSocket transport adaptation for browser and remote clients.
- Mounts REST routes, Swagger/OpenAPI docs, AsyncAPI docs, and the chat WebSocket endpoint.
- Consumes `@ai-team/service` interfaces and exposes them over HTTP/WebSocket.
- Brokers optional IDE-facing integration paths such as proposal replay and editor notifications.

### `@ai-team/ide-interface`

- Owns the shared IDE bridge contracts, discovery file shape, and adapter factory used by CLI, API server, and the VS Code extension.
- Defines how non-IDE runtimes discover and talk to a running editor instance.
- Keeps IDE message protocols out of the service/core layers.

### `@ai-team/cli`

- Owns terminal parsing, prompts, rendering, and process-level UX.
- Delegates business operations to `@ai-team/service`.
- Can forward proposal/open-file actions into the IDE bridge when VS Code is available.

### `@ai-team/vscode`

- Owns editor-native activation, commands, views, panels, decorations, and IDE-local integration UX.
- Starts an IDE-local WebSocket server for initialized workspaces and writes `.ai-team/.ide-server.json` for discovery.
- Acts as the IDE endpoint for open-file requests and code-edit review requests coming through `@ai-team/ide-interface`.
- Keeps reusable business logic out of the extension package; the extension translates shared IDE messages into VS Code-native UX.

### `@ai-team/web`

- Owns the browser UI for dashboard, team graph, employee list, portfolio/editor, chat, session/thread graph, and context/task/permission surfaces.
- Uses the remote transport path through `@ts-http` and `@ai-team/api-server` rather than importing lower runtime layers directly into browser code.
- Is currently a hybrid frontend architecture: some data access is extracted into query hooks, while several feature screens still combine fetching, orchestration, and rendering.
- Target direction remains TanStack Query for persisted API-backed state, narrow runtime controllers/stores for live chat state, and prop-driven presentational views where practical.
- Target direction also includes injecting client implementations at startup so the same UI can run against different local/remote hosts without rewriting feature code.

## Runtime State Model

All durable runtime state lives under `.ai-team/` in the workspace.

- `.ai-team/config.json` - non-secret provider/model/configuration state.
- `.ai-team/.env` - secrets and provider tokens.
- `.ai-team/agents/*.agent.md` - Agent files with YAML frontmatter for all metadata and Markdown body for the portfolio.
- `.ai-team/agents/*.perm` - per-agent file-path access policy files (read/write/create/delete + optional deny via `!pattern`).
- `.ai-team/private/ai-team.db` - SQLite database for sessions, messages, and related metadata.
- `.ai-team/proposals/` - persisted code-edit proposals used by review/replay flows.
- `.ai-team/.ide-server.json` - discovery file for the active IDE-local server when the VS Code extension is running.

Compatibility/bootstrap artifacts may also exist under `.github/`, but `.ai-team/` remains the durable runtime source of truth.

## File-System Access Model

The current file-path access model is centered on `fs-context` + per-agent `.perm` files, with `ContextManager` as the compatibility adapter consumed by service/API/CLI/tooling surfaces.

- Agent frontmatter no longer carries file-path read/write/create/delete rules.
- Per-agent path policy lives in `.ai-team/agents/<agent-id>.perm`.
- Global file-tree defaults still come from `.ai-team/config.json` (`fileTree.readPaths`, `writePaths`).
- Effective evaluation is `ContextRuntime`-based across CLI/service/API paths.
- Rights inheritance is enforced as:
  - `write => read + list`
  - `read => list`
- Explicit deny/ignore rules retain precedence over inherited allows.

## Command and Transport Model

### Current state

`@ai-team/service` currently acts as the mediator boundary for application operations.

- Request contract: `MediatorRequest<TCommand>`.
- Unary execution: `invoke(request, context)`.
- Streaming execution: `stream(request, context)`.
- Stream contract: `MediatorEvent<TCommand>` with `started`, `status`, `progress`, `log`, `token`, `tool`, `question`, `handoff`, `result`, `error`, `done`, and `aborted` variants.

### Target direction (in progress)

- CLI and web should call shared transport-independent **service interfaces**.
- The internal **service-layer mediator** should remain inside `@ai-team/service` and not be called directly from the UI.
- Services should notify UI surfaces through a `UI notifier` stream.
- Explicit user-triggered tool / MCP / CLI execution is a planned service surface that shapes the target architecture, but it is not part of the immediate refactor scope.
- Slash-command execution can remain broad and server-parsed, while the UI still consumes typed slash-command metadata for discovery and autocomplete.

### Active backlog link

The durable local backlog for this transition lives in [`.ai-team/tasks/`](.ai-team/tasks/). Update those task files whenever the current state, target direction, or next steps change.

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

## Onboarding workflow architecture (current implementation)

The onboarding runtime in `@ai-team/service` is now workflow-first.

- Command entry: `OnboardICommand` in `packages/service/src/commands/hr/onboard.ts`
- Workflow definition: `createOnboardingWorkflowDefinition()` in `packages/service/src/commands/hr/onboarding-workflow.ts`
- Sub-workflow: `hire_workflow` in `packages/service/src/commands/hr/hire-workflow.ts`

`OnboardICommand.executeOnboarding()` resolves `WorkflowRunnerFactory` from DI and runs `onboard_workflow` with the current `ExecutionContext` (including signal + invocation surface). The command no longer embeds the prior hand-written onboarding sequence directly.

The current onboarding workflow composes generic orchestration tools and workflow-defined tools, including:

- `llm_init`
- `init_bootstrap_files`
- `init_prepare_onboarding`
- `hr_name_suggestions`
- `com_ask`
- `hr_hire`
- `access_set_permissions`
- `chat_phase`
- `docs_save_transcript`
- `llm_call`
- `hire_workflow`

This keeps onboarding behavior declarative and easier to evolve by editing workflow definitions rather than duplicating orchestration logic in imperative command code.

## Workflow engine semantics (current implementation)

The workflow runtime (`packages/service/src/workflow/xstate-workflow-runner.ts` +
`workflow-param-resolver.ts`) supports both typed and declarative workflow definitions:

- Step args can be declared with template interpolation (`args`) or computed in code (`params`).
- Step guards support both callback checks (`skipWhen`) and declarative expressions (`when`).
- Loop steps are supported via `kind: 'loop'` + `while` + `maxIterations`.
- Step outputs are stored by default under `state[step.id]` unless `applyResult` overrides state mapping.
- Workflow result projection supports declarative `result` and typed `toResult`.
- A workflow may define `return: { command, args? }`. The runner resolves those
  arguments against current state and exposes the return contract plus outer
  workflow frames through `ExecutionContext`.
- `/return` is a generic shortcut that dispatches the active workflow's return
  command. It does not contain workflow-specific navigation logic.

Declarative arg/result transforms currently include:

- `$literal`
- `$coalesce`
- `$map`

Chat configures `session-handoff-return` as its return command. That command
resolves the persisted parent handoff frame and invokes `com_handoff` with
`navigationIntent: back`; the handoff tool writes the return summary, restores
the parent session/workflow identity, and pops the return stack. Workflows
without a custom return command use their last completed tool response; only a
workflow with neither a return command nor a completed tool result rejects
`/return`.

These semantics are relied on by onboarding/hiring/chat workflows and are part
of the current architecture contract for workflow-authored orchestration.

## Request-scoped runtime event correlation (current implementation)

Streaming paths now use a per-connection `EmitService` and request-scoped sink rebinding:

- `InteractionStream` accepts an optional connection-scoped `emitService`.
- For each request, `InteractionStream` calls `emitService.bindSink(...)` so runtime events are routed through that request's queue/correlation path.
- On request completion, the restore callback returns the sink to the connection default.

This keeps runtime event routing isolated and predictable across concurrent requests on the same connection, while preserving command/tool code paths that emit through injected `IEmitService`.

## Chat session threads and handoff state

A chat `session` is the private LLM context of one agent personality. A visible
multi-agent `thread` is the service-owned projection of sessions connected by
`previousSessionId`; it is not a merged model history.

The thread root persists `activeSessionId`, `threadNavigationStack`, and
`threadLastActiveAt` in SQLite. `IThreadManager`/`ThreadManager` resolve an
explicit member session to that cursor, seed legacy threads deterministically,
and own handoff push/return-pop behavior. Bare `ait chat` instead selects the
session with the latest message or persisted tool activity; it does not infer a
thread cursor from `lastActivityAt`. An agent-only invocation always creates a
new root session for the requested agent.
`ChatStartupTargetResolver` also owns bare, member-session, and agent-only
startup selection; CLI and API adapters pass intent and do not traverse thread
state themselves.

`com_handoff` owns delegation approval and transition semantics. A trusted
human slash invocation is pre-approved; an agent tool call to a target absent
from its configured `handoffs` invokes `com_ask` before any transition side
effect. A handoff to the current return-stack top is a summarized return.
`/return` reaches that behavior through the generic workflow return contract:
`chat-runtime-loop.return` dispatches `session-handoff-return`, which invokes
`com_handoff` in parent-return mode. The slash command itself knows nothing
about chat sessions or handoff summaries.
Denied, timed-out, or unavailable approval returns a typed `cancelled` command
response without changing messages, cursor, stack, or runtime identity.

One logical handoff summary is persisted in both participating sessions with a
shared `handoffId`. The service builds a separate presentation transcript from
all thread members, orders it by timestamp and persisted message ID, and
deduplicates those mirrored summaries. Adapters render that projection and
react to identity/session events; they do not own thread navigation or merge
the projection into an agent's private history.

## ChatOrchestrator Pipeline

`packages/service/src/commands/chat/chat.command.ts` is intentionally thin. It performs preflight checks, resolves the current agent/session, builds the orchestration context, and hands control to `ChatOrchestrator`.

The orchestration pipeline lives in `packages/service/src/orchestrator/`.

```text
chatCommand (commands/chat/chat.command.ts)
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

| Interface            | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `ISlashCommand`      | In-chat `/command` handler                    |
| `IContextCompressor` | History compression / summarization seam      |
| `IContextBuilder`    | Final prompt/context assembly                 |
| `IContextEnricher`   | Role-aware system-message enrichment          |
| `IRagProvider`       | Retrieval-augmented context injection         |
| `IToolResolver`      | Local tool resolution per turn                |
| `IMcpGateway`        | External MCP tool discovery                   |
| `ILlmSelector`       | Provider/model selection per turn             |
| `IOutputHandler`     | Completed-turn persistence and output routing |

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
4. **Remote and local clients are different on purpose** - CLI calls service directly; the web client uses `@ts-http` to call the API server.
5. **IDE integration is its own boundary** - `@ai-team/ide-interface` and `@ai-team/vscode` handle editor-local workflows without pushing IDE concerns down into service/core.
6. **Runtime state conventions remain under `.ai-team/`**.
7. **Typed command contracts remain centralized in service**.
8. **Web state should use the right tool for the job** - Query for persisted API state, runtime-specific controllers/stores for live chat behavior, and local state for tiny interactions.

## Change Guidance

When adding or changing capabilities:

1. Add or adjust reusable business/domain behavior in `@ai-team/core`.
2. Expose or adapt application operations through `@ai-team/service`.
3. Extend the relevant transport/client package:
   - `@ai-team/api-contracts` for type definitions
   - `@ai-team/api-contracts` for type definitions
   - `@ts-http` and `@ai-team/api-server` for remote/browser use
   - `@ai-team/ide-interface` for IDE-facing integration
4. Wire UX in the appropriate adapter package (`cli`, `vscode`, or `web`).
5. Update architecture docs in the same change when the architecture, boundaries, runtime storage, or execution path changes.
6. When the change is part of an ongoing transition, update the relevant task files in [`.ai-team/tasks/`](.ai-team/tasks/) so the local backlog stays truthful.
7. For every feature implementation and code-cleanup/refactor, run fuzzy duplication scanning on the affected scope and review hotspots before merging (`pnpm --filter @aspect/duplication build` then `node analysis/duplication/dist/cli/fuzzy-dup.js <scope>`).

## Related Reading

- [COPILOT-CONTEXT.md](COPILOT-CONTEXT.md)
- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md)
- [docs/api/contracts.md](docs/api/contracts.md)
- [docs/implementation/web-state-architecture.md](docs/implementation/web-state-architecture.md)
