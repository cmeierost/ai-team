---
id: unified-tui-placement
type: feature
title: Unify TUI placement for tools, questions, and slash commands
status: in_progress
priority: high
assignedTo: alex-morgan
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - cli
  - tui
  - tools
  - questions
createdAt: 2026-07-23T19:47:56.5852981+02:00
updatedAt: 2026-07-23T20:37:00.0000000+02:00
---

## Goal

Create one phase-aware CLI rendering pipeline for tools and `slash:*` calls.
Renderers choose explicit transcript or composer placement, while the chat
layout owns scrolling and fixed composer placement. Runtime questions replace
the composer temporarily, and completed `com_ask` and slash calls render as
standalone, non-speech transcript components. This follow-up explicitly
supersedes the earlier CLI TUI repair rule that attached slash results to
`UserMessage`.

Keep `IQuestionService`, core UI boundaries, Web behavior, and persisted formats
unchanged.

## Action Items

- [x] Add a reusable focus-aware component slot with nested push/pop restoration.
- [x] Generalize the CLI tool-renderer contract to normalized phase-aware events and explicit target placements.
- [x] Prefer exact tool renderers over wildcard registrations and retain generic fallback rendering.
- [x] Route live and historical slash results through a default `slash:*` renderer as standalone transcript entries.
- [x] Preserve slash invocation metadata as the live tool request so live and resumed rendering match.
- [x] Attach a native TUI question presenter during chat while retaining Inquirer outside the TUI.
- [x] Support input, password, confirm, select, checklist, validation, defaults, recommendations, limits, descriptions, Unicode, and Other values.
- [x] Suppress active `com_ask` tool blocks and append compact label-resolved, password-safe completed summaries.
- [x] Cover slot behavior, renderer precedence and suppression, slash separation, and native question lifecycles with focused tests.
- [x] Restore full-thread navigation for modified CSI Page Up/Page Down input and add explicit top/bottom jumps.
- [x] Carry forward the old pretty `fs_tree` view as a standalone access-aware tool renderer.
- [x] Run targeted TUI, CLI, service, and API builds; TUI/CLI/service tests; CLI/TUI/service lint; and whitespace checks.
- [ ] Run an interactive ConPTY verification from a host that exposes a TTY to the verification process.

## Verification Findings

- TUI tests pass: 17.
- CLI tests pass: 118 total; the five directly affected suites pass 37 tests.
- Focused service slash/history tests pass: 18.
- TUI, CLI, service, and API server builds pass at the final verification
  checkpoint.
- TUI, CLI, and service lint pass; `git diff --check` passes.
- The API server suite retains its two previously documented failures: the
  WebSocket non-confirm question flow and integration startup without an
  `EmitService` registration. Neither originates in this CLI projection change.
- Local WinPTY smoke execution was attempted, but the managed shell exposes
  redirected stdin rather than a TTY, so WinPTY exited with `stdin is not a
  tty`. Automated fake-terminal coverage exercises the same input, focus,
  resizing, scrolling, and cleanup paths; a host-attached ConPTY pass remains.
