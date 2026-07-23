---
id: repair-chat-handoff-session-switching
type: bug
title: Repair chat handoff session and agent switching
status: todo
priority: high
assignedTo: alex-morgan
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - chat
  - handoff
  - sessions
  - workflow
  - cli
  - web
createdAt: 2026-07-23T13:52:59.8550948+02:00
updatedAt: 2026-07-23T14:02:30.3552020+02:00
---

## Goal

Repair ai-team's handoff lifecycle so that handing a conversation from one
agent to another reliably moves subsequent turns into the target agent's linked
session and personality context.

Observed reproduction: after a handoff from Emily Davis to Sarah Lee, the TUI
rendered the response header as `Sarah Lee → Clemens Meier`, but the response
content said, `You're still speaking with me, Emily Davis, your HR Director!`.
This indicates that the projected identity and the runtime agent/session context
can diverge.

Confirmed related defect: after the TUI projected a Michael Brown to Emily Davis
handoff, it continued building later turn requests from the immutable startup
payload. Those turns were therefore persisted in Michael's source session even
while the footer and message styling showed Emily. The CLI projection has been
corrected and regression-tested; the remaining action items cover the deeper
service handoff lifecycle.

The investigation must treat ai-team's session-thread mechanism as authoritative:
the source agent session is linked to the target agent session through the
persisted handoff relationship. Agent contexts remain private, and only the
handoff briefing is shared. The XState workflow engine and service layer own the
transition; CLI and Web only project emitted state.

## Action Items

- [ ] Reproduce an Emily Davis to Sarah Lee handoff and record the active agent ID, source session ID, target session ID, execution context, emitted events, and persisted messages before and after the transition.
- [ ] Determine whether the defect occurs in slash-command execution, structured handoff-result parsing, XState transition application, runtime context mutation, session persistence, or a later chat-turn bootstrap.
- [ ] Verify that a successful handoff updates `ctx.agent`, `ctx.sessionId`, and `ctx.history` together before the next model invocation.
- [ ] Verify that the next user message is appended to the target agent's linked session and that the target model receives only that agent session's history plus the persisted handoff briefing.
- [ ] Verify that `previousSessionId`, `handoffFromSessionId`, `handoffToSessionId`, and `handoffId` consistently describe the source-to-target session relationship without duplicate or orphaned transitions.
- [ ] Check whether `/handoff`, model-initiated handoff tools, and workflow-initiated handoffs use one authoritative transition path or can apply conflicting/double context mutations.
- [ ] Ensure `agent_info`, `handoff`, `session_switched`, and subworkflow events reflect the same authoritative target agent and session rather than allowing the TUI footer/header to advance independently.
- [ ] Ensure returning to a previously linked agent resolves that agent's existing session in the thread instead of creating an unrelated session or retaining the previous agent's runtime context.
- [ ] Add regression tests proving that the first response after a handoff is generated with the target agent personality, model configuration, private history, and target session ID.
- [ ] Add multi-hop regression coverage such as Michael Brown to Emily Davis to Sarah Lee and back to Emily Davis.
- [ ] Verify identical service behavior through CLI and API-server/Web projections without adding handoff semantics to either UI adapter.
- [ ] Keep core contract changes minimal and preserve the class-based dependency-injection and XState workflow architecture.
