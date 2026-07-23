---
id: repair-cli-tui-refactor
type: bug
title: Repair and complete the CLI TUI refactor
status: in_progress
priority: high
assignedTo: alex-morgan
createdBy: agent
createdByType: agent
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - cli
  - tui
  - terminal
  - testing
createdAt: 2026-07-23T11:46:32.6615697+02:00
updatedAt: 2026-07-23T20:25:47.0000000+02:00
---

## Goal

Make the unfinished `@ai-team/tui` and CLI chat refactor usable and testable. Use
`earendil-works/pi/packages/tui` as an architectural reference while preserving
ai-team's workflow, handoff, question, and command behavior. Coordinate with the
existing workflow-v2 migration task rather than introducing another chat runtime.
Keep `packages/core` and `packages/service` unchanged unless a failing contract
proves that a minimal shared-layer correction is necessary, and retain Web UI
compatibility throughout.

Each agent owns a distinct personality and conversation context. A `/handoff`
passes a summary/briefing to the receiving agent; it does not merge or replace
the agents' private contexts. The service is authoritative for this lifecycle.
The TUI must remain a projection of emitted handoff/subworkflow events and must
not implement its own context or orchestration state machine.

Workflows, slash commands, and tools implement the same interface and share the
XState-driven execution lifecycle. Their UI presentation differs. The
`unified-tui-placement` follow-up supersedes the earlier rule that slash results
are attached to `UserMessage`: invocations remain developer transcript lines,
while results are standalone non-speech transcript components. The CLI must
consume the shared runtime events and must not add separate command, tool, or
workflow execution APIs.

Non-negotiable package architecture: every interface or type crossing a package
boundary is defined in `packages/core`; core contains no implementation. Runtime
implementations are class-based, constructed through dependency injection, and
owned by their adapter/service package.

`packages/tui` only reacts and renders. It owns terminal mechanics, input
decoding, layout, focus, and differential drawing—not command dispatch,
workflows, handoffs, sessions, agent contexts, or any other business behavior.
Those semantics live in `packages/service`; CLI and Web remain thin projections.
The API server invokes the same service implementation and transports its
information to the Web client; it must not diverge into a separate runtime.

## Action Items

