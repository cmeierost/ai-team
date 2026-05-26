# @ai-team/core

UI-free domain library for AI Team. This package owns the shared contracts, schemas, and workspace-backed behavior that every adapter relies on.

## Responsibilities

- Agent, team, and skill domain operations
- Context permissions and workspace rules (backed by `fs-context`)
- Tool metadata, question primitives, and command catalog metadata
- Zod-backed schema validation and JSON schema conversion
- File-backed runtime model under `.ai-team/`

## Boundaries

- **No UI dependencies** (VS Code, React, Electron, etc.)
- **No transport concerns** (HTTP, WebSocket, CLI rendering)
- **Pure logic** that is testable without an IDE or UI

## Where it fits

`@ai-team/core` sits underneath `@ai-team/service` and is shared by CLI, web, API server, and VS Code adapters. See `ARCHITECTURE.md` for the full dependency model.

## Development

```bash
pnpm --filter @ai-team/core build
pnpm --filter @ai-team/core test
```
