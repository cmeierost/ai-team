---
id: shared-session-and-agent-invites
type: feature
title: Shared Session and Agent Invites
status: todo
priority: high
createdBy: human
createdByType: human
requiresApproval: false
subPlanIds: []
estimatedHours: null
deadline: null
tags:
  - backend
  - orchestrator
  - ui
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
assignedTo: maya-patel

------

## Goal

Enable multiple agents to collaborate within a single session via a `/invite` command and an explicit human-approved `invite_agent` tool. Legacy handoffs remain the default for context-isolated transfers. Within a shared session, agents can autonomously converse with each other by routing their responses to specific agents, up to a bounded `maxHops` limit.

## Action Items

- [ ] Add a `/invite <agentId>` slash command in `packages/service/src/orchestrator/slash-commands.ts`.
- [ ] Update the `SessionManager`'s session update flow to ensure the new agent is appended to `ChatSession.agentIds` in the SQLite database without removing the existing agent.
- [ ] Emit a system/chat event to the session noting that `[Agent Name] has joined the session`.
- [ ] Create a new orchestration tool `invite_agent` in `packages/service/src/tools/orchestration-tools.ts`.
- [ ] Implement the `invite_agent` tool's execution to trigger a `QuestionConfirmRequest` via `requestConfirm` in `packages/service/src/orchestrator/question-io.ts`.
- [ ] Modify `ChatOrchestrator` in `packages/service/src/orchestrator/chat-orchestrator.ts` to support intra-session routing (if `session.agentIds.length > 1`, allow agents to explicitly define a `targetAgentId` for the next turn).
- [ ] When a `targetAgentId` is set in a shared session, loop the `sendTurn` call to the target agent automatically instead of returning control to the human, continuing until `targetAgentId` is null/empty or `maxHops` is reached.
- [ ] Update agent system prompts (`packages/core/src/llm/system-prompt.ts` or similar) to inform them of the `<other_agents_in_session>` and instruct them on how to yield to a specific agent vs. the human.
- [ ] Add an "Invite" action (e.g., a button or dropdown list of available team members) in the session header or toolbar in `packages/web/src/components/chat-panel/ChatPanelView.tsx`.
- [ ] Wire the UI button to dispatch the string `/invite <agentId>` to the chat input controller.
- [ ] Validate that the UI accurately displays varying avatars when different agents respond sequentially in `packages/web/src/components/chat-panel/ChatMessagesView.tsx`.
- [ ] Verify that a standard `/handoff` still safely provisions a fresh session separate from the shared session path.
