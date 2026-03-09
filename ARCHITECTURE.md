# AI Team - Architecture

## Documentation Map

- [Copilot Context](COPILOT-CONTEXT.md) - working assumptions and execution guardrails for coding agents.
- [Architecture Overview](docs/architecture/overview.md) - concise architecture summary.
- [Architecture Diagrams](docs/architecture/diagrams.md) - Mermaid context/container views.
- [API/Service Contracts](docs/api/contracts.md) - mediator contracts and extension checklist.
- [Core Package Guide](packages/core/README.md) - core package usage notes.
- [VS Code Package Guide](packages/vscode/README.md) - extension adapter notes.
- [Web Package Guide](packages/web/README.md) - web adapter notes.

## Implementation Entry Points

Use this as a "where should I change code" index:

| What | Where |
|---|---|
| Mediator contracts and command payload/response types | [packages/service/src/contracts.ts](packages/service/src/contracts.ts) |
| Service command dispatch and runtime event wiring | [packages/service/src/index.ts](packages/service/src/index.ts) |
| CLI/LLM command metadata (`llmCallable`, `usage`, `description`) | [packages/service/src/command-registry.ts](packages/service/src/command-registry.ts) |
| In-chat slash command implementations and descriptions | [packages/service/src/orchestrator/slash-commands.ts](packages/service/src/orchestrator/slash-commands.ts) |
| LLM turn orchestration (tool-calling, handoff/hire, context) | [packages/service/src/orchestrator/chat-orchestrator.ts](packages/service/src/orchestrator/chat-orchestrator.ts) |
| Pipeline stage interfaces (ISlashCommand, IContextEnricher, …) | [packages/service/src/orchestrator/pipeline.ts](packages/service/src/orchestrator/pipeline.ts) |
| Natural-language agent-switch detection | [packages/service/src/orchestrator/forward-detection.ts](packages/service/src/orchestrator/forward-detection.ts) |
| Timeout / abort-signal wrapping (used across all async pipeline stages) | [packages/service/src/orchestrator/async-utils.ts](packages/service/src/orchestrator/async-utils.ts) |
| Chat command entry point (thin bootstrap + interactive loop) | [packages/service/src/commands/chat/index.ts](packages/service/src/commands/chat/index.ts) |
| Agent selection logic (default top agent, prompt formatting) | [packages/service/src/utils/agent-selection.ts](packages/service/src/utils/agent-selection.ts) |
| Tool definitions and registry (`ask_human`, `ask_question`, etc.) | [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts) |
| Command catalog metadata for model-facing command descriptions | [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts) |
| Typed client facade and local service wiring | [packages/api-client/src/index.ts](packages/api-client/src/index.ts) |
| CLI adapter command wiring | [packages/cli/src/cli.ts](packages/cli/src/cli.ts) |

## System Overview

AI Team is a TypeScript monorepo for running a file-backed virtual software organization.

It provides multiple user surfaces (`CLI`, `VS Code extension`, and `Web`) while keeping reusable business logic centralized and adapter-independent.

## Current Architecture (March 2026)

The current runtime is a layered model:

```
┌──────────────────────────────────────────────────────────────┐
│ Adapter Layer                                                │
│  ├─ @ai-team/cli (commander + terminal UX)                  │
│  ├─ @ai-team/vscode (extension views/panels)                │
│  └─ @ai-team/web (React UI)                                 │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Client Layer: @ai-team/api-client                           │
│  ├─ Typed client API used by adapters                        │
│  ├─ Command-oriented methods (`chat`, `hire`, `provider.*`) │
│  └─ In-process client factory (`createLocalAiTeamClient`)   │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Service Layer: @ai-team/service                              │
│  ├─ Mediator contracts (`invoke`, `stream`)                 │
│  ├─ Command dispatch / session management                    │
│  ├─ ChatOrchestrator pipeline (see below)                   │
│  └─ Runtime event stream (status, token, tool, question)    │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Domain Layer: @ai-team/core                                  │
│  ├─ Team, agent, context, chat, llm, tool, storage domains  │
│  ├─ Shared domain types and graph models                     │
│  └─ UI-free business logic and file operations               │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ State + Integrations                                         │
│  ├─ .ai-team/* runtime artifacts                             │
│  └─ LLM provider APIs                                        │
└──────────────────────────────────────────────────────────────┘
```

