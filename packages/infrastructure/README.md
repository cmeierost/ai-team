# @ai-team/infrastructure

Concrete runtime implementations and adapters for AI Team. This package supplies the “real world” services that `@ai-team/service` and `@ai-team/container` wire into the app.

## What it provides

- **Storage & repositories**: SQLite-backed persistence, sessions/messages/notes repositories, proposal store
- **Workspace/context adapters**: file tree services, permission checking, fs-context integration
- **LLM adapters**: provider testing, model discovery, tool-call parsing helpers
- **IDE/code-edit adapters**: code edit manager, TypeScript analyzer, IDE adapter factory
- **Platform services**: system info, developer identity, attachment readers

## Boundaries

- Implementation-only: contracts live in `@ai-team/core`
- Wired through `@ai-team/container` and `@ai-team/service`
- Avoids UI or transport-specific concerns

## Development

```bash
pnpm --filter @ai-team/infrastructure build
pnpm --filter @ai-team/infrastructure test
```
