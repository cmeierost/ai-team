---
id: init-command-interaction-model
type: feature
title: 'Init command: system-chat interaction model + slash command loops'
status: in_progress
priority: high
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - backend
  - architecture
  - init
  - interaction-model
  - slash-commands
createdAt: 2026-04-12T22:40:00.000Z
updatedAt: 2026-04-12T22:40:00.000Z
---

## Goal

Rebuild the init command (and all command interactions) around a unified **system-chat
interaction model** where every command — setup, onboard, hire, fire, create — is a
**system chat loop** that emits events through the interaction stream, not a special
code path.

The UI (CLI or web) sees the same protocol regardless of whether the conversation
partner is an LLM agent or the system itself. Slash commands participate in this
model and can implement their own interaction loops — including when called by an
agent, saving unnecessary LLM roundtrips.

### Architecture truth

```
┌──────────────────────────────────────────────────────────┐
│                  Interaction Stream                       │
│  (universal protocol: tokens, questions, logs, events)   │
├──────────────┬─────────────────┬─────────────────────────┤
│ System loop  │  Agent loop     │  Slash command loop      │
│ (no LLM)     │  (LLM-backed)   │  (own loop, no LLM)     │
│              │                 │  ┌─────────────────┐     │
│  setup       │  chat           │  │ /hire            │     │
│  onboard     │  plan           │  │ /fire            │     │
│  configure   │  ask            │  │ /create          │     │
│              │  implement      │  │ /init            │     │
│              │                 │  │ /setup (re-enter)│     │
│              │                 │  └─────────────────┘     │
└──────────────┴─────────────────┴─────────────────────────┘
```

**Key principle:** CLI handlers (`packages/cli/src/handlers/`) are stream event
renderers, not command implementations. They receive events from the business layer
and translate them to terminal output. The business logic lives entirely in
`packages/service`.

### What this changes about the init flow

1. **`setup`** is a system chat loop: system asks questions (provider, model, key),
   user answers, system configures. No LLM. No agents.
2. **`onboard`** starts as a system loop (create bootstrap files, pick names) then
   transitions to an LLM agent loop (CEO business definition chat, HR hiring chat).
3. **`init`** = `setup` → `onboard` = backward-compatible CLI convenience command.
- [ ] The CLI handler for init just does `runCommandStream(client, { command: 'init' })`
   — same as hire, fire, chat, everything.
- [ ] The web client can call `setup` or `onboard` independently via WebSocket.

### What this changes about slash commands

Current slash commands call service-layer functions directly but have no interactive
loop capability — `/hire` calls `hireCommand()` which throws if name/role missing.

New model:

- [ ] Slash commands can implement **their own question loop** via the `OrchestratorContext`
  hooks (`questionInput`, `questionConfirm`, `questionSelect`).
- [ ] When an LLM agent invokes `/hire`, the slash command runs its interactive flow
  (ask name, role, confirm) directly — no LLM roundtrip for each question.
- [ ] A slash command can optionally delegate to an agent via `/chat <agent>` if it
  needs LLM help.

## Current State (Phase 1 partially done)

Contract types updated: `setup`, `onboard`, `systemStatus` added to `AiTeamCommandName`,
payload/response maps, and new interfaces (`SetupOptions`, `OnboardOptions`, `SystemStatus`).

New files created:

- `packages/service/src/commands/setup.ts` — LLM configuration loop
- `packages/service/src/commands/onboard.ts` — delegates to `runOnboarding`
- `packages/service/src/commands/system-status.ts` — initialization status check

`initCommand` thinned to: clear dir → `setupCommand()` → `onboardCommand()`.

CommandDispatcher updated with all three new registrations.

**2 test failures remaining** in `init.test.ts` (confirm message wording, Welcome
message ordering). These need fixing before proceeding.

## Action Items

### Phase 0: Stabilize current init split

- [x] Add `setup` / `onboard` / `systemStatus` to contract types
- [x] Create `setupCommand` in `packages/service/src/commands/setup.ts`
- [x] Create `onboardCommand` in `packages/service/src/commands/onboard.ts`
- [x] Create `getSystemStatusAsync` in `packages/service/src/commands/system-status.ts`
- [x] Thin `initCommand` to delegate to setup → onboard
- [x] Register all three in `CommandDispatcher`
- [ ] Fix 2 remaining test failures in `init.test.ts`
- [ ] Remove dead code from `init.ts` (unused helpers that moved to `setup.ts`)
- [ ] Verify full build: `pnpm -r build` + `pnpm --filter @ai-team/service test`

### Phase 1: System-chat interaction model

- [ ] Define `SystemChatParticipant` concept — a non-LLM participant that drives the question loop
- [ ] Ensure `setupCommand` uses the question protocol properly (all questions flow through `InteractionContext` callbacks, not raw inquirer)
- [ ] Ensure `onboardCommand`'s pre-LLM section (bootstrap files, name picking) uses the same protocol
- [ ] Verify that both CLI and WebSocket can drive `setup` end-to-end through the existing question/answer round-trip
- [ ] Add integration test: `setup` command streams questions, receives answers, saves config