## ChatOrchestrator Pipeline (`packages/service/src/orchestrator/`)

`chatCommand` (the CLI entry point) is a thin bootstrap. All LLM turn logic,
slash command dispatch, tool-calling, handoffs, and NL agent-switch detection
live inside `ChatOrchestrator` — meaning CLI, VS Code, and API server all get
identical behavior automatically.

```
chatCommand (commands/chat/index.ts)
  └─ ChatOrchestrator.run(message)
       ├─ 1. trySlashCommand()     slash-commands.ts
       ├─ 2. tryNlForward()        forward-detection.ts
       └─ 3. turn loop
            ├─ IContextBuilder     orchestrator/defaults/
            ├─ IContextEnricher[]  orchestrator/defaults/
            ├─ IRagProvider        orchestrator/defaults/
            ├─ ILlmSelector        orchestrator/defaults/
            ├─ send-turn.ts        → LLM call + tool dispatch
            └─ IOutputHandler      persist + emit events
```

### Pipeline interfaces

All pipeline stages are defined as interfaces in `pipeline.ts`.
Concrete defaults live in `orchestrator/defaults/`.
Callers can inject alternatives via `OrchestratorPlugins`.

| Interface | Purpose |
|---|---|
| `ISlashCommand` | In-chat `/command` handler (key, aliases, description, usage, llmCallable, execute) |
| `IContextCompressor` | Truncate / summarize history before context build |
| `IContextBuilder` | Assemble the final prompt context |
| `IContextEnricher` | Add enrichment blocks (file context, workspace overview, …) |
| `IRagProvider` | Inject retrieval-augmented passages |
| `IToolResolver` | Look up and execute agent tools |
| `IMcpGateway` | Route MCP tool calls |
| `ILlmSelector` | Select provider + model per turn |
| `IOutputHandler` | Persist and emit the completed turn |

### Slash command registry

Slash command descriptions, usage strings, and `llmCallable` flags live
**directly on the `ISlashCommand` objects** in `slash-commands.ts` — next to
the `execute` implementation. There is no separate metadata table to keep
in sync.

`command-registry.ts` exports `IN_CHAT_COMMAND_REGISTRY` and
`IN_CHAT_COMMAND_ALIASES` derived from those objects, so CLI, web, and API
surfaces always reflect the authoritative descriptions:

```typescript
export const IN_CHAT_COMMAND_REGISTRY = buildChatCommandRegistry();
export const IN_CHAT_COMMAND_ALIASES  = buildChatCommandAliases();
```

Adding a new slash command requires only one object in `slash-commands.ts`.

## `commands/chat/` Module Map

`chatCommand` in `commands/chat/index.ts` is intentionally thin.
Cross-cutting service concerns are separated into focused sub-modules:

| File | Exports |
|---|---|
| `hooks.ts` | `ChatRuntimeHooks` — caller I/O contract |
| `emit.ts` | `emitRuntimeEvent`, `writeInfo/Warn/Error`, `printSessionResume` |
| `questions.ts` | `requestInput`, `requestConfirm`, `requestSelect`, `requestPassword`, `requestChecklist` |
| `forward-detection.ts` | Re-export barrel → `orchestrator/forward-detection.ts` |
| `async-utils.ts` | Re-export barrel → `orchestrator/async-utils.ts` |
| `agent-selection.ts` | Re-export barrel → `utils/agent-selection.ts` |

Re-export barrels keep existing test and adapter imports stable while the
implementations live in their canonical layers.

## Utility Module Map (`packages/service/src/utils/`, `packages/service/src/orchestrator/`)

