---
id: structured-workflow-error-messaging
type: bug
title: Preserve and render structured workflow errors
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
  - workflow
  - error-handling
  - tui
  - ui-messaging
createdAt: 2026-07-23T21:46:48.1611975+02:00
updatedAt: 2026-07-23T21:46:48.1611975+02:00
---

## Goal

Preserve errors caught by XState and deliver them to every attached UI through typed runtime messaging. Present failures as detailed, standalone error components instead of reducing them to generic log lines such as `[ERROR] Workflow aborted`. In the CLI TUI, use a red-bordered component that participates normally in transcript scrolling.

## Action Items

- [ ] Trace every XState workflow failure path and identify where the original error, cause, workflow ID, step ID, command or tool call ID, and phase are currently retained or discarded.
- [ ] Define a UI-neutral structured runtime error message in the appropriate service or transport contract, without introducing presentation concepts into `@ai-team/core`.
- [ ] Normalize unknown thrown values into a safe error payload while preserving useful messages, typed error codes, causes, and diagnostic metadata.
- [ ] Emit the structured error message for caught workflow failures to all attached UI notifiers before returning the terminal workflow outcome.
- [ ] Ensure CLI, VS Code, Web, and other consumers can receive the same error payload and choose their own presentation.
- [ ] Add a standalone red-bordered CLI TUI error component with a concise summary and expandable or clearly separated technical details, safe wrapping, resizing, transcript scrolling, and copy selection.
- [ ] Prevent duplicate presentation when the same failure is visible as a tool or slash-command error and as a workflow-level failure.
- [ ] Define redaction rules so stack traces and diagnostic details are useful locally without exposing secrets or unsafe internal values.
- [ ] Cover live failures, nested workflow failures, command and tool failures, cancellation versus failure, historical replay where applicable, and malformed non-`Error` throws with focused tests.
- [ ] Verify the affected service and UI packages with targeted tests, builds, lint, whitespace checks, and an interactive PowerShell terminal run.
