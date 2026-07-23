---
id: repair-chat-handoff-session-switching
type: bug
title: Unify handoff lifecycle and whole-thread chat rendering
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
updatedAt: 2026-07-23T19:06:35+02:00
---

## Goal

Make a handoff feel like one continuous multi-person chat while preserving
ai-team's defining context boundary: every agent has a separate session and
private LLM context, and the visible thread is a presentation of all linked
sessions rather than a merged model context.

In user terminology, a session's `parentId` links it to the session that
delegated to it. The canonical field currently used by the code and storage is
`previousSessionId`. Following that relationship to the root identifies thread
membership. A thread contains at most one session per agent; handing off to an
agent already present in the thread resumes that agent's existing session.

The implementation must make handoff, `/back`, resume, live streaming, persisted
history, CLI rendering, and Web transport agree on one service-owned active
agent/session. It must not infer runtime state from TUI colors, headers, or the
session with the newest `lastActivityAt`.

## Required Conversation Semantics

Each normal agent message belongs to exactly one agent session and is added only
to that agent's private LLM history. The complete thread transcript is loaded
separately for presentation and must never be passed wholesale into an agent's
model context.

A successful handoff from Agent A to Agent B has this visible sequence:

1. The developer's handoff request remains a normal developer transcript entry.
2. Agent A generates one briefing addressed to Agent B.
3. The briefing is persisted in both sessions with one shared `handoffId`.
4. The presentation transcript deduplicates those two records and renders one
   `Agent A → Agent B` message using Agent A's name, model, foreground color,
   message background, Markdown, and wrapping.
5. Agent B becomes the active personality and session.
6. Agent B writes a normal response addressed to the developer, stored only in
   Agent B's session. This response keeps the conversation flowing and is
   rendered like every other Agent B response.
7. Every later developer turn is dispatched to Agent B and persisted in Agent
   B's session until another handoff or `/back` succeeds.

The duplicated briefing records are a persistence invariant, not two visible
messages. Deduplication uses `handoffId`, not content comparison. Missing or
legacy IDs may use an explicitly tested fallback key, but must not make normal
messages disappear.

`/back` is a summarized return handoff, not a UI-only session switch. The
currently active agent generates a briefing for the agent/session being returned
to. That briefing receives a fresh `handoffId`, is stored in both sessions, is
shown once as `Current Agent → Previous Agent`, and is followed by a normal
response from the restored agent to the developer.

The same rule applies when an agent calls `com_handoff` and explicitly targets
the agent from which the current delegation came. Return behavior is determined
from the persisted delegation/navigation stack, not from whether the user typed
`/back`. Both `/back` and an explicit handoff to the delegating agent use one
return-handoff implementation:

- The current agent summarizes the work, relevant discoveries, decisions,
  unresolved questions, and recommended next step for the delegating agent.
- The return summary is a new logical handoff message with a fresh `handoffId`.
- Identical logical summary content and handoff metadata are persisted in both
  the current and delegating agent sessions.
- The whole-thread transcript deduplicates the mirrored records by `handoffId`
  and shows one `Current Agent → Delegating Agent` message in the current
  agent's color and message style.
- The delegating agent's private session is restored and receives the summary as
  its only newly shared context; the full delegated agent history is not copied.
- The delegating agent then writes a normal response to the developer so the
  visible conversation continues naturally.
- The navigation frame is popped only after the mirrored summary and target
  context transition succeed.

A handoff to some other agent already present in the thread is not automatically
classified as “back.” It is a normal handoff unless that target is the current
top delegation frame. This keeps nested delegation behavior deterministic.

## Thread Navigation and Resume

`lastActivityAt` is not an active-session cursor. A handoff writes to two
sessions, and `/back` can intentionally activate an older session. The thread
therefore needs persisted navigation state owned by the service layer:

- The state is keyed by the thread root resolved through `previousSessionId`.
- It records the active session ID and an ordered navigation stack.
- A normal handoff pushes the source frame and activates the target session.
- `/back` pops the previous frame only after its summarized return handoff has
  persisted successfully.
- Returning or handing off to an existing agent reuses that agent's session;
  the navigation stack may revisit a session but thread membership remains one
  session per agent.
- Failed or cancelled transitions leave the cursor, stack, agent context, and
  both session histories unchanged.
- Cursor/stack persistence and successful handoff persistence must be treated
  as one application-level transition so a process exit cannot leave the
  transcript and resume target disagreeing.