| Module | Location | Purpose |
|---|---|---|
| `async-utils.ts` | `orchestrator/` | `withTimeout`, `withAbortSignal`, `isAbortError`, `throwIfAborted` — used by orchestrator pipeline stages, tool dispatch, and `chatCommand` |
| `agent-selection.ts` | `utils/` | `selectDefaultTopAgent`, `formatUserPrompt`, `resolveDeveloperName` — UI-free, usable from any surface |
| `forward-detection.ts` | `orchestrator/` | NL agent-switch detection (3-phase: regex → word slices → LLM fallback) |
| `git.ts` | `utils/` | `getGitUserName`, `developerNameToId` |
| `user-env.ts` | `utils/` | `ensureUserEnvVars` |

## Package Responsibilities

### `@ai-team/core`

- Canonical business/domain logic.
- Owns shared types, domain operations, file-backed state behaviors, and context boundaries.
- Must remain UI-free (no `vscode`, `react`, `react-dom`, `electron` imports).

### `@ai-team/service`

- Application service orchestration on top of core.
- Defines command contracts and command response maps.
- Provides mediator execution APIs:
  - `invoke(...)` for request/response command execution.
  - `stream(...)` for token/event streaming execution.
- Owns `ChatOrchestrator` — the full LLM turn pipeline available to all surfaces.
- Owns slash command implementations and their metadata (descriptions live next to execute).

### `@ai-team/api-client`

- Typed client facade over service contracts.
- Provides command-specific convenience methods (`listEmployees`, `chat`, `providerModels`, etc.).
- Encapsulates in-process wiring (`createLocalAiTeamClient`) so adapters don't manage service internals.

### `@ai-team/cli`

- Terminal adapter.
- Handles command-line parsing, prompts, terminal rendering, and process signals.
- Delegates command execution to `@ai-team/api-client`.

### `@ai-team/vscode`

- VS Code adapter.
- Hosts extension activation, tree/panel integrations, and editor-facing UX.
- Delegates business operations through client/service contracts.

### `@ai-team/web`

- React visualization adapter.
- Presents graph/chat/team UI and delegates operations through shared contracts.

## Runtime State Model

All runtime artifacts are rooted under `.ai-team/` in the workspace:

- `.ai-team/config.json` - non-secret provider/model/configuration state.
- `.ai-team/.env` - secrets and provider tokens.
- `.ai-team/agents/*.agent.md` - Copilot-facing agent portfolio files.
- `.ai-team/agents/*.agent.yml` - ai-team runtime metadata sidecars for those agent portfolios.
- `.ai-team/private/ai-team.db` - SQLite database for chat sessions, messages, and metadata.

Compatibility/bootstrap artifacts may also exist under `.github/`, but they are optional and are not the default home for agent, prompt, or skill authoring in this repository.

## Command Execution Model

1. Adapter accepts a user action (CLI command, extension action, or web interaction).
2. Adapter calls `AiTeamClient` (`@ai-team/api-client`).
3. Client forwards typed `MediatorRequest` to `@ai-team/service`.
4. Service dispatches to command handlers; chat commands enter `ChatOrchestrator.run()`.
5. Service uses `@ai-team/core` for domain logic and storage/model interactions.
6. Responses/events flow back to the adapter for rendering.

## Orchestration Rules

Orchestration rules are deterministic service-side decision rules that shape command/chat execution before and after model generation. They are applied inside `ChatOrchestrator` before each LLM turn.

### Turn dispatch precedence

1. **Slash commands** — `/list`, `/hire`, `/chat`, etc. Implementations in `slash-commands.ts`.
2. **NL forward detection** — natural-language requests to be forwarded to another agent. Implementation in `forward-detection.ts`, called via `tryNlForward()` in the orchestrator.
3. **Direct tool syntax** — `#tool {...}` or `/tool ...` parsed and executed through tool guards.
4. **LLM generation** — non-command natural language falls through to the turn loop.

