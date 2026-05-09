---
name: mediated-chat-runtime-store
description: 'Use when handling mediated WebSocket chat events, token streaming, handoffs, tool events, or workflow questions in `packages/web` while keeping chat views dumb and state logic unit tested.'
---

# Mediated Chat Runtime Store

Use this skill when chat state is driven by mediator events rather than simple request/response fetching.

This includes:

- applying WebSocket chat events to runtime state
- modeling token streaming in the browser
- handling pending question workflows
- tracking tool activity and handoff transitions
- keeping protocol handling out of presentational chat components
- shaping unit-testable reducers, selectors, and runtime actions

## Read These Sources First

1. `ARCHITECTURE.md`
2. `COPILOT-CONTEXT.md`
3. `packages/service/src/contracts.ts`
4. `packages/api-server/src/server.ts`
5. `packages/api-server/src/index.ts`
6. `packages/web/src/components/ChatPanel.tsx`
7. `.ai-team/instructions/frontend-state-architecture.instructions.md`
8. `.ai-team/skills/agent-runtime-behavior/SKILL.md`
9. `.ai-team/skills/service-orchestration-runtime/SKILL.md`
10. `.ai-team/skills/zustand-presenter-split/SKILL.md`

## Workflow

### 1. Treat chat as a runtime event pipeline

Classify incoming chat flow as mediated runtime events, not as plain fetched records.

Typical events include:

- `status`
- `token`
- `tool`
- `question`
- `handoff`
- `done`
- `error`

### 2. Keep transport out of the view

Do not let presentational chat components own:

- WebSocket lifecycle
- raw mediator event parsing
- token accumulation
- cancel payload logic
- question-answer wiring
- handoff session transition logic

Keep those concerns in controller hooks and runtime stores.

### 3. Separate persisted session state from live runtime state

Use Query or snapshot loading for persisted session data.
Use Zustand or a small runtime state machine for the active stream.

A good split is:

- persisted session snapshot
- active runtime stream state
- pure event-application helpers
- selectors that produce view-friendly chat props

### 4. Prefer pure event appliers

Whenever practical, model the runtime update path with pure helpers such as:

- `applyMediatorEvent(state, event)`
- `appendToken(state, text)`
- `startPendingQuestion(state, question)`
- `transitionHandoff(state, event)`

This makes chat runtime logic far easier to unit test.

### 5. Test the transitions directly

Unit test at least:

- token accumulation
- tool event timeline updates
- question open/answer/reset transitions
- handoff state transitions
- interrupt/cancel behavior
- done/error finalization
- reset when switching session or agent

## Working Rules

- do not flatten all chat behavior into one TSX file if pure state helpers can own it
- do not hide protocol decisions inside JSX branches
- do not use Zustand as a raw socket holder unless there is a very strong reason
- prefer selectors that expose a stable chat view model to the component layer
- keep the view unaware of mediator protocol details when practical

## Successful Outcome

- chat runtime behavior is easier to reason about
- WebSocket protocol handling is isolated from rendering
- state transitions are directly unit tested
- chat views stay dumb enough to preview in Storybook with fixtures
