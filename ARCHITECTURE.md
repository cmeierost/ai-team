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

- Mediator contracts and command payload/response types: [packages/service/src/contracts.ts](packages/service/src/contracts.ts)
- Service command dispatch and runtime event wiring: [packages/service/src/index.ts](packages/service/src/index.ts)
- Service command metadata / `llmCallable`: [packages/service/src/command-registry.ts](packages/service/src/command-registry.ts)
- Chat orchestration rules (slash commands, tool-calling, handoff/hire directives): [packages/service/src/commands/chat.ts](packages/service/src/commands/chat.ts)
- Workflow continuation persistence: [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts)
- Tool definitions and registry (`ask_human`, `ask_question`, etc.): [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts)
- Command catalog metadata for model-facing command descriptions: [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts)
- Typed client facade and local service wiring: [packages/api-client/src/index.ts](packages/api-client/src/index.ts)
- CLI adapter command wiring: [packages/cli/src/cli.ts](packages/cli/src/cli.ts), [packages/cli/src/commands](packages/cli/src/commands)

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
- `.ai-team/private/chats/*.jsonl` - private chat transcripts.

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