### Safety and approval gates

- Tool execution emits runtime tool events (`request`, `start`, `result`, `error`, `denied`).
- Non-question tools require explicit confirmation before execution.
- Permission checks (`getAgentTools`) constrain what each agent can run.

### Interactive workflow continuation

- Question prompts (`input`, `confirm`, `select`, `password`, `checklist`) emit workflow frames.
- Continuation state (`workflowId`, `continuationToken`, answers) is persisted and resumed.
- Adapters provide UX-specific responders; a single question system is shared across CLI, VS Code, and web.

### Post-response directives

- Service parses structured directives from agent responses (`HANDOFF:`, HR hire directives).
- These trigger service actions (switch agent, create hire) after response persistence.

### LLM guidance vs execution

- `llmCallable` on `ISlashCommand` influences what the model is told it may request.
- It does not automatically turn every command into a tool invocation path.

## Mediator Pattern

`@ai-team/service` is the mediator boundary for application operations.

- Request contract: `MediatorRequest<TCommand>` (command + typed payload).
- Unary execution: `invoke(request, context)`.
- Streaming execution: `stream(request, context)`.
- Stream contract: `MediatorEvent<TCommand>` (`started`, `status`, `progress`, `log`, `token`, `tool`, `question`, `result`, `done`, `error`, `aborted`).

### Current CLI connection (direct local path)

Today the CLI runs an in-process path:

`@ai-team/cli → createLocalAiTeamClient() → createAiTeamService() → ChatOrchestrator → @ai-team/core`

### Remote-UI-ready design

Although CLI currently connects directly to the local service process, the architecture is intentionally transport-agnostic:

- Adapters depend on `AiTeamClient` shape, not command internals.
- Service behavior is expressed as request/response + event stream contracts.
- A future remote client can map `invoke/stream` to HTTP/WebSocket/SSE without changing core command logic.

## Architecture Invariants

1. **Core is UI-free** — no `vscode`, `react`, `react-dom`, or `electron` imports.
2. **Adapters stay thin** — orchestration and UX at edges, reusable behavior in service/core.
3. **Orchestrator owns LLM behavior** — slash commands, NL forwarding, tool dispatch, handoffs, and context building all live inside `ChatOrchestrator`, not in adapters.
4. **Descriptions live next to implementations** — slash command `description`, `usage`, and `llmCallable` are fields on the `ISlashCommand` object, not in a separate registry table.
5. **Runtime state conventions** remain under `.ai-team/`.
6. **Typed command contracts** are centralized in service and consumed through api-client.
7. **Permission/context boundaries** are enforced before file/tool operations.

## Extension Guidance

When adding or changing capabilities:

1. Add/adjust domain behavior in `@ai-team/core`.
2. Expose operation through `@ai-team/service` command contracts and handlers.
3. Update `@ai-team/api-client` convenience methods.
4. Wire UX in one or more adapters (`cli`, `vscode`, `web`).
5. Update architecture docs and compatibility notes in the same change.

### Adding a new slash command

Add one `ISlashCommand` object to `buildDefaultSlashCommands()` in `slash-commands.ts`:

```typescript
{
  key: 'my-command',
  usage: '/my-command <arg>',
  description: 'What it does',
  llmCallable: false,
  execute: async (args, ctx) => { /* ... */ },
}
```

That's it. `IN_CHAT_COMMAND_REGISTRY`, `/help` output, and `IN_CHAT_COMMAND_ALIASES` all derive from it automatically.

Detailed implementation checklists for adding commands/tools are maintained in `docs/api/contracts.md`.


## System Overview

AI Team is a TypeScript monorepo for running a file-backed virtual software organization.

It provides multiple user surfaces (`CLI`, `VS Code extension`, and `Web`) while keeping reusable business logic centralized and adapter-independent.

## Current Architecture (February 2026)

The current runtime is a layered model:

```
┌──────────────────────────────────────────────────────────────┐
│ Adapter Layer                                                │
│  ├─ @ai-team/cli (commander + terminal UX)                  │
│  ├─ @ai-team/vscode (extension views/panels)                │
│  └─ @ai-team/web (React UI)                                 │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Client Layer: @ai-team/api-client                           │
│  ├─ Typed client API used by adapters                        │
│  ├─ Command-oriented methods (`chat`, `hire`, `provider.*`) │
│  └─ In-process client factory (`createLocalAiTeamClient`)   │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Service Layer: @ai-team/service                              │
│  ├─ Mediator contracts (`invoke`, `stream`)                 │
│  ├─ Command dispatch/orchestration                           │
│  ├─ Workflow state continuation for interactive commands     │
│  └─ Runtime event stream (status, token, tool, question)     │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ Domain Layer: @ai-team/core                                  │
│  ├─ Team, agent, context, chat, llm, tool, storage domains  │
│  ├─ Shared domain types and graph models                     │
│  └─ UI-free business logic and file operations               │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ State + Integrations                                         │
│  ├─ .ai-team/* runtime artifacts                             │
│  └─ LLM provider APIs                                        │
└──────────────────────────────────────────────────────────────┘
```

## Package Responsibilities

### `@ai-team/core`

- Canonical business/domain logic.
- Owns shared types, domain operations, file-backed state behaviors, and context boundaries.
- Must remain UI-free (no `vscode`, `react`, `react-dom`, `electron` imports).

### `@ai-team/service`

- Application service orchestration on top of core.
- Defines command contracts and command response maps.
- Provides mediator execution APIs:
  - `invoke(...)` for request/response command execution.
  - `stream(...)` for token/event streaming execution.
- Owns workflow continuation snapshots for interactive command flows.

### `@ai-team/api-client`

- Typed client facade over service contracts.
- Provides command-specific convenience methods (`listEmployees`, `chat`, `providerModels`, etc.).
- Encapsulates in-process wiring (`createLocalAiTeamClient`) so adapters don’t directly manage service internals.

### `@ai-team/cli`

- Terminal adapter.
- Handles command-line parsing, prompts, terminal rendering, and process signals.
- Delegates command execution to `@ai-team/api-client`.

### `@ai-team/vscode`

- VS Code adapter.
- Hosts extension activation, tree/panel integrations, and editor-facing UX.
- Delegates business operations through client/service contracts.

### `@ai-team/web`

- React visualization adapter.
- Presents graph/chat/team UI and delegates operations through shared contracts.

## Runtime State Model

All runtime artifacts are rooted under `.ai-team/` in the workspace:

- `.ai-team/config.json` - non-secret provider/model/configuration state.
- `.ai-team/.env` - secrets and provider tokens.
- `.ai-team/agents/*.md` - agent definitions (frontmatter + markdown).
- `.ai-team/private/ai-team.db` - SQLite database for chat sessions, messages, and metadata.

## Command Execution Model

1. Adapter accepts a user action (CLI command, extension action, or web interaction).
2. Adapter calls `AiTeamClient` (`@ai-team/api-client`).
3. Client forwards typed `MediatorRequest` to `@ai-team/service`.
4. Service dispatches to command handlers and orchestrates workflow continuation.
5. Service uses `@ai-team/core` for domain logic and storage/model interactions.
6. Responses/events flow back to the adapter for rendering.

## Orchestration Rules

Orchestration rules are deterministic service-side decision rules that shape command/chat execution before and after model generation.

They are distinct from:

- **Commands**: typed mediator operations (`AiTeamCommandName`) and payload/response contracts.
- **Tools**: executable capabilities (`AgentTool`) with permission checks and optional user approval.

Rules decide **which path runs next** (command dispatch, tool path, workflow continuation, handoff/hire actions), while commands and tools define **what capabilities exist**.

Current rule categories in `@ai-team/service`:

1. **Input routing precedence**
  - In-chat slash commands (`/list`, `/hire`, `/chat`, etc.) are parsed and handled directly.
  - Direct tool syntax (`#tool {...}` or `/tool ...`) is parsed and executed through tool guards.
  - Non-command natural language falls through to LLM response generation.

