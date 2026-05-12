# AI Team

TypeScript monorepo for operating a virtual software organization across CLI, VS Code, and Web adapters.

## Start Here for Feature Work

Use this path when implementing or modifying behavior:

1. Read architecture intent: [ARCHITECTURE.md](ARCHITECTURE.md)
2. Confirm current agent guidance: [COPILOT-CONTEXT.md](COPILOT-CONTEXT.md)
3. Check contracts and compatibility: [docs/api/contracts.md](docs/api/contracts.md)
4. Use architecture summary + diagrams:
   - [docs/architecture/overview.md](docs/architecture/overview.md)
   - [docs/architecture/diagrams.md](docs/architecture/diagrams.md)

## Implementation Entry Points

- Service contracts and mediator types: [packages/service/src/contracts.ts](packages/service/src/contracts.ts)
- Service command dispatch/runtime wiring: [packages/service/src/index.ts](packages/service/src/index.ts)
- Chat orchestration rules (tool-calling, handoff/hire, question flow): [packages/service/src/commands/chat.ts](packages/service/src/commands/chat.ts)
- Workflow continuation persistence: [packages/service/src/workflow-state.ts](packages/service/src/workflow-state.ts)
- Tool registry and question tools: [packages/core/src/tools/index.ts](packages/core/src/tools/index.ts)
- Command metadata catalog: [packages/core/src/command-catalog/index.ts](packages/core/src/command-catalog/index.ts)
- Service contracts and wire protocol: [packages/api-contracts/src/index.ts](packages/api-contracts/src/index.ts)
- CLI command wiring: [packages/cli/src/cli.ts](packages/cli/src/cli.ts)

## Package Docs

- Core: [packages/core/README.md](packages/core/README.md)
- API Server: [packages/api-server/README.md](packages/api-server/README.md) - REST API with Swagger UI docs
- VS Code adapter: [packages/vscode/README.md](packages/vscode/README.md)
- Web adapter: [packages/web/README.md](packages/web/README.md)

## Feature Documentation

- [Chat Context Management](docs/chat-context-management.md) - Edit, delete, archive messages and manage LLM context
- [Web UI Development](docs/web-ui-development.md) - Frontend development workflow

## Dynamic Slash Catalog Globs

Dynamic slash discovery supports configurable glob patterns for prompts, skills, and JSON workflows.

Defaults:

- `promptGlobs`: `.ai-team/prompts/**/*.prompt.md`, `.github/prompts/**/*.prompt.md`
- `skillGlobs`: `.ai-team/skills/**/SKILL.md`, `.github/skills/**/SKILL.md`
- `workflowGlobs`: `.ai-team/workflows/**/*.json`

These can be set in either `.ai-team/config.json` (team-wide) or `.ai-team/config.user.json` (user override):

```json
{
   "dynamicSlashCatalog": {
      "promptGlobs": [".custom/prompts/**/*.prompt.md"],
      "skillGlobs": [".custom/skills/**/SKILL.md"],
      "workflowGlobs": [".custom/workflows/**/*.json"]
   }
}
```

## Build and Test

- Install: `pnpm install`
- Build all: `pnpm -r build`
- Test all: `pnpm -r test`

For package-specific verification and guardrails, follow [.github/copilot-instructions.md](.github/copilot-instructions.md).