### Phase 2: Slash commands with own interaction loops

- [ ] Extend `ISlashCommand.execute` signature to receive question callbacks (or ensure `OrchestratorContext.hooks` exposes them)
- [ ] Refactor `/hire` slash command to run its own interactive loop: ask name → ask role → confirm → call `hireCommand` → offer avatar
- [ ] Refactor `/fire` slash command to confirm before deleting
- [ ] Refactor `/create` to ask type, name, etc. interactively
- [ ] Ensure LLM-callable slash commands (`llmCallable: true`) work when the agent invokes them — the loop runs, questions go to the human, agent continues after
- [ ] Remove the hardcoded slash command parser from `onboardingChat` — use the standard slash command registry instead

### Phase 3: CLI handler cleanup

- [ ] Rename `hireCommand` → `hireHandler` in `packages/cli/src/handlers/hire.ts`
- [ ] Move avatar selection logic from CLI handler into the `/hire` slash command or the `hireCommand` service function (questions via interaction stream)
- [ ] Ensure every CLI handler is just `runCommandStream(client, { command, payload })` + optional post-stream CLI-only behavior
- [ ] Add `ait setup` and `ait onboard` CLI subcommands that call their respective commands
- [ ] Update `ait init` handler to just forward to `init` command (same as hire, chat, etc.)

### Phase 4: System status endpoint + web setup wizard

- [ ] Add `GET /api/system/status` route in `packages/api-server`
- [ ] Create `useSystemStatus()` TanStack Query hook in `packages/web`
- [ ] Create `SetupWizard` component that streams `setup` command via WebSocket question protocol
- [ ] Update `App.tsx` routing: if `!hasLlmConfig` → wizard → if `!hasAgents` → onboarding → normal app
- [ ] Verify WebSocket can drive `setup` + `onboard` end-to-end

### Phase 5: Auto-start web UI in dev mode

- [ ] After server startup, detect dev mode and spawn `pnpm --filter @ai-team/web dev`
- [ ] In prod mode, serve static `packages/web/dist/` or open browser
- [ ] Handle port conflicts and spawn failures gracefully

### Phase 6: Unify onboarding chat with orchestrator

- [ ] Replace the standalone `onboardingChat` loop in `init.ts` with the standard `ChatOrchestrator` pipeline
- [ ] CEO business definition chat → normal orchestrator session with the CEO agent
- [ ] HR hiring chat → normal orchestrator session with the HR agent
- [ ] Slash commands (`/list`, `/done`, `/hire`) available in onboarding via the standard registry
- [ ] Remove the bespoke `onboardingChat`, `parseHireDirectives`, etc. from `init.ts`

## Future direction: specialized chat loops

Each is a separate command (own entry point), not a mode switch within a session:

| Loop          | Participant    | Tool restrictions                  |
| ------------- | -------------- | ---------------------------------- |
| **setup**     | System         | Config tools only, no code editing |
| **onboard**   | System → Agent | Agent tools, no code editing       |
| **chat**      | Agent          | Full tool set                      |
| **plan**      | Agent          | Read-only code tools, no writes    |
| **ask**       | Agent          | Read-only, search, web fetch       |
| **implement** | Agent          | Full tool set (edit, terminal)     |

- `CommandDispatcher.availableIn` already exists — extend with per-loop tool allow-lists
- [ ] Each registers as its own `AiTeamCommandName`
- [ ] Chat handler resolves tool set from command type at stream start

## Relevant files

- `packages/service/src/commands/setup.ts` — system chat loop for LLM config
- `packages/service/src/commands/onboard.ts` — system → agent transition
- `packages/service/src/commands/init.ts` — orchestrator (setup → onboard)
- `packages/service/src/commands/system-status.ts` — initialization check
- `packages/service/src/command-dispatcher.ts` — command registrations
- `packages/service/src/orchestrator/slash-commands.ts` — slash command implementations
- `packages/service/src/orchestrator/pipeline.ts` — `ISlashCommand` interface
- `packages/service/src/interaction-stream.ts` — universal streaming engine
- `packages/api-client/src/contract/routers/streaming.ts` — contract types
- `packages/cli/src/handlers/` — CLI stream event renderers
- `packages/cli/src/handlers/stream-runner.ts` — generic CLI stream consumer
- `packages/api-server/src/ws/chat-handler.ts` — WebSocket bridge
- `packages/web/src/App.tsx` — web entry point for setup wizard routing

## Verification criteria

1. `ait setup` configures LLM via question protocol (same protocol for CLI and web)
2. `ait onboard` creates team, transitions to agent chat
3. `ait init` = setup → onboard, backward compatible
4. `/hire` inside a chat session runs its own interactive loop (no extra LLM calls)
- [ ] Web setup wizard drives `setup` via WebSocket, shows questions inline
6. `GET /api/system/status` returns correct initialization state
- [ ] All existing tests pass + new coverage for setup/onboard/systemStatus
- [ ] No business logic in CLI handlers — only stream event rendering