2. **Safety and approval gates**
  - Tool execution emits runtime tool events (`request`, `start`, `result`, `error`, `denied`).
  - Non-question tools require explicit confirmation before execution.
  - Permission checks (`getAgentTools`) constrain what each agent can run.

3. **Interactive workflow continuation**
  - Question prompts (`input`, `confirm`, `select`, `password`, `checklist`) emit workflow frames.
  - Continuation state (`workflowId`, `continuationToken`, answers) is persisted and resumed.

### Questioning as an orchestration primitive

Developer questioning belongs to orchestration, not to a separate capability layer.

- The service owns the canonical question flow through mediator context responders (`questionInput`, `questionConfirm`, `questionSelect`, `questionPassword`, `questionChecklist`) and `question` runtime events.
- Adapters provide UX-specific responders (terminal prompt, VS Code UI, web form) and return typed answers.
- Tool entrypoints such as `ask_human`/`ask_question` are allowed ways to trigger that same orchestration primitive during model turns.
- Workflow state persistence/continuation keeps question-driven flows resumable across command invocations.

This keeps one question system across local CLI usage and future remote transports.

4. **Post-response orchestration directives**
  - Service can parse structured/implicit directives from agent responses (for example `HANDOFF:` and HR hire directives).
  - These rules trigger service actions (switch agent, create new hire) after response persistence.

5. **LLM guidance vs execution boundary**
  - Metadata such as `llmCallable` influences what the model is told it may request.
  - It does not automatically turn every command into a tool invocation path.

This rule layer keeps behavior predictable and auditable while still allowing flexible natural-language interaction.

## Mediator Pattern

`@ai-team/service` is the mediator boundary for application operations.

- Request contract: `MediatorRequest<TCommand>` (command + typed payload).
- Unary execution: `invoke(request, context)`.
- Streaming execution: `stream(request, context)`.
- Stream contract: `MediatorEvent<TCommand>` (`started`, `status`, `progress`, `log`, `token`, `tool`, `question`, `result`, `done`, `error`, `aborted`).

This keeps adapter UX and transport concerns separate from command orchestration and domain behavior.

### Current CLI connection (direct local path)

Today the CLI runs an in-process path:

`@ai-team/cli -> createLocalAiTeamClient(...) -> createAiTeamService(...) -> command handlers -> @ai-team/core`

This gives zero network overhead for local workflows.

### Remote-UI-ready design

Although CLI currently connects directly to the local service process, the architecture is intentionally transport-agnostic:

- Adapters depend on `AiTeamClient` shape, not command internals.
- Service behavior is already expressed as request/response + event stream contracts.
- A future remote client can map `invoke/stream` to HTTP/WebSocket/SSE without changing core command logic.

In other words, the service is local-first today but structured for remote UIs with minimal adapter changes.

## Architecture Invariants

1. **Core is UI-free** and reusable across adapters.
2. **Adapters stay thin**: orchestration/UX at edges, reusable behavior in service/core.
3. **Runtime state conventions** remain under `.ai-team/`.
4. **Typed command contracts** are centralized in service and consumed through api-client.
5. **Permission/context boundaries** are enforced before file/tool operations.

## Extension Guidance

When adding or changing capabilities:

1. Add/adjust domain behavior in `@ai-team/core`.
2. Expose operation through `@ai-team/service` command contracts and handlers.
3. Update `@ai-team/api-client` convenience methods.
4. Wire UX in one or more adapters (`cli`, `vscode`, `web`).
5. Update architecture docs and compatibility notes in the same change.

Detailed implementation checklists for adding commands/tools are maintained in `docs/api/contracts.md` (Extension Checklist) to avoid duplicated guidance.

For Copilot-oriented implementation guidance, start with [API/Service Contracts](docs/api/contracts.md) and then apply the file-level entry points above.
