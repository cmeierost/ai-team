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
- API client facade and local wiring: [packages/api-client/src/index.ts](packages/api-client/src/index.ts)
- CLI command wiring: [packages/cli/src/cli.ts](packages/cli/src/cli.ts)

## Package Docs

- Core: [packages/core/README.md](packages/core/README.md)
- VS Code adapter: [packages/vscode/README.md](packages/vscode/README.md)
- Web adapter: [packages/web/README.md](packages/web/README.md)

## Feature Documentation

- [Chat Context Management](docs/chat-context-management.md) - Edit, delete, archive messages and manage LLM context
- [Web UI Development](docs/web-ui-development.md) - Frontend development workflow

## Build and Test

- Install: `pnpm install`
- Build all: `pnpm -r build`
- Test all: `pnpm -r test`

For package-specific verification and guardrails, follow [.github/copilot-instructions.md](.github/copilot-instructions.md).