- [x] Establish the baseline: both TUI and CLI compile, the TUI has no tests, and the CLI has six reproducible test failures.
- [x] Remove the obsolete non-TUI chat implementation and promote the TUI chat handler to `handlers/chat.ts`.
- [x] Identify an incorrect prompt cursor offset and leaking signal handlers in the new chat orchestrator.
- [x] Move the new cross-package TUI/terminal contracts into `packages/core` without adding runtime implementation there.
- [x] Add a fake-terminal regression harness for rendering, request coalescing, resize, focus, and cursor placement.
- [x] Repair terminal lifecycle, resize-cache invalidation, and differential-rendering invariants using Pi's implementation and tests as the reference.
- [x] Repair chunk-safe keyboard, Unicode editing, and bracketed-paste input handling.
- [x] Restore command-stream and DI-owned question-service compatibility broken during the refactor.
- [x] Integrate the new TUI through the CLI adapter without running the legacy and new renderers simultaneously.
- [x] Render handoffs as transitions in one durable transcript while keeping per-agent runtime contexts entirely service-owned.
- [x] Preserve the shared XState tool/workflow execution path for slash commands; standalone result placement is owned by the `unified-tui-placement` follow-up.
- [x] Restore legacy identity semantics in the modern transcript: use the selected agent ID as a temporary display fallback, label assistant responses with the active personality, and render only the service-provided `developerName` rather than inventing `You`.
- [x] Restore colored `Agent Name → developerName:` response headers/body and the visible `💭 thinking…` status indicator.
- [x] Label the animated status indicator as `<Agent Name> is thinking…` using the active personality's color.
- [x] Render streamed assistant content as terminal Markdown, including headings, emphasis, inline code, fenced code, lists, quotes, links, and wrapping.
- [x] Anchor the composer and metadata footer to the bottom of the terminal while retaining user messages, agent responses, tools, and handoffs in one chronological transcript.
- [x] Show workspace/session/workflow/model metadata in the footer, preserving the model on narrow terminals.
- [x] Restore slash-command hints, keyboard selection, and completion in the TUI composer; prove slash messages are dispatched unchanged through `chat-chat` and keep hint metadata out of the service payload.
- [x] Stream `💭 ` reasoning tokens in a dedicated expanded thinking block and collapse it when visible assistant output or another lifecycle boundary begins.
- [x] Render expanded and collapsed thinking in the active personality's service-provided color.
- [x] Render agent messages on a personality-tinted background chosen for contrast with the agent's main color, preserving the surface across Markdown spans and wrapped lines.
- [x] Render the bottom composer on a dark-gray full-width surface with subtle top/bottom borders, including slash-command hints and the inactive working-state prompt.
- [x] Keep the active agent name and model visible in the bottom footer and update both from service-owned identity events.
- [x] Keep the project directory on the footer's left and show the complete service-owned session ID as `session: <sessionId>` rather than replacing it with a title or truncating it.
- [x] Support a growing multiline composer with soft wrapping, pasted newlines, modified-Enter line insertion, multiline cursor movement, and plain-Enter submission.
- [x] Format footer identity consistently as `<project directory> - <Agent Name> (<model>) - session id: <full id>`.
- [x] Color the footer's agent name with the active personality color while keeping model and session metadata neutral.
- [x] Route `chat-chat-startup` events through the TUI projector so the service-emitted `agent_info.llmModel` reaches the footer instead of being consumed by the legacy pre-TUI renderer.
- [x] Include CLI-local `/exit` and `/q` controls in slash hints without registering or dispatching them as service commands.
- [x] Use the shared dispatcher's `chat: true` catalog as the single source for slash hints and execution; restore `/help`, canonical grouped-command dispatch, alias resolution, and reject non-chat commands.
- [x] Bind the scoped service emitter into `InteractionService` so slash-command tool results reach both CLI and Web projections.
- [x] Disable terminal auto-wrap only while painting synchronized exact-width frames, then restore it, preventing full-width agent surfaces and composer borders from scrolling over the footer or duplicating the composer.
- [x] Carry the configured `agent.avatar.color` through service-owned startup, handoff, and back identity events so the TUI uses personality colors (Michael Brown's `hsl(205, 70%, 60%)` blue) instead of a name-hash fallback.
- [x] Reserve the agent-message surface margins before Markdown wrapping so agent rows never overflow the terminal width or lose trailing characters at the boundary.
- [x] Preserve active ANSI style state across column slices so every wrapped Markdown continuation retains the agent's configured foreground color instead of reverting to terminal white.
- [x] Reserve the terminal's final physical column during component layout so immediate-wrap/ConPTY behavior cannot create extra rows that push agent messages through the composer and footer.
- [x] Keep developer identity in the transcript and reduce the active composer prompt to a simple `> `.
- [x] Address differential repaint rows with an explicit column `1` so terminals cannot retain the `> ` prompt cursor column and shift/crop every streamed agent line.
- [x] After an explicit chat exit, restore the terminal and print truthful resume hints for `ait chat <sessionId>` and `ait chat`; allow a single `session-*` positional argument to resolve its owning agent before startup.
- [x] Preserve the legacy project-aware goodbye greeting before the session resume hints so leaving the TUI retains ai-team's friendly tone.
- [x] After a service-emitted handoff/session switch, send subsequent turns with the target agent and linked session instead of retaining the TUI's startup request payload.
- [x] Treat the terminal-height chat root as one synchronized full-screen frame and repaint transcript, composer, and footer together; do not apply partial line diffs without Pi's logical cursor/viewport tracking model.
- [x] Replace `[INFO]`-formatted resume history with structured `history_message` stream events and render stored human/agent entries through the same transcript components, Markdown, identity color, model, and agent background as live messages.
- [x] Render handoff reasons/briefings through the source agent's normal `AgentResponse` surface, preserving Markdown, model, personality foreground/background, wrapping, and showing the target agent as recipient.
- [x] Resume a chat with a chronological, presentation-only transcript of the complete session thread, retaining every original agent identity and rendering deduplicated persisted handoffs like live handoffs without merging private agent contexts.
- [ ] Add chat-level tests for prompt submission, streaming tokens, tools, handoffs, subworkflows, questions, abort, and clean shutdown.
- [ ] Re-run targeted builds/tests, relevant service/API and Web checks, and the original interactive CLI scenario.
- [ ] Remove temporary scripts, backup files, and obsolete compatibility code once parity is demonstrated.

## Verification Findings

- `@ai-team/core`, `@ai-team/tui`, `@ai-team/cli`, `@ai-team/service`, `@ai-team/api-server`, and `@ai-team/web` build successfully.
- TUI tests: 14 passing.
- CLI tests: 92 passing.
- Web tests: 125 passing; the production Web build succeeds.
- CLI and TUI lint succeed, and `git diff --check` reports no whitespace errors.
- The wider service suite has 26 pre-existing workflow/init migration failures.
- The API server suite has one WebSocket question-flow failure plus an integration setup failure caused by a missing `QuestionService` registration. These were reproduced but not changed because service/API behavior is outside this TUI repair and the architecture constraint forbids adapter-side workarounds.
- Pi-style token usage, context utilization, and cost cannot be added honestly until those values exist in the shared runtime stream contract. They remain a contract-backed follow-up rather than CLI-only state.