Bare `ait chat` resolves the most recently active thread and then its persisted
active session. `ait chat <sessionId>` first resolves that session's thread and
then opens the thread at its persisted active session. Providing any member
session therefore resumes the last agent used in that thread rather than
silently selecting the named member as a different active context. An explicit
new-session action is the only operation that creates an independent root
thread.

An agent-only invocation is that explicit new-session action:
`ait chat <agent-name>` starts a new root session with the selected agent when
no session is supplied. It does not search for or resume that agent's previous
session. Supplying a session remains an explicit thread resume, even when an
agent argument is also present. The `--new` option remains an explicit override.

If legacy thread data has no persisted cursor, the service performs a
deterministic one-time fallback from the canonical ordered transcript, seeds the
cursor, and then uses persisted state thereafter. The fallback must account for
mirrored handoff records and stable message ordering.

## Whole-Thread Transcript Projection

The service builds one canonical ordered presentation transcript from every
session linked to the root. Ordering is stable by persisted timestamp plus a
storage-backed tie-breaker such as message ID; session traversal order must not
decide conversational order.

The transcript contains typed presentation entries for developer messages,
agent-to-developer messages, and handoff transitions. Each entry carries the
authoritative source/target identities required by adapters: agent IDs, names,
roles, models, configured avatar colors, session IDs, `handoffId`, timestamp,
and content. Cross-package event and transcript types remain defined in
`packages/core` or the existing API contract package as appropriate.

Whenever the service loads or activates an agent for startup, resume, handoff,
or `/back`, it resolves the complete display identity at the same boundary:
agent ID, name, role, configured avatar color, and resolved LLM model. That
identity is included in the corresponding typed events/stream entries. The CLI
must not load agent configuration separately or infer a model from command
arguments, session history, or an earlier personality.

The CLI renders the entire transcript as one chat with several agents:

- Developer messages appear once in chronological position.
- Every agent response uses that agent's own color and message surface.
- Every handoff briefing appears once as `Agent A → Agent B`.
- The target agent's acknowledgement appears next as `Agent B → Developer`.
- Historical handoff entries never mutate live TUI state.
- The footer and thinking indicator show only the persisted active agent/model
  and active session.
- The footer formats the active identity as `Agent Name (resolved model)` and
  updates it from startup, resume, handoff, and `/back` identity events.
- Resume rendering and live rendering use the same components, Markdown rules,
  width constraints, and color resolution.

This whole-thread rendering is required whenever the interactive `ait chat`
view opens an existing thread, regardless of how it was selected:

- Bare `ait chat` resolves the most recently active thread and renders its
  complete information flow before showing the input prompt.
- `ait chat <sessionId>` and equivalent explicit resume options resolve the
  containing thread and render the same complete information flow, not only
  messages stored in the supplied member session.
- A handoff that occurs while `ait chat` is already open appends to that same
  visible transcript; it does not replace the transcript with the target
  agent's private session history.
- The visible transcript includes every relevant developer message, agent
  response, and deduplicated handoff/return briefing across all linked agent
  sessions in stable chronological order.
- The LLM request remains intentionally narrower: only the active agent's
  private session context plus explicitly received briefing/context is sent to
  that agent's model.

The distinction must be visible in naming and tests: `thread transcript` means
the full human-facing information flow, while `session history` means the
private context of one agent. These collections must never be assigned to the
same runtime field or passed interchangeably.

The Web UI must continue working against the same service-owned session and
handoff behavior. Transport adapters may project the canonical events
differently, but they must not implement their own thread traversal, active
cursor, handoff orchestration, or context merging.

## Architecture Constraints

The XState workflow engine remains the authoritative execution lifecycle.
Slash commands, tools, and workflows keep their shared command interface;
`/handoff` and `/back` must not gain CLI-only execution paths.

`packages/service` owns thread resolution, cursor/navigation state, briefing
generation, persistence coordination, target acknowledgement, runtime context
mutation, and transcript construction. `packages/cli` and `packages/web` only
react to typed events and render.

`packages/core` remains implementation-free and defines interfaces/types that
cross package boundaries. Runtime implementations remain class-based and
dependency-injected. Core/service changes must be the smallest coherent changes
needed to establish the missing thread-state and transcript contracts.

## Handoff Command Ownership and Delegation Approval

