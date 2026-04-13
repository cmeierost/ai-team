---
id: async-message-steering
type: feature
title: Asynchronous Message Steering and Queuing
status: todo
priority: high
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - web
  - core
  - service
createdAt: 2026-04-13T00:00:00.000Z
updatedAt: 2026-04-13T00:00:00.000Z
---

## Goal

Enhance the chat workflow to allow users to interact with the LLM while it is actively processing its reasoning and tool loops. This introduces four distinct asynchronous interaction modes:

- **Interrupt:** Stops the current generation/tool immediately.
- **Steer:** Drifts a prompt into the LLM context mid-loop without breaking the current tool execution.
- **Queue:** Waits until the LLM loop is naturally finished before triggering the next prompt.
- **Save for Later:** Saves the prompt as a Note attached to the session so it can be used later.

## Action Items

- [ ] **Protocol & Contract Updates**
  - [ ] Introduce new message intents (e.g., `interrupt`, `steer`, `queue`) into the WebSocket/HTTP protocol (`packages/core`, `packages/api-client-http`).
  - [ ] Reuse existing `Note` contracts for the "Save for later" feature.
- [ ] **Backend Steer & Interrupt Logic (`packages/service`)**
  - [ ] **Hard Interrupt:** Update `packages/service/src/orchestrator/tool-dispatch.ts` to pass the `AbortSignal` down to all tool executions so long-running tools successfully halt.
  - [ ] Add explicit `if (signal.aborted) break;` checks inside the main handoff and tool-processing loops in `packages/service/src/orchestrator/chat-orchestrator.ts`.
  - [ ] **Steer:** Expose a thread-safe array (e.g., `injectedContext`) on the active orchestrator session.
  - [ ] Handle `steer` events from the transport by pushing the message into `injectedContext`. Append these as new `User` messages just before the next internal LLM cycle in the loop.
- [ ] **Frontend Chat Controller Updates (`packages/web`)**
  - [ ] Add a `messageQueue: string[]` state hook in `useChatPanelController.ts`.
  - [ ] Implement a `useEffect` monitoring the `streaming` state to pop and automatically send queued messages when `streaming` becomes `false`.
  - [ ] Implement `steer(message)` function that dispatches the real-time payload without altering the frontend `streaming` state.
  - [ ] Implement `saveAsNote(text)` helper that calls the existing `POST /notes` API and clears the text input.
- [ ] **Frontend Chat UI (`packages/web`)**
  - [ ] When `streaming === true`, morph the chat input actions to present **Interrupt**, **Steer (Drift in)**, and **Queue for next turn**.
  - [ ] Add a persistent **Save as Note** button inside the chat input box.
- [ ] **Verification**
  - [ ] Verify Steer: Inject mid-loop and confirm it appears in the subsequent LLM context.
  - [ ] Verify Interrupt: Trigger while a long search runs; confirm the tool stops executing.
  - [ ] Verify Queue: Confirm UI visualizes queued messages and sends them automatically at the end of the current turn.
  - [ ] Verify Save for Later: Confirm it empties the input and creates a note in the session.
