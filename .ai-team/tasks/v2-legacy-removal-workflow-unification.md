---
id: v2-legacy-removal-workflow-unification
type: feature
title: Remove v1 chat/workflow legacy and unify on workflow-v2
status: in_progress
priority: urgent
assignedTo: alex-morgan
createdBy: agent
createdByType: agent
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - backend
  - service
  - cli
  - api-server
  - architecture
createdAt: 2026-07-12T22:02:00.000Z
updatedAt: 2026-07-12T22:23:00.000Z
---

## Goal

Converge all chat/workflow runtime behavior on workflow-v2 so CLI, WebSocket, and API-server share one orchestration model and differ only by DI container setup and transport rendering.

## Action Items

- [x] Remove CLI default use of the legacy `chat-chat` alias and make `chat` canonical in CLI render path and tests.
- [ ] Remove remaining `chat-chat` alias usage from CLI registry/metadata and callers.
- [ ] Introduce a single service-layer interaction command for v2 chat streaming so `chat-v2` can flow through `InteractionService` like `chat`.
- [ ] Replace `ChatRuntimeV2CliAdapter -> ChatCommand.executeRuntime` bridge with workflow-v2-native step orchestration.
- [ ] Extract reusable workflow-v2 chat step services (preturn, send-turn, tool-round, post-turn, handoff) and wire via DI.
- [ ] Route WebSocket chat and REST chat posting through the same interaction command path with no behavior forks.
- [ ] Remove v1-only chat orchestration entrypoints after parity tests pass.
- [ ] Delete compatibility exports/modules marked legacy once no references remain.
- [ ] Add/expand parity tests to lock behavior (handoff, slash commands, tool loops, questions) before deletions.
- [ ] Run duplication scan on affected scope and resolve hotspots.
- [x] Delete legacy orchestrator `send-turn.ts` compatibility wrapper and obsolete tests after send-turn-machine parity validation.
- [x] Delete dead orchestrator slash surfaces (`slash-command-dispatcher.ts`, `workflow-slash.command.ts`) and stale export from `service/index.ts`.