The shared `com_handoff` command/tool owns every semantic part of delegation:
target resolution, approval policy, target session resolution/creation,
briefing generation, persistence, workflow creation, runtime context mutation,
thread cursor/navigation updates, target acknowledgement, and lifecycle events.
Callers request a handoff and project its result; they do not reproduce pieces
of the transition.

`com_handoff` is available to every agent. An agent's configured `handoffs`
entries are not a tool-availability list. They are the set of canonical target
agents that this source agent may delegate to without asking the developer
again.

The handoff command resolves both source and target identities before applying
this policy:

- If a human explicitly invokes `/handoff`, any valid target agent is approved.
  The slash invocation itself is authoritative consent and must not produce a
  redundant confirmation question.
- If an agent invokes `com_handoff` as a model tool and the canonical target is
  listed in that source agent's `handoffs`, delegation proceeds without a
  confirmation.
- If an agent invokes `com_handoff` as a model tool and the canonical target is
  not listed in that source agent's `handoffs`, the handoff command invokes the
  shared `com_ask` command with a confirm question before making any persistent
  or runtime change.
- Approval proceeds through the same handoff transition as a configured target.
- Denial, cancellation, timeout, or an unavailable question channel leaves the
  source agent/session, private histories, thread cursor, and navigation stack
  unchanged and returns a structured non-handoff result.

Approval is based on canonical resolved agent IDs, not display names or raw tool
arguments. A self-handoff remains invalid. The dispatcher supplies trusted
provenance; models cannot claim that a tool call came from a human slash
command. The bypass requires both `invocationSurface === 'slash'` and
`calledByHuman === true`. Tool or workflow provenance never inherits that
bypass merely because the surrounding chat was started by a human.

The confirmation should identify the source and target clearly, including the
target role when available, for example: `Emily Davis wants to hand this chat
to Sarah Lee (Chief Architect). Allow this delegation?` The default is deny.
Both CLI and Web render the existing `com_ask` question lifecycle; neither
adapter implements delegation policy.

The current pre-dispatch `agent-delegation` permission check must not reject an
unlisted target before `com_handoff` can ask. It should be removed from this
command or narrowed to checks that do not replace the command-owned approval
policy. Existing `delegatesTo` behavior must not silently override the explicit
`handoffs` plus user-approval rule defined here.

## Known Regressions Covered by This Plan

One observed handoff rendered `Sarah Lee → Clemens Meier` while the response
claimed to be Emily Davis. Another Michael Brown to Emily Davis handoff changed
the TUI identity but kept dispatching later turns with the immutable Michael
startup payload. The CLI payload bug has a regression test, but the complete
service-owned lifecycle and resume rules in this plan still need end-to-end
coverage.

There is also a suspected workflow delegation defect: after a handoff appears
to complete, execution can remain in or fall back to the source agent's session.
The investigation must trace the structured handoff result through command/tool
dispatch, XState result projection, `currentAgentId`/`currentSessionId`
assignment, context bootstrap, and the next model invocation. A correctly
rendered handoff event is not evidence that delegation succeeded.

The authoritative success condition is behavioral: after Agent A hands off to
Agent B, the next model invocation uses Agent B's personality, resolved model,
permissions, tools, private session history, and target session ID. Its user and
assistant messages are persisted only in Agent B's session. Agent A cannot
become active again unless a later handoff, `/back`, or explicit new-thread
operation selects it.

The reported incomplete resume of `session-2026-07-21-k40o63` was a viewport
defect rather than missing thread data. The persisted root Michael Brown session
has no parent and contains the earlier messages; its Emily Davis child is linked
through `previousSessionId`. The service emitted the complete transcript, but
the focused prompt consumed all keyboard input, so Page Up never reached the
transcript. Page Down also moved the viewport in the Page Up direction. The
layout now owns input focus, forwards typing to the prompt, routes transcript
navigation to the viewport, and preserves bottom-follow behavior after the user
returns to the newest entry.

Persisted tool calls were present in `ChatMessage.tool_calls`, but
`ChatInfoService` discarded them while projecting the resumed thread. Resume
now emits historical tool events immediately after their owning message, uses
raw persisted results for normal tools and user-facing `resultLlm` content for
slash commands, and omits empty agent bubbles for tool-only records. Historical
tool events do not alter live thinking/response state or merge repeated calls
that happen to use the same tool name.

