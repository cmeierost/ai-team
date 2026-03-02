# AI Team - Copilot Context

## Current Snapshot (Feb 27, 2026)

Monorepo packages currently present:
- `packages/core` - business logic, managers/services, file-backed state.
- `packages/service` - command mediator/service orchestration over core, session/task management.
- `packages/api-client` - typed client facade consumed by adapters.
- `packages/api-client-http` - HTTP/WebSocket client for remote API access.
- `packages/api-server` - Express REST API + WebSocket server for web UI.
- `packages/cli` - command adapter and operational workflows.
- `packages/vscode` - extension adapter (views/panels over core logic).
- `packages/web` - React UI for graph/chat/team visualization, context panel, task management.

## What This Project Is

AI Team is a toolset for running a virtual software organization with explicit context boundaries.

- Agents are represented as files under `.ai-team/`.
- Teams, skills, and role behavior are modeled in core.
- CLI and VS Code provide orchestration surfaces.
- Web provides visualization and interaction UX with real-time chat.
- Task management system tracks work across human-agent collaboration.
- Session management preserves context and creates shareable artifacts.

## Architecture Model (Current)

Layered adapter-to-core architecture with file-backed runtime state:

**CLI/VS Code Flow**:
`CLI / VS Code -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/* (+ provider APIs)`

**Web UI Flow**:
`Web -> @ai-team/api-client-http -> @ai-team/api-server -> @ai-team/service -> @ai-team/core -> .ai-team/*`

Core invariants:
- `@ai-team/core` stays UI-free (no `vscode`, `react`, `react-dom`, `electron`).
- Runtime state conventions remain centralized under `.ai-team/`.
- Permission/context checks are enforced before file/tool operations.
- Adapters orchestrate UX; service/api-client provide typed command boundaries; core owns reusable business logic.
- Sessions are private (gitignored), artifacts are shared (version controlled).

## Runtime Artifacts

- `.ai-team/config.json` - non-secret provider/model/config state.
- `.ai-team/.env` - secrets.
- `.ai-team/agents/*.md` - agent definitions (frontmatter + markdown).
- `.ai-team/private/ai-team.db` - SQLite database for chat sessions, messages, and metadata (gitignored).
- `.ai-team/artifacts/briefs/*.md` - shared knowledge artifacts (version controlled).
- `.ai-team/tasks/*.md` - task definitions (frontmatter + markdown).
- `.ai-team/tasks/index.json` - task lookup index.
- `.ai-team/tasks/templates.json` - task templates.

## Where to Read First

- [ARCHITECTURE.md](ARCHITECTURE.md) - detailed system design and constraints.
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - operational coding rules for agents.
- [docs/architecture/overview.md](docs/architecture/overview.md) - concise architecture summary.
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md) - context/container visual maps.
- [docs/api/contracts.md](docs/api/contracts.md) - REST API endpoint contracts and data types.
- [docs/implementation/task-management.md](docs/implementation/task-management.md) - task system architecture and usage.
- [packages/core/README.md](packages/core/README.md), [packages/vscode/README.md](packages/vscode/README.md), [packages/web/README.md](packages/web/README.md).

## Implementation Hotspots (Copilot)

- [packages/service/src/contracts.ts](packages/service/src/contracts.ts) - mediator request/event and command type contracts.
- [packages/service/src/index.ts](packages/service/src/index.ts) - command dispatch and mediator runtime wiring.
- [packages/service/src/commands/chat.ts](packages/service/src/commands/chat.ts) - orchestration rules, tool-calling loop, handoff/hire directives.
- [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts) - question/workflow continuation persistence.
- [packages/service/src/session-manager.ts](packages/service/src/session-manager.ts) - web UI session/artifact management.
- [packages/service/src/task-manager.ts](packages/service/src/task-manager.ts) - task lifecycle, workflows, time tracking.
- [packages/api-server/src/server.ts](packages/api-server/src/server.ts) - REST API server setup and route registration.
- [packages/api-server/src/routes/](packages/api-server/src/routes/) - API endpoint implementations (agents, chat, sessions, tasks).
- [packages/web/src/components/ChatPanel.tsx](packages/web/src/components/ChatPanel.tsx) - chat UI with session management.
- [packages/web/src/components/ContextPanel.tsx](packages/web/src/components/ContextPanel.tsx) - sidebar with sessions, tasks, artifacts.
- [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts) - tool registry + question tools.
- [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts) - command metadata for model-facing guidance.
- [packages/api-client/src/index.ts](packages/api-client/src/index.ts) - typed adapter-facing client and local wiring.
- [packages/cli/src/cli.ts](packages/cli/src/cli.ts) - CLI command wiring.

## Copilot Working Agreement

When implementing changes:
- Prefer small, package-local edits first.
- Respect safe edit zones and boundary rules in `.github/copilot-instructions.md`.
- Use the verification matrix there to choose exact build/test commands.
- When architecture changes, update docs in the same change:
  - `ARCHITECTURE.md`
  - `COPILOT-CONTEXT.md`
  - `.github/copilot-instructions.md`
  - affected package README files

## Upcoming Architecture Direction (Planned)

Next major design effort (to be planned in a dedicated chat):
- Make CLI behavior more "client character" oriented so UX can be changed quickly.
- Increase service abstraction in core/adapters to decouple command semantics from presentation/interaction style.

Guardrails for that upcoming design:
- Preserve CLI command compatibility unless intentionally versioned.
- Keep core reusable and UI-agnostic.
- Avoid coupling persona/character UX details directly into low-level domain services.
- Define explicit contracts for "interaction profile" vs. "business operation".

## Open Design Questions for Next Chat

- What is the abstraction boundary: command handlers vs. interaction orchestrator vs. presentation layer?
- Which parts become pluggable profiles (tone, flow, prompts, defaults) vs. fixed business commands?
- How to keep tests stable while allowing fast UX iteration?
- What migration path keeps existing `ait` commands working during refactor?
