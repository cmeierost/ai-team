# @ai-team/cli

Command-line interface for AI Team. Entry points: `ait` and `ai-team`.

## Architecture contract — read before editing

**The CLI is a thin adapter. Keep it that way.**

This package is responsible for exactly two things:

1. **Parsing user input** — flags, prompts, and arguments
2. **Formatting output** — console output, tables, spinners, and styling

Everything else belongs in `@ai-team/service` or `@ai-team/core`.

## What goes where

| Concern                       | Package                               |
| ----------------------------- | ------------------------------------- |
| Argument parsing, prompts     | `@ai-team/cli`                        |
| Console output                | `@ai-team/cli`                        |
| Business logic, orchestration | `@ai-team/service`                    |
| File I/O and storage          | `@ai-team/service` or `@ai-team/core` |
| Validation, domain errors     | `@ai-team/service` or `@ai-team/core` |

## Rules for CLI command files (`src/commands/*.ts`)

- **Import only from `@ai-team/service`** for business logic (types from `@ai-team/core` are OK).
- **No file I/O** in CLI commands.
- **No config access** in CLI commands.
- **No domain logic** in CLI commands.
- Keep each command function ≤ 50 lines.

## Adding a new command

1. Implement the logic in `packages/service/src/commands/<name>.ts`.
2. Export it from `packages/service/src/index.ts`.
3. Add a thin adapter in `packages/cli/src/commands/<name>.ts`.
4. Wire it into `packages/cli/src/cli.ts`.

## Development

```bash
pnpm --filter @ai-team/cli build
pnpm --filter @ai-team/cli test
```

## Chat TUI projection

The full-screen chat is a projection of shared runtime events:

- `ChatViewport` owns the chronological, scrollable transcript.
- `ChatLayout` owns the fixed composer/footer and temporarily replaces the
  composer through a focus-aware component slot.
- Tool renderers receive normalized lifecycle events and return explicit
  `transcript` or `composer` placements. Exact tool names take precedence over
  wildcard renderers.
- Slash invocations remain developer messages; `slash:*` results and completed
  `com_ask` calls are standalone non-speech transcript components.
- The CLI question service attaches a native presenter while chat is active and
  falls back to Inquirer elsewhere.
- Chat startup sends agent/session/new intent to the service. The CLI must not
  traverse thread state or select the active session itself.
- Workflow lifecycle events (`workflow_started`, `workflow_state`,
  `workflow_completed`, `workflow_failed`, `workflow_cancelled`,
  `workflow_restored`) are rendered as presentation signals only; the CLI must
  never choose workflow transitions.

Do not move these UI concepts into `@ai-team/core` or add a separate command,
tool, or workflow execution path for the TUI.

## Project structure

```
src/
  cli.ts       # command registration only
  index.ts     # package entry point
  commands/    # thin adapters
  utils/       # CLI-only helpers
```