Initial historical tool replay exposed a physical terminal overflow. Persisted
results can contain single logical lines hundreds or thousands of characters
wide; `ToolEvent` previously wrapped only at spaces, so unbroken JSON, paths, or
source lines exceeded the terminal width. The terminal created extra physical
rows and scrolled the fixed frame, leaving repeated `Agent: …` headers in
scrollback and burying earlier messages. Tool rows now hard-wrap to visible
terminal width. Historical tools also use a bounded preview of four input lines
and eight output lines with an omitted-line count, while live tool rendering
remains expanded and the full result remains persisted.

The model name was lost before transport emission. `AgentManager` correctly
loads the configured `llm.modelKey`, but startup and transcript projection read
`agent.resolvedLlm.model` without first resolving that key. A service-owned
`AgentRuntimeIdentityResolver` now uses the existing configuration storage and
LLM settings resolver to attach the effective provider/model identity without
mutating the cached agent document. Startup, whole-thread history, handoff, and
`/back` events therefore carry the resolved model for footer and message-header
rendering.

A later natural-language request, `let me talk to sarah`, exposed a separate
handoff transition defect. The CLI correctly recognized the direct handoff
intent, but its XState transition context carried `agentId` without a hydrated
`agent`. `com_handoff` therefore could not see that Sarah Lee is configured in
Michael Brown's `handoffs`, treated the transition as unconfigured, and returned
a non-success response. The CLI bridge then incorrectly treated that response
as a successful transition and sent `[Handoff received]` through Michael's
existing session. The real developer request was never persisted or processed.
`com_handoff` now resolves the source agent from the authoritative `agentId`
before applying delegation policy, and the bridge accepts only `status: ok` as
a transition that may schedule the target acknowledgement.

An agent response after a tool loop exposed a participant-identity ambiguity.
The persisted response was correctly owned by Sarah Lee and addressed to the
human, but its prose began with “Hey Michael” because the generated system
prompt named Sarah's manager and team while never identifying the human
conversation partner. The shared service turn preparation now adds an explicit
conversation-participants system message naming the configured developer as
the human author of `user` messages and the current addressee. Because that
message is part of the model input retained by both supported tool-loop
implementations, the identity remains explicit before and after tool calls.
It also tells agents to prefer the developer's first name in natural direct
address, reserving the full name for identification or genuinely formal
contexts. This is shared by CLI and API/Web consumers and adds no behavior to
the TUI.

New chats initially lacked a footer session ID even though session persistence
had already succeeded. Startup emitted the active agent before resolving the
session, then returned the resolved session internally without emitting it.
Consequently the CLI's initial request payload and footer state both retained
an undefined session ID. `ChatStartupCommand` now emits the existing
`session_switched` lifecycle event with the resolved session and agent
immediately after session startup and before transcript replay. The CLI already
handles that event, so it now renders the ID and uses the same persisted session
for the first developer turn. API/Web consumers receive the same event.

The footer's workspace metadata now also includes the Git branch. Chat startup
uses the existing injected `ISystemInfoService` to resolve the authoritative
workspace and branch, then emits a typed `workspace_info` event. The CLI only
projects that event as `workspace - branch -` beside the existing agent/model
and session metadata; it does not execute Git itself. The event is part of the
shared runtime/API contract, so Web consumers can use the same metadata without
duplicating repository inspection.

Live tool-initiated handoffs previously buffered their generated briefing with
`llmService.chat`. The source agent's thinking indicator therefore remained
visible for the entire tool execution, and the handoff message appeared only
after generation and persistence. The live event also carried both an internal
`handoffNote` and the generated `briefingContent`; the TUI concatenated them,
which rendered identical content twice when the model fell back to the note.
The active handoff workflow now uses streaming LLM generation and emits one
typed lifecycle keyed by `handoffId`: `start`, zero or more `delta` events, and
`complete` after mirrored persistence succeeds. A failed persistence emits
`cancelled`. The TUI owns one mutable source-to-target message component for
that lifecycle, stops source thinking at `start`, appends tool-owned deltas
without treating them as a normal assistant reply, and changes active identity
only at `complete`. Completion reconciles the component to the persisted
briefing, and rendering chooses the briefing over the internal note rather than
showing both. This establishes that tools can emit correctly attributed visible
content during execution without bypassing the shared event stream.

## Action Items

