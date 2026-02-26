# AI Team - Copilot Context

## Current Snapshot (Feb 26, 2026)

Monorepo packages currently present:
- `packages/core` - business logic, managers/services, file-backed state.
- `packages/service` - command mediator/service orchestration over core.
- `packages/api-client` - typed client facade consumed by adapters.
- `packages/cli` - command adapter and operational workflows.
- `packages/vscode` - extension adapter (views/panels over core logic).
- `packages/web` - React UI for graph/chat/team visualization.

No standalone HTTP/API server package is present in this workspace snapshot.

## What This Project Is

AI Team is a toolset for running a virtual software organization with explicit context boundaries.

- Agents are represented as files under `.ai-team/`.
- Teams, skills, and role behavior are modeled in core.
- CLI and VS Code provide orchestration surfaces.
- Web provides visualization and interaction UX.

## Architecture Model (Current)

Layered adapter-to-core architecture with file-backed runtime state:

`CLI / VS Code / Web -> @ai-team/api-client -> @ai-team/service -> @ai-team/core -> .ai-team/* (+ provider APIs)`

Core invariants:
- `@ai-team/core` stays UI-free (no `vscode`, `react`, `react-dom`, `electron`).
- Runtime state conventions remain centralized under `.ai-team/`.
- Permission/context checks are enforced before file/tool operations.
- Adapters orchestrate UX; service/api-client provide typed command boundaries; core owns reusable business logic.

## Runtime Artifacts

- `.ai-team/config.json` - non-secret provider/model/config state.
- `.ai-team/.env` - secrets.
- `.ai-team/agents/*.md` - agent definitions (frontmatter + markdown).
- `.ai-team/private/chats/*.jsonl` - private chat logs.

## Where to Read First

- [ARCHITECTURE.md](ARCHITECTURE.md) - detailed system design and constraints.
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - operational coding rules for agents.
- [docs/architecture/overview.md](docs/architecture/overview.md) - concise architecture summary.
- [docs/architecture/diagrams.md](docs/architecture/diagrams.md) - context/container visual maps.
- [docs/api/contracts.md](docs/api/contracts.md) - interface/compatibility contracts.
- [packages/core/README.md](packages/core/README.md), [packages/vscode/README.md](packages/vscode/README.md), [packages/web/README.md](packages/web/README.md).

## Implementation Hotspots (Copilot)

- [packages/service/src/contracts.ts](packages/service/src/contracts.ts) - mediator request/event and command type contracts.
- [packages/service/src/index.ts](packages/service/src/index.ts) - command dispatch and mediator runtime wiring.
- [packages/service/src/commands/chat.ts](packages/service/src/commands/chat.ts) - orchestration rules, tool-calling loop, handoff/hire directives.
- [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts) - question/workflow continuation persistence.
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
