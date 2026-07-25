# Architecture Implementation Entry Points (Deep Reference)

Use this only when the task needs code-level navigation across runtime layers.

## Service/runtime

| What                                                                                     | Where                                                                                                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Mediator command payload/response/event contracts                                        | `packages/service/src/contracts.ts`                                                                                               |
| Service command dispatch, `invoke()`, `stream()`, and runtime event bridging             | `packages/service/src/index.ts`                                                                                                   |
| Thin chat bootstrap: env checks, agent resolution, session selection, orchestrator setup | `packages/service/src/commands/chat/chat.command.ts`                                                                              |
| Chat turn controller: slash commands, NL forwarding, handoffs, turn loop                 | `packages/service/src/orchestrator/chat-orchestrator.ts`                                                                          |
| Single-turn LLM pipeline: context build, tool dispatch, handoff/hire detection           | `packages/service/src/orchestrator/send-turn.ts`                                                                                  |
| Handoff protocol and context mutation                                                    | `packages/service/src/orchestrator/handoff.ts`                                                                                    |
| Pipeline extension interfaces                                                            | `packages/service/src/orchestrator/pipeline.ts`                                                                                   |
| Durable workflow run persistence + active-interaction routing                            | `packages/service/src/workflow/workflow-actor-host.ts`, `packages/service/src/workflow/workflow-interaction-router.ts`           |
| Workflow engine and command/tool execution runtime                                       | `packages/service/src/workflow/xstate-workflow-runner.ts`                                                                         |
| Workflow parameter interpolation / conditions / result projection                        | `packages/service/src/workflow/workflow-param-resolver.ts`                                                                        |
| Unified command dispatch and parameter completion                                        | `packages/service/src/command-dispatcher/command-dispatcher.ts`, `command-adapters.ts`, `command-parameter-completion-service.ts` |
| Command registry and canonical `group_key` tool identities                               | `packages/service/src/command-dispatcher/command-registry.ts`                                                                     |
| Agent tool parameter binding, validation, and authorization                              | `packages/service/src/tooling/manager/tool-manager.ts`                                                                            |
| Onboarding command entry point                                                           | `packages/service/src/commands/hr/onboard.ts`                                                                                     |
| Onboarding workflow definition                                                           | `packages/service/src/commands/hr/onboarding-workflow.ts`                                                                         |
| Hire sub-workflow definition                                                             | `packages/service/src/commands/hr/hire-workflow.ts`                                                                               |
| Session lifecycle and persisted chat behavior                                            | `packages/service/src/sessions/session-manager.ts`                                                                                |
| Task lifecycle and task-oriented state                                                   | `packages/service/src/tasks/task-manager.ts`                                                                                      |

## API/adapter/runtime edges

| What                                                              | Where                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Service interface contracts and wire protocol types               | `packages/api-contracts/src/index.ts`                                                                      |
| API server transport assembly                                     | `packages/api-server/src/server.ts`                                                                        |
| API server HTTP routes                                            | `packages/api-server/src/routes/`                                                                          |
| API server WebSocket chat bridge                                  | `packages/api-server/src/ws/chat-handler.ts`                                                               |
| Request-scoped stream correlation and event translation           | `packages/service/src/interaction/interaction-stream.ts`, `packages/service/src/interaction/emit-service.ts` |
| FS context permission runtime (`ContextRuntime`, parser, matcher) | `fs-context/`                                                                                              |
| Core tools and question primitives                                | `packages/core/src/tools/index.ts`                                                                         |
| Context manager (Agent API adapter over `ContextRuntime`)         | `packages/core/src/context/index.ts`                                                                       |
| DI container primitives and bootstrap helpers                     | `packages/container/src/`                                                                                  |
| Model-facing command metadata                                     | `packages/core/src/command-catalog/index.ts`                                                               |
| IDE bridge contracts and discovery file                           | `packages/ide-interface/src/index.ts`                                                                      |
| VS Code extension activation and IDE-local server                 | `packages/vscode/src/extension.ts`, `packages/vscode/src/ide-local-server.ts`                              |
| Web frontend bootstrap and routing                                | `packages/web/src/main.tsx`, `packages/web/src/App.tsx`                                                    |
| Current web chat/runtime hotspot                                  | `packages/web/src/components/ChatPanel.tsx`                                                                |