- [x] Capture the current handoff, `/back`, startup, thread traversal, persistence, and event-emission paths in focused characterization tests before changing behavior.
- [ ] Reproduce the stuck-source-session defect and capture the handoff command/tool result, XState state before and after result application, execution context, emitted identities, next turn input, model agent, and persistence destination.
- [ ] Verify that the workflow handoff result schema and result unwrapping preserve the target `agentId`, `sessionId`, briefing, auto-react message, and hop state without falling back to source values.
- [x] Verify that XState applies the target `currentAgentId` and `currentSessionId` before scheduling any target acknowledgement or subsequent developer turn.
- [x] Verify that turn bootstrap treats the workflow's active target as authoritative and cannot replace it with the startup agent or that agent's latest session.
- [x] Define the canonical thread glossary and invariants in code comments/tests, mapping user-facing `parentId` terminology to the existing `previousSessionId` storage field.
- [x] Design the minimal core interfaces and storage contract for thread active-session state and a persisted navigation stack keyed by root session ID.
- [x] Add a migration and repository implementation for thread navigation state without placing storage implementation in core or service.
- [ ] Add service methods that resolve a member session to its thread root, load or seed its active cursor, activate a target session, push a handoff frame, and atomically pop a `/back` frame.
- [x] Replace `lastActivityAt`-based bare resume selection with most-recent-thread plus persisted-active-session resolution.
- [x] Make explicit member-session resume resolve the containing thread and its active session while preserving explicit new-thread behavior.
- [x] Make `ait chat <agent-name>` start a new root session while bare `ait chat` and session-based invocations resume the persisted active thread agent.
- [ ] Define a canonical service-owned transcript entry model with stable chronological ordering and authoritative agent/session identity metadata.
- [x] Build the whole-thread transcript from all sessions linked by `previousSessionId`, using timestamp plus persisted message ID ordering rather than BFS/session order.
- [x] Deduplicate the two persisted copies of each handoff briefing by `handoffId` and render one logical Agent A to Agent B entry.
- [x] Stream live tool-owned handoff briefings through a phased `handoffId` lifecycle, render one source-to-target component, and never concatenate duplicate note/briefing content.
- [ ] Preserve normal developer and agent messages once in their chronological positions without leaking hidden, archived, low-importance, or internal control messages.
- [ ] Consolidate slash-command, tool-initiated, natural-language, and workflow-initiated handoffs onto one service transition that resolves or creates the target session exactly once.
- [ ] Make `/handoff`, model tool calls, and workflow delegation return the same typed transition result and prove each path reaches the same XState target-agent/session state.
- [x] Keep `com_handoff` in every agent's available tool set regardless of whether that agent has configured `handoffs` targets.
- [x] Move unlisted-target delegation policy from the pre-dispatch permission rejection into the shared handoff command/tool.
- [x] Resolve configured `handoffs` entries and requested targets to canonical agent IDs before deciding whether approval is required.
- [x] Treat only a trusted human slash invocation as pre-approved for any valid target and prevent tool/workflow callers from spoofing that provenance.
- [x] Use invocation-surface-aware self-handoff wording: developer-facing “already talking to” text for slash commands and agent-facing “cannot hand off to yourself” text for tool calls.
- [x] For an agent tool invocation targeting an unlisted agent, dispatch a default-deny `com_ask` confirmation before session creation, briefing generation, persistence, cursor changes, or event emission.
- [ ] Return a typed denied/cancelled handoff outcome and prove that refusal, timeout, or missing question capability has no handoff side effects.
- [x] Ensure an approved unlisted delegation rejoins the exact same transition path used by configured targets rather than maintaining a second approval-specific handoff implementation.
- [x] Reject cancelled, denied, or otherwise non-successful handoff command responses before changing runtime identity or scheduling a target acknowledgement.
- [x] Make a successful handoff persist the mirrored briefing, update the active cursor/navigation stack, replace `ctx.agent`, `ctx.agentId`, `ctx.sessionId`, and `ctx.history`, and only then expose the transition as complete.
- [x] Generate and persist a normal target-agent acknowledgement addressed to the developer after every successful handoff, using only the target session's private history plus the received briefing.
- [x] Reimplement `/back` as a summarized reverse handoff with a fresh `handoffId`, mirrored briefing persistence, stack pop, restored private context, and target acknowledgement.
- [x] Detect an explicit `com_handoff` to the current top delegation frame as the same summarized return-handoff operation used by `/back`.
- [ ] Define and test the return-summary prompt so it transfers discoveries, decisions, unresolved questions, and recommended next action without copying the returning agent's full private history.
- [x] Persist one return summary in both source and delegating-agent sessions with one fresh `handoffId`, then deduplicate it into one visible source-to-target thread entry.
- [x] Pop the delegation frame only after return-summary persistence and target context activation succeed; preserve the frame and both contexts on failure.
- [ ] Ensure failed briefing generation, persistence, target resolution, acknowledgement, cancellation, or context loading cannot partially switch the active cursor or runtime identity.
- [ ] Emit one coherent typed lifecycle containing handoff, session switch, active agent/model, and target acknowledgement data for both local CLI and API-server consumers.
- [ ] Ensure every service path that loads or activates an agent resolves and emits its ID, name, role, configured avatar color, and resolved LLM model in one authoritative identity payload.
- [x] Render live and resumed handoff entries through the same source-agent message component and render target acknowledgements through the normal target-agent response component.
- [x] Replay persisted tool calls/results in chronological position during thread resume without allowing historical events to mutate live TUI state.
- [x] Hard-wrap tool output to terminal width and bound historical previews so large persisted results cannot scroll repeated headers over the conversation.
- [x] Resolve configured agent model keys before emitting startup, historical transcript, handoff, and `/back` identity events.
- [x] Identify the configured developer as the human conversation partner, prefer their first name in direct address, and retain that identity across tool-call continuations.
- [x] Emit the persisted active session during startup so the footer and first developer turn use its session ID.
- [x] Emit workspace and Git branch metadata from the shared startup service and render the branch beside the footer directory.
- [x] Keep historical thread rendering presentation-only so replayed handoffs cannot mutate the active TUI agent, session, footer, prompt, or outgoing turn payload.
- [x] Make CLI startup show the complete canonical thread transcript and anchor the footer/thinking state to the service-resolved active session.
- [x] Make bare `ait chat`, explicit member-session resume, and automatic latest-session resume load and render the same complete thread transcript before the first prompt.
- [x] Make the complete resumed thread navigable from the focused composer with Page Up/Page Down and preserve live bottom-follow behavior.
- [x] Render the working directory with the same dim footer typography as session metadata and without a separate background surface.
- [x] Keep an already-open `ait chat` transcript continuous across handoffs and `/back`, appending new thread entries rather than replacing it with the newly active agent's session history.
- [ ] Give full-thread presentation data and single-session LLM history distinct service types/names and prove they cannot be substituted at the chat-runtime boundary.
- [x] Preserve Web chat behavior and adopt the same authoritative active-session/handoff contracts without moving orchestration into the Web controller.
- [ ] Add service regression tests for first handoff, handoff to an existing agent, multi-hop handoff, `/back`, repeated `/back`, failed handoff rollback, process restart, and legacy cursor seeding.
- [ ] Add nested return tests proving both `/back` and explicit handoff-to-delegator summarize B to A, deduplicate the mirrored message, restore A's private context, and distinguish returns from handoffs to other existing thread agents.
- [ ] Add handoff-policy tests for configured target auto-approval, unlisted target confirmation approval/denial/timeout, human slash bypass, spoofed provenance rejection, self-handoff rejection, and CLI/Web question transport parity.
- [ ] Add an end-to-end workflow regression proving that the first and every subsequent turn after delegation invokes and persists against the target agent until an explicit reverse transition occurs.
- [ ] Add transcript tests for mirrored briefing deduplication, stable timestamp ties, identity/color/model metadata, return handoffs, archived/internal filtering, and missing legacy `handoffId` fallback.
- [ ] Add CLI tests for full-thread resume, multi-agent colors, one visible handoff briefing, target acknowledgement flow, active footer/model, subsequent-turn routing, and historical replay isolation.
- [ ] Add CLI tests showing that bare resume and explicit member-session resume render identical full-thread information flow while the invoked model receives only the resolved active session's private history.
- [ ] Add CLI footer tests proving `Agent Name (model)` is present after startup and resume and changes atomically after handoff and `/back`, including agents that use different models.
- [ ] Add API-server and Web regression tests proving that the shared service behavior remains compatible and no adapter creates a second thread state machine.
- [ ] Run builds, lint, targeted/full tests, database migration tests, fuzzy duplication scanning for the affected scope, and an interactive Michael to Emily to Sarah to `/back` to `/back` scenario.
- [x] Update the handoff architecture documentation after tests establish the final persisted cursor, navigation, transcript, and acknowledgement contracts.
