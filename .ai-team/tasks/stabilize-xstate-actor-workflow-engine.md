---
id: stabilize-xstate-actor-workflow-engine
type: feature
title: Stabilize the workflow engine on the XState actor model
status: in_progress
priority: urgent
assignedTo: alex-morgan
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: 96
deadline: null
tags:
  - workflow
  - xstate
  - actors
  - chat
  - persistence
  - onboarding
  - architecture
createdAt: 2026-07-24T23:56:07.9881991+02:00
updatedAt: 2026-07-25T13:28:00.0000000+02:00
---

## Goal

Stabilize ai-team's workflow engine around the native XState actor model so
long-running business workflows can invoke multi-turn chat actors, validate
durable outcomes, return typed output to their parent workflow, survive process
restarts, and continue in the same UI without workflow-specific adapter logic.

This is the architectural stabilization effort that ends the cycle of repairing
individual onboarding symptoms. It must produce one canonical execution model
for short commands, nested workflows, interactive chat, questions, handoffs,
return transitions, persistence, cancellation, and UI event projection.

The first proving workflow is initialization and founding-team onboarding:

1. Configure and verify the LLM.
2. Create the selected CEO.
3. Invoke a CEO business-definition chat actor.
4. Reject `/return` until the approved business-definition artifact is valid.
5. Return the typed business definition to the parent onboarding workflow.
6. Let the parent workflow generate and present HR Director candidates.
7. Create and configure the selected HR Director.
8. Invoke an HR hiring chat actor with the CEO's business-definition output.
9. Reject `/return` until at least a Head of Development has been created and
   validated.
10. Return the typed hiring result and complete onboarding.

The implementation is complete only when that lifecycle is driven by one
persisted XState actor tree, not by a simulated input loop, prompt-only
orchestration, CLI continuation glue, or a workflow command that blocks until an
interactive chat ends.

## How to Execute This Plan Safely

An implementation agent must work one delivery slice at a time. It should read,
at minimum, the Frozen Architectural Invariants, In-Place Migration and
Swappable Seams, the relevant Implementation Playbook examples, that slice's
gate, and its matching action items.

For every slice:

1. Record the current single `IWorkflowRunner` registration and affected DI
   bindings.
2. Run the existing targeted workflow, command-dispatch, chat, and event-stream
   tests before editing.
3. Add characterization or failing acceptance coverage first.
4. Make one behavior-preserving extraction or one vertical behavior change.
5. Keep the same public `ICommand`, event-stream, and package architecture.
6. Run the mandatory adapter contract suite and both UI event-contract tests.
7. Confirm the container resolves one workflow runner and one adapter per seam.
8. Delete the replaced temporary adapter/bridge in the same slice.
9. Run the slice gate before checking off its action items.
10. Stop on the last green state if the gate fails; do not create a second
    engine to continue around the failure.

An agent must not start Slice N+1 while Slice N's gate is red. A task checkbox
means the behavior and its verification evidence are both complete, not merely
that files or interfaces were added.

## Why This Work Exists

The current workflow runner wraps an XState actor inside
`run(...): Promise<WorkflowResult>` and immediately waits for the actor to
finish. Workflow steps compile primarily to promise actors that execute
commands. This works for bounded command workflows but cannot naturally
represent a parent workflow that remains active while a child chat processes
many turns across requests or process restarts.

Interactive onboarding was consequently implemented outside the intended actor
lifecycle:

- an imperative `while` loop read terminal input inside a workflow step;
- workflow context was injected into ordinary chat requests;
- the CLI was asked to finish initialization and start chat separately;
- `/return` restored session navigation but did not complete an invoked child
  actor and trigger the parent's `invoke.onDone`;
- durable workflow state was distributed across sessions, execution context,
  prompts, and adapter behavior.

The core problem is not a missing onboarding conditional. The workflow engine's
public lifecycle requires every run to complete in one invocation, hiding the
XState actor that should remain alive.

## Research Basis

This plan was checked against primary documentation on 2026-07-24. These
sources constrain the design; they are not optional inspiration.

### Official XState v5 semantics

- [Actors](https://stately.ai/docs/actors): a state-machine actor can receive
  events, send events, invoke or spawn children, emit snapshots, and produce
  output on a top-level final state. Promise actors cannot receive events.
  Callback actors can receive events but cannot complete through `onDone` or
  produce persisted snapshots, so neither is an adequate multi-turn chat
  lifecycle.
- [Invoke](https://stately.ai/docs/invoke): invoked actors start when their
  parent enters the invoking state, stop when it exits, and report typed output
  through `onDone`. Invoked actors fit a finite, state-owned child such as one
  chat phase or nested workflow. Spawned actors fit a dynamic or unknown number
  of children.
- [Persistence](https://stately.ai/docs/persistence): use
  `actor.getPersistedSnapshot()` and restore with
  `createActor(logic, { snapshot })`. Persistence is deep across invoked and
  spawned children. Actions are not replayed on restore, but active invocations
  restart; therefore invoked side effects need idempotency keys and
  restart-safe implementations.
- [Inspection](https://stately.ai/docs/inspection): inspection at the root
  observes actor creation, events, snapshots, and microsteps for the whole actor
  system. This is the correct seam for correlation, diagnostics, and triggering
  ordered root-snapshot checkpoints after child progress.

### Agentic XState precedent

[Stately Agent](https://github.com/statelyai/agent) is the closest direct
precedent. Its current alpha documentation makes the machine—not the
model—responsible for legal control flow:

- [Migrating from a hand-rolled loop](https://github.com/statelyai/agent/blob/next/docs/from-a-loop.md)
  turns implicit phases into explicit states, model choices into legal events,
  deterministic policy into guards, and a human pause into an idle state whose
  JSON snapshot is resumed with an event.
- [Multi-agent composition](https://github.com/statelyai/agent/blob/next/docs/multi-agent.md)
  invokes one agent machine as a typed child actor, uses `onDone` for its
  output, observes the whole tree through inspection, and keeps host executors
  separate from machine control flow.
- [Machine as tool](https://github.com/statelyai/agent/blob/next/examples/machine-as-tool/index.ts)
  exposes a whole durable machine to a tool-calling harness through
  start/resume operations and an opaque persisted-snapshot handle.
- [Human in the loop](https://github.com/statelyai/agent/blob/next/docs/human-in-the-loop.md)
  derives the human's valid choices from events accepted by the current state,
  rather than asking the prompt to decide what transitions are legal.

Stately Agent 2 is alpha and currently targets XState 6 alpha while ai-team uses
XState 5.30. It is a design reference only. This plan must implement the needed
host/runtime behavior against the existing XState v5 dependency and must not
adopt the alpha package as a shortcut.

### Comparable durable agent runtimes

- [LangGraph subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
  preserve parent/subgraph identity and distinguish per-invocation from
  per-thread child state. Its
  [persistence model](https://docs.langchain.com/oss/javascript/langgraph/persistence)
  namespaces child checkpoints below the parent and treats a thread ID as the
  durable cursor.
- [Dapr Agents examples](https://github.com/dapr/dapr-agents/blob/main/examples/README.md)
  use actor-managed agents, durable child workflows, and “agents as tools,”
  where an LLM-selected tool synchronously delegates to a child workflow and
  returns its result.
- [Mastra workflows](https://mastra.ai/docs/workflows/overview) keep agents and
  tools as step implementations while workflows own sequencing, suspension,
  resumption, nested workflows, and typed input/output.

These systems differ in implementation, but agree on the important split:
short effects remain functions/tools, while long-running or interactive work
has its own durable lifecycle, typed state, suspension, and child identity.

## Repository Findings and Architectural Fault Line

The repository already contains most of the right pieces, but one convenience
interface erased the lifecycle distinction:

- `packages/service/package.json` uses XState `^5.30.0`.
- `xstate-workflow-runner.ts` creates a machine actor and immediately awaits
  `toPromise(actor)` inside `run()`. The actor is therefore hidden behind one
  bounded promise.
- command steps correctly invoke `ICommand` implementations through
  `fromPromise`.
- `WorkflowRunnerFactory.asCommand()` turns every workflow into `ICommand` and
  awaits `run()`. That is safe for a bounded workflow but flattens an
  interactive or nested workflow actor into a promise.
- `WORKFLOW-COMPOSITION.md` currently teaches parent workflows to call child
  workflows as command steps. That preserves a uniform surface but loses
  parent/child actor lifecycle, deep persistence, cancellation propagation, and
  `invoke.onDone`.
- `workflow/chat/chat-runtime.ts` uses XState for a bounded response/tool/handoff
  loop inside one human turn. It does not represent the durable multi-turn chat
  that waits for later user events.
- `commands/hr/workflow-phase.ts` compensates with a terminal-owned
  `while (true)` loop and first-turn prompt preface. It is the clearest symptom
  of the missing long-lived chat actor.

The command pattern is not the mistake. Treating every executable thing as a
command-shaped promise is. Applying the deletion test to `asCommand()` shows
the lost complexity reappearing in the CLI, session navigation, prompt
injection, and onboarding continuation code. The replacement must deepen the
execution module: one small invocation interface selects the correct actor
semantics while hiding dispatch, policy, correlation, persistence, and output
mapping behind that seam.

## Frozen Architectural Invariants

These invariants are the acceptance boundary for design and code review. Any
implementation that violates one requires an explicit ADR change rather than a
local workaround.

1. A workflow run is an XState state-machine actor with a durable identity and
   a persistable snapshot; it need not remain in memory while waiting.
2. A workflow step is a state, compound state, or invoked actor.
3. A command is bounded asynchronous work represented by a promise actor.
4. A multi-turn chat is an invoked child machine actor.
5. A durable question or human wait is an explicit stable machine state with
   typed accepted response events; the active UI renders it, and it is not a
   second chat runtime or a promise that must hold a request open.
6. The child chat owns its chat-specific system prompt for its full lifetime.
7. The workflow engine does not interpret the chat system prompt.
8. Definition-of-done checks are executable, server-side, typed, repeatable,
   and independent of the agent's claim that work is complete.
9. Asynchronous definition-of-done checks are invoked actors, not XState
   guards.
10. XState guards synchronously choose transitions using data already present
    in context or an event.
11. `/return` sends a return-attempt event to the active child workflow actor.
12. An unsuccessful return attempt keeps the same child actor and session
    active and injects actionable system feedback.
13. A successful return attempt moves the child to a top-level final state.
14. A child workflow produces typed output only when it reaches its final
    state.
15. The parent receives child output through `invoke.onDone`, stores it in
    parent context, and chooses the next transition.
16. Child workflows return reusable output and do not know which parent step
    runs next.
17. `/exit` closes the current UI without falsely completing or cancelling the
    workflow.
18. `/cancel` explicitly cancels the active workflow according to its
    cancellation policy.
19. Session navigation and workflow completion are related but distinct
    concepts.
20. The service owns workflow, actor, chat, session, and handoff semantics.
21. CLI, Web, VS Code, and API adapters only send events and project typed
    runtime events.
22. The TUI never contains onboarding-specific transitions or business rules.
23. Persisted XState snapshots are the source of truth for active workflow
    state.
24. Persistence includes invoked child actors and supports process restart.
25. Existing bounded workflows continue to work through a compatibility
    `run()` convenience wrapper built on the persistent actor lifecycle.
26. There is one chat runtime and one workflow runtime; onboarding must not
    introduce another chat loop.
27. Workflow definitions, actor inputs, actor outputs, and persisted context
    must remain JSON-serializable.
28. Workflow definition versions must be recorded with persisted snapshots.
29. Side-effecting finalization must be idempotent and revision-aware.
30. The end-to-end actor lifecycle test is the release gate for the engine.
31. Every executable remains an `ICommand` and may be exposed through its
    existing metadata as a CLI command, slash command, LLM tool, or workflow
    step.
32. A workflow command invoked from another workflow remains an `ICommand`, but
    its actor-backed capability is invoked as a child machine instead of
    flattening the child through `execute(): Promise`.
33. A workflow command selected by an LLM tool call remains a child workflow
    actor and returns its output to the originating tool-call correlation.
34. There is one command registry and one command-dispatch policy path. Do not
    introduce a parallel workflow-target registry.
35. The deepest active interactive actor owns user input. Parent actors wait
    until that child completes, cancels, or takes an explicitly defined back
    transition.
36. There is exactly one top-level workflow engine implementation registered at
    runtime. Migration replaces adapters behind its seams; it never runs a
    legacy engine and a new engine side by side.
37. The existing event-driven UI architecture remains authoritative. Actor
    lifecycle is projected into typed runtime events consumed by both TUI and
    Web; actors never call UI implementations.
38. All host dependencies and swappable adapters resolve through the existing
    dependency-injection container.
39. Package responsibilities remain unchanged: core contains UI-free
    interfaces/contracts, service owns orchestration and XState, infrastructure
    implements persistence/provider/file adapters, API packages translate
    transport, and UI packages render events and send intents.

## Canonical Terminology

- **Workflow definition**: Serializable description compiled into actor logic.
- **Workflow run**: One live or persisted actor instance created from a
  definition and input.
- **Parent workflow**: Actor that invokes another workflow or chat actor.
- **Child chat actor**: Multi-turn state-machine actor invoked by a parent
  state.
- **Chat system prompt**: The actual LLM system message attached to one child
  chat for every turn of its lifetime.
- **Definition of done**: Executable check that returns whether the child may
  finish and provides unmet conditions and evidence.
- **Finalizer**: Idempotent command or actor that constructs and validates the
  typed child output after definition of done succeeds.
- **Child output**: Typed value emitted only when the child reaches its final
  state.
- **Parent transition**: The parent's `invoke.onDone` transition that consumes
  child output and moves to its next state.
- **Return attempt**: `/return` event sent to the active child actor.
- **Workflow feedback**: System-level feedback from a failed completion check;
  it is not persisted as a human-authored message.
- **Workflow snapshot**: JSON-serializable persisted XState actor snapshot.

## Target XState Model

The parent onboarding machine invokes the CEO chat machine while it is in the
`definingBusiness` state:

```text
onboarding
├─ configuringLlm
├─ creatingCeo
├─ definingBusiness
│  └─ invoke businessChat
│     ├─ conversing
│     ├─ checkingCompletion
│     ├─ finalizing
│     └─ complete (final)
├─ selectingHr
├─ creatingHr
├─ configuringHr
├─ planningHiring
│  └─ invoke hiringChat
│     ├─ conversing
│     ├─ checkingCompletion
│     ├─ finalizing
│     └─ complete (final)
└─ complete (final)
```

`/return` while the CEO child is active produces:

```text
RETURN_ATTEMPT
  → checkingCompletion
  → invoke business-definition checker
  → checker result
      ├─ incomplete
      │  → assign unmet conditions and evidence
      │  → conversing
      └─ complete
         → finalizing
         → invoke idempotent finalizer
         → complete
         → child output
         → parent invoke.onDone
         → selectingHr
```

The checker must treat unmet business conditions as an ordinary domain result,
not a thrown runtime error. Infrastructure failures use `onError`; incomplete
business work uses a guarded `onDone` branch.

## Proposed Workflow Definition Surface

The durable definition should make the common case concise while retaining
typed extension points:

```ts
{
  kind: 'chat',
  id: 'business-definition',
  agentId: '${hire_ceo.agentId}',

  chat: {
    systemPrompt: '${prepare.businessChatSystemPrompt}',
    toolPolicy: {
      allow: [
        'com_ask',
        'docs_write',
      ],
    },
  },

  done: {
    command: 'business-check_definition',
    args: {
      sessionId: '${$chat.sessionId}',
      documentPath: '.ai-team/business.md',
    },
  },

  finalize: {
    command: 'business-finalize_definition',
    args: {
      completion: '${$done}',
    },
  },

  result: {
    businessDefinition: '${$output.businessDefinition}',
    summary: '${$output.summary}',
    documentPath: '${$output.documentPath}',
    approvedAt: '${$output.approvedAt}',
  },
}
```

The exact property names remain subject to the ADR and type-design phase, but
the semantic separation is fixed:

- `chat` configures the invoked multi-turn chat.
- `done` checks whether it may complete.
- `finalize` produces typed output.
- `result` maps child output into parent workflow state.
- the parent workflow definition determines the following step.

## Preserving the Command Pattern

Keep `ICommand`, `CommandDispatcher`, command descriptors, Zod parameter
validation, execution-context binding, tool naming, permissions, confirmation,
and structured `CommandResponse`. Every executable continues to be registered
and discovered as one `ICommand`. Its existing `availableIn` metadata decides
whether it appears as a CLI command, chat slash command, LLM tool, or workflow
step.

Do not add a second workflow registry and do not import XState into
`packages/core`. Define a service-local branded extension of `ICommand` that
exposes the workflow definition while preserving ordinary `execute()`:

```ts
// packages/service/src/workflow/workflow-command.ts
const workflowCommand = Symbol('workflow-command');

interface IWorkflowCommand<
  TParams = unknown,
  TResult = unknown
> extends ICommand<TParams, TResult> {
  readonly [workflowCommand]: true;
  readonly definitionId: string;
  readonly definitionVersion: string;
  getDefinition(): WorkflowDefinition<unknown>;
}

function isWorkflowCommand(command: ICommand): command is IWorkflowCommand {
  return (command as Partial<IWorkflowCommand>)[workflowCommand] === true;
}

// Both adapters live in service and are resolved by DI.
interface ICommandActorAdapter {
  supports(command: ICommand): boolean;
  toActorLogic(
    command: ICommand,
    prepared: PreparedCommandInvocation
  ): AnyActorLogic;
}
```

The symbol/type guard is illustrative but preferred because it is explicit and
keeps XState out of the core `ICommand` interface. The same command object stays
in the same `ICommandRegistry`; the service invocation module discovers whether
it is:

- an ordinary command adapted to `fromPromise(command.execute(...))`; or
- an actor-backed command, such as a workflow, whose machine logic is invoked
  directly as the child.

`WorkflowRunnerFactory.asCommand(definition)` remains the canonical way to make
a workflow available everywhere. It returns one branded `IWorkflowCommand`
which is still assignable to `ICommand`, with both:

- the existing `execute()` compatibility behavior for bounded direct callers;
  and
- an actor capability used whenever an XState parent invokes it as a workflow
  step or workflow tool.

| Caller | Registered object | Internal XState representation | Completion |
| --- | --- | --- | --- |
| CLI or slash | `ICommand` | promise actor or actor-backed workflow command | normal response, active run reference, or final output |
| workflow state | `ICommand` | promise actor for ordinary command | command `onDone` |
| workflow state | actor-backed `ICommand` | invoked child machine | child final output through `onDone` |
| chat tool call | `ICommand` | promise actor for ordinary command | correlated tool result |
| chat tool call | actor-backed `ICommand` | invoked/spawned child machine | correlated child output |

Parameter binding, context defaults, policy, confirmation, and Zod validation
still run through `CommandDispatcher` exactly once before either adapter starts.
No command implementation needs to know which UI or caller selected it.

This deepens the existing command module instead of replacing it. The deletion
test must hold: removing the invocation adapter would force actor selection,
correlation, persistence, and cancellation back into every workflow and chat
caller. Keeping it concentrates those rules in one place while preserving the
small `ICommand` interface all surfaces already understand.

## Chat-Initiated Subworkflows

A multi-turn chat must be able to call a workflow through the same LLM tool
catalog used for commands. The tool may look uniform to the model, but the
runtime must not flatten it into `ICommand.execute()`.

### Preferred finite-catalog compilation

At chat-actor construction time, resolve every workflow exposed by its tool
policy and register each compiled workflow machine as a named actor source.
Compile a guarded target state for each workflow. Because the available set is
finite and versioned, XState `invoke` owns each selected child's lifecycle and
provides native `onDone`, `onError`, cancellation-on-state-exit, and deep
persistence.

```text
chat
├─ waitingForUser
├─ generatingTurn
├─ runningCommand
├─ selectingSubworkflow
├─ runningSubworkflow
│  ├─ hireTeam      → invoke hireTeamMachine
│  ├─ reviewPlan    → invoke reviewPlanMachine
│  └─ ...
├─ integratingToolResult
├─ checkingCompletion
└─ complete (final)
```

When the model emits a workflow tool call:

1. Validate tool name, args, policy, and confirmation through the shared
   invocation-preparation path.
2. Persist the originating `toolCallId`, target workflow ID/version, typed
   input, and call depth in chat context.
3. Transition to the matching `runningSubworkflow.<workflowId>` state.
4. Invoke the child machine with typed input plus parent run, actor, session,
   and tool-call correlation.
5. Route UI input to the deepest active interactive child while the chat actor
   waits. The child may itself invoke commands, chat actors, or deeper
   workflows.
6. On child final output, map the output to the original tool result, append it
   exactly once, and transition the same chat actor back to
   `generatingTurn`.
7. On child failure or cancellation, produce one structured correlated tool
   outcome and let the chat machine's authored transitions decide whether to
   retry, continue, or fail.

If workflow targets truly cannot be known when the chat machine is compiled,
prototype a dynamic spawned-child variant. A spawned child must use explicit
parent messages containing `toolCallId`, child run ID, status, and typed output.
Do not fall back to awaiting `workflowRunner.run()` inside a promise actor.
Choose the dynamic variant only if it proves deep snapshot restore,
cancellation, duplicate-event safety, and completion correlation. The official
XState guidance favors invocation for the finite known catalog and spawning for
a dynamic or unknown number of actors.

### Nested interaction and navigation rules

- The active interaction cursor points to the deepest actor currently waiting
  for human input.
- `/return` is delivered to that actor as a completion attempt. Its
  definition-of-done may reject it and keep the actor active.
- A successful `/return` completes only that child. Its parent then regains
  control through authored output and transitions.
- `/back` is a navigation request to the calling actor, not proof of completion.
  It is legal only when the child definition declares a back/abandon
  transition; otherwise the runtime explains why it cannot leave.
- Parent chat history and system prompt remain intact while a subworkflow is
  active. Only the child's typed final output becomes the tool result.
- Workflow calls carry a maximum depth and an invocation ancestry. Reject
  direct or indirect cycles that exceed policy with a structured tool error.
- One chat may have only the authored number of active workflow tool calls.
  Initial implementation supports one foreground child; parallel fan-out is a
  later explicit machine design, not an accidental `Promise.all`.
- Exiting the TUI detaches presentation and checkpoints the root actor tree; it
  does not complete the child or fabricate a tool result.

## Runner Lifecycle Contract

The runner must expose a durable handle without breaking bounded callers.
Public event delivery must acknowledge persistence; raw synchronous
`actor.send()` remains an implementation detail:

```ts
interface WorkflowRunHandle<TOutput> {
  readonly id: string;
  dispatch(event: WorkflowEvent): Promise<WorkflowRunView<TOutput>>;
  getSnapshotView(): WorkflowSnapshotView<TOutput>;
  getPersistedSnapshot(): PersistedWorkflowSnapshot;
  getStatus(): WorkflowRunStatus;
  waitForDone(): Promise<TOutput>;
  checkpoint(): Promise<PersistedWorkflowSnapshot>;
  cancel(reason: string): Promise<WorkflowRunView<TOutput>>;
}

interface IWorkflowRunner {
  start<TInput, TOutput>(
    definition: WorkflowDefinition<TInput, TOutput>,
    input: TInput,
    options?: WorkflowRunOptions
  ): Promise<WorkflowRunHandle<TOutput>>;

  restore<TOutput>(
    runId: string
  ): Promise<WorkflowRunHandle<TOutput>>;

  run<TInput, TOutput>(
    definition: WorkflowDefinition<TInput, TOutput>,
    input: TInput,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TOutput>>;
}
```

`run()` starts a handle and awaits `waitForDone()`. It remains a convenience
interface for short workflows, not the canonical lifecycle. UI attachment and
detachment live outside the handle: closing a UI must neither call
`actor.stop()` as a business transition nor imply workflow cancellation.

## Persistence Model

Use the existing `.ai-team/private/ai-team.db` runtime store. Do not introduce a
second workflow-state directory or adapter-specific persistence.

The persistence design must record at least:

- workflow run ID;
- workflow definition ID and version;
- workflow status (`active`, `completed`, `cancelled`, `failed`);
- root session or thread association;
- active child session association;
- persisted XState actor snapshot;
- typed input and completed output where applicable;
- latest event or snapshot sequence;
- created, updated, completed, and cancelled timestamps;
- structured failure metadata;
- migration/version compatibility metadata.

Persist the complete root actor snapshot using XState's persisted-snapshot
mechanism so invoked child actors restore recursively. Do not manually
reconstruct child state from a collection of loosely related booleans.

Use `getPersistedSnapshot()`, not the emitted snapshot from `getSnapshot()`.
Persist only JSON data and stable domain IDs in machine context. Actor
references, containers, database clients, question handlers, emitters,
AbortControllers, commands, and functions are host dependencies supplied when
the machine is created or restored.

XState restores active invocations by restarting them. Therefore:

- every command actor receives a deterministic idempotency key derived from run
  ID, actor path, step ID, and attempt;
- an operation journal records started/completed side-effect attempts where
  duplicate external effects would be unsafe;
- finalizers use revision or compare-and-set semantics;
- restore tests deliberately terminate after an external effect but before the
  following snapshot write;
- the chat actor persists at stable waiting states with no model request in
  flight whenever it awaits the developer;
- definition and exposed-tool-catalog versions are checked before restore.

Root subscriptions alone may not reveal every child transition. Attach XState
inspection at the root actor system, observe child snapshot/event activity, and
schedule an ordered root `getPersistedSnapshot()` checkpoint after the
macrostep. Inspection drives diagnostics and checkpoint scheduling; it does
not become a second source of workflow truth.

Snapshot writes must be:

- serialized through one service-owned repository;
- ordered to avoid stale snapshots overwriting newer snapshots;
- atomic with workflow/session association updates where practical;
- resilient to duplicate events;
- safe for process termination between transitions;
- observable through structured logs and diagnostics.

The first release uses snapshots as the canonical durable state plus a small
operation/event ledger for idempotency and audit. Full event sourcing is a
non-goal unless snapshot-version migration proves insufficient.

## Session and Workflow Association

Every session participating in an active child workflow must resolve:

```ts
{
  workflowRunId: string;
  childActorId: string;
  workflowStepId: string;
  workflowDefinitionId: string;
}
```

This association allows `/return`, `/cancel`, bare `ait chat`, WebSocket resume,
and IDE resume to locate the correct actor without placing actor references in
transport payloads or persisted JSON.

Store the active-interaction cursor as an actor path/correlation path relative
to the workflow run, not an XState runtime object. The path is updated by the
actor host after inspected transitions and resolves to the deepest waiting
actor after restoration.

Session navigation must not implicitly complete a workflow. Returning from a
handoff session may restore the active workflow session, while completing a
child workflow requires its declared definition-of-done and finalizer path.

## Business Definition Completion Contract

The CEO business-definition checker must verify evidence rather than trusting
conversation prose:

```ts
type BusinessDefinitionCheck = {
  done: boolean;
  unmet: Array<{
    code: string;
    message: string;
  }>;
  evidence?: {
    documentPath: '.ai-team/business.md';
    documentRevision: string;
    meaningfulLength: number;
    requiredSections: string[];
    approvalMessageId: string;
    approvalTimestamp: string;
    evaluationRevision: string;
  };
};
```

Completion requires all of the following:

- `.ai-team/business.md` exists;
- the document meets a configurable meaningful-length threshold;
- required sections are present and non-trivial;
- the definition contains a problem statement;
- primary target users are identified;
- the value proposition is explicit;
- at least three measurable success criteria exist;
- constraints and non-goals are recorded;
- a structured quality evaluator finds no blocking gaps;
- the developer explicitly approves the current document revision;
- approval occurs after the latest material document update;
- the finalizer reads the same document revision that passed validation.

The CEO chat system prompt must clearly push toward every condition, ask one
focused question at a time, update the artifact as decisions stabilize, run the
checker, resolve its feedback, present the current document, obtain explicit
approval, and call `/return` only when ready.

## Hiring Completion Contract

The HR hiring child must receive the CEO child output as actor input. Its
definition of done verifies persisted organization state:

```ts
type HiringCheck = {
  done: boolean;
  unmet: Array<{
    code: string;
    message: string;
  }>;
  headOfDevelopment?: {
    agentId: string;
    name: string;
    canonicalRole: 'head-of-development';
    reportsTo: string;
    active: true;
    permissionsValid: true;
  };
};
```

Completion requires:

- at least one active Head of Development or explicitly approved equivalent;
- a canonical capability/role mapping rather than an arbitrary title match;
- the required reporting relationship to the CEO;
- required permissions persisted and loaded;
- the role's responsibility for technical delivery recorded;
- the developer's explicit confirmation of the selected hire;
- the finalizer returning the hired agent identity and hiring summary.

An early `/return` reports the unmet hiring conditions back to the same HR chat
as system-level workflow feedback.

## UI and Interaction Behavior

The UI must remain continuous while actors and parent states change:

- the same TUI renders CEO chat, completion feedback, HR selection questions,
  agent-creation progress, HR chat, and final completion;
- durable workflow questions compile to waiting states with typed interaction
  metadata and accepted response events; the current `com_ask` implementation
  remains a bounded-command adapter until those definitions migrate;
- parent-workflow questions are rendered in the active TUI, not messages
  pretending to come from the CEO;
- actor and workflow lifecycle events identify the current workflow, step,
  actor, agent, and session;
- a failed return attempt renders actionable feedback and leaves the composer
  attached to the same child chat;
- a successful child completion transitions presentation only after the
  service emits the parent transition and next interaction;
- adapters never decide the next workflow step;
- Web, CLI, VS Code, and API clients consume the same service event model.

## In-Place Migration and Swappable Seams

There must never be a `workflow-v2`/`workflow-v3`, legacy/new runner pair, or
second chat engine. Refactor the current `WorkflowRunner` in place and keep one
container token bound to one implementation throughout.

The engine is still small enough to make this safer than a strangler migration.
First extract narrow collaborators from the existing implementation without
changing behavior; then replace one DI binding at a time:

```text
IWorkflowRunner                 one public engine, always
├─ IWorkflowDefinitionCompiler  definition → XState actor logic
├─ ICommandInvocationAdapter    ICommand → promise or child-machine actor logic
├─ IWorkflowActorHost           start, restore, dispatch, checkpoint
├─ IWorkflowRunRepository       durable run/snapshot records
├─ IWorkflowInteractionRouter   session/input → deepest waiting actor
└─ IWorkflowEventProjector      inspection/snapshots → existing runtime events
```

Migration rules:

- extract each interface around the code that already runs before changing its
  implementation;
- pin existing behavior with contract/characterization tests at that interface;
- provide at most one production adapter per interface at a time;
- switch the container binding only after old and new adapter contract tests
  pass against the same fixtures;
- keep rollback at the adapter binding or commit level, never by retaining a
  second top-level engine;
- do not introduce a permanent feature flag that chooses between engines;
- do not fork workflow definitions into old/new formats;
- do not change UI adapters while actor-host work is in progress unless an
  additive runtime event contract is required;
- keep incomplete new actor step kinds unreachable from production definitions
  until their vertical slice passes;
- land cleanup in the same slice that switches the final caller, so abandoned
  bridges cannot become a second runtime.

### DI and package placement

- `packages/core`: UI-free command, execution-context, and repository
  interfaces only; no XState implementation and no UI event rendering.
- `packages/service`: the single workflow runner, compiler, actor host,
  invocation adapters, interaction router, and event projector. It depends on
  interfaces and container tokens, not concrete infrastructure.
- `packages/infrastructure`: SQLite/run-repository adapter and other external
  persistence/provider/file implementations.
- `packages/api-contracts` and `packages/api-server`: additive typed workflow
  event/intent transport and translation.
- `packages/cli`, `packages/tui`, `packages/web`, and `packages/vscode`:
  presentation and user intent only. They do not resolve actor logic or choose
  transitions.

The existing event-driven UI path stays intact:

```text
XState inspection/snapshot
→ service IWorkflowEventProjector
→ existing IEmitService/runtime event stream
→ CLI TUI or API/WebSocket
→ TUI/Web rendering

user input or slash intent
→ existing command/API entry
→ service interaction router
→ active actor event
```

Actor events must be additive to the existing runtime event vocabulary until
both UIs support them. TUI and Web receive identical semantic events; layout
and interaction widgets remain UI-specific.

## Implementation Playbook

This section is intentionally explicit enough for a weaker implementation
model. Names may change during the ADR, but each responsibility and forbidden
shortcut is fixed.

### Expected file ownership

Prefer these focused extractions over a second engine:

| File/module | Responsibility |
| --- | --- |
| `packages/service/src/workflow/xstate-workflow-runner.ts` | Keep the one public runner/factory and compatibility `run()` |
| `packages/service/src/workflow/workflow-definition-compiler.ts` | Compile definitions and resolved command capabilities into one XState machine |
| `packages/service/src/workflow/workflow-command.ts` | Branded service-local `IWorkflowCommand`, type guard, and `asCommand()` adapter |
| `packages/service/src/workflow/command-actor-adapter.ts` | Wrap ordinary `ICommand.execute()` with `fromPromise` |
| `packages/service/src/workflow/workflow-command-actor-adapter.ts` | Compile a branded workflow command into child machine actor logic |
| `packages/service/src/workflow/workflow-actor-host.ts` | Start, restore, dispatch, inspect, checkpoint, cancel, and await the root actor |
| `packages/core/src/types/runtime-contracts.ts` | XState-free run, snapshot-envelope, repository, and interaction contracts only |
| `packages/infrastructure/src/workflow/*` | Durable workflow-run repository adapter and schema migration |
| `packages/service/src/workflow/workflow-interaction-router.ts` | Resolve session/run to the deepest waiting actor and deliver typed events |
| `packages/service/src/workflow/workflow-event-projector.ts` | Translate actor inspection/snapshots into existing `IEmitService` events |
| `packages/service/src/registration/register-service-layer-services.ts` | Bind exactly one adapter for each workflow seam |
| `packages/api-contracts/src/contract/routers/streaming.ts` | Additive transport-safe workflow interaction/lifecycle event shapes |
| `packages/service/src/workflow/chat/*` | Reuse current turn commands inside the durable chat machine; do not create another chat implementation |

Confirm exact paths during inventory. Do not move implementation into `core`,
API packages, or UIs merely to match this table.

### Example 1: workflow remains the same `ICommand`

Correct:

```ts
const command = workflowRunnerFactory.asCommand(definition);
commandRegistry.register(command);

// CLI, slash, and tool discovery see a normal ICommand.
command.metadata.availableIn;

// The workflow compiler resolves that same object from the same registry.
const actorLogic = commandActorAdapters
  .find((adapter) => adapter.supports(command))
  ?.toActorLogic(command, preparedInvocation);
```

Wrong:

```ts
commandRegistry.register(command);
workflowRegistry.register(definition); // forbidden second source of truth
```

### Example 2: nested workflows must not be flattened

Wrong:

```ts
fromPromise(() =>
  commandDispatcher.dispatch('hire-workflow', args, context)
);
```

That calls `IWorkflowCommand.execute()`, waits on `workflowRunner.run()`, and
hides the child actor from the parent.

Correct compiler shape:

```ts
const command = commandResolver.resolve(step.command);
const prepared = commandInvocationPreparer.prepareKnown(step, command);
const actorLogic = commandActorAdapterResolver
  .resolve(command)
  .toActorLogic(command, prepared);

actors[`step:${step.id}`] = actorLogic;
states[step.id] = {
  invoke: {
    id: step.id,
    src: `step:${step.id}`,
    input: ({ context }) => resolveInput(step, context),
    onDone: {
      target: nextStepId,
      actions: assignChildOutput(step),
    },
    onError: { target: '#failed', actions: assignFailure(step) },
  },
};
```

For an ordinary command the adapter returns `fromPromise`. For a branded
workflow command it returns the compiled child machine. The parent state shape
does not change.

### Example 3: durable human input is an event

Wrong:

```ts
invoke: {
  src: fromPromise(() => questionService.input(...))
}
```

That holds a host request open and cannot safely restore in another process.

Correct:

```ts
awaitingCeoName: {
  tags: ['waiting-for-human'],
  meta: {
    interaction: {
      kind: 'input',
      prompt: 'What should we call your CEO?',
      responseEvent: 'CEO_NAME.SUBMITTED',
    },
  },
  on: {
    'CEO_NAME.SUBMITTED': {
      guard: 'validCeoName',
      target: 'creatingCeo',
      actions: 'assignCeoName',
    },
  },
}
```

The event projector emits the interaction. TUI or Web renders it and sends the
typed response event through the normal transport. The actor can be stopped,
restored from its persisted snapshot, and then receive the response.

### Example 4: chat invokes a workflow command as a tool

```text
LLM emits toolCall { id: tc-7, name: hr_hire, args: ... }
→ resolve normal ICommand `hr_hire`
→ run normal dispatcher preparation/policy/validation
→ detect branded workflow capability on that ICommand
→ persist tc-7 + child input + actor path
→ chat enters runningSubworkflow.hr_hire
→ invoke child workflow actor
→ child waits/receives UI events/finishes
→ parent receives typed onDone output
→ append one tool result for tc-7
→ same chat actor continues generatingTurn
```

Wrong: call `command.execute()` and leave a promise pending while the child
waits for multiple user turns.

### Example 5: event-driven UI projection

Correct:

```ts
createActor(machine, {
  inspect: (event) => {
    checkpointScheduler.observe(event);
    workflowEventProjector.project(event, emitService);
  },
});
```

The projector emits transport-neutral events such as:

```ts
type WorkflowRuntimeEvent =
  | {
      kind: 'workflow_state';
      runId: string;
      actorPath: string;
      state: string;
      status: 'active' | 'waiting' | 'done' | 'failed';
    }
  | {
      kind: 'workflow_interaction';
      runId: string;
      actorPath: string;
      interactionId: string;
      interaction: WorkflowInteraction;
    }
  | {
      kind: 'workflow_child';
      runId: string;
      actorPath: string;
      childRunId: string;
      phase: 'started' | 'completed' | 'failed' | 'cancelled';
      toolCallId?: string;
    };
```

Wrong: import TUI/Web question handlers into the workflow runner or let a UI
infer the next state from text.

### Example 6: DI composition and safe swapping

First extraction commit:

```ts
container.register(
  TOKENS.WorkflowActorHost,
  (c) => new CurrentBehaviorWorkflowActorHost(/* existing logic */)
);
```

After the durable adapter passes the same contract suite, change only the
binding:

```ts
container.register(
  TOKENS.WorkflowActorHost,
  (c) => new DurableWorkflowActorHost(
    c.resolve(TOKENS.WorkflowRunRepository),
    c.resolve(TOKENS.WorkflowEventProjector)
  )
);
```

Delete `CurrentBehaviorWorkflowActorHost` in the same slice. Do not keep a
runtime flag or route some workflows to each host.

### Mandatory adapter contract suite

Every host/adapter implementation must run the same tests:

- ordinary command input is prepared and executed once;
- command `ok`, `error`, and `cancelled` map identically;
- parent workflow invokes a child workflow and receives typed output;
- parent cancellation stops its invoked child;
- child failure reaches the authored parent transition;
- a waiting interaction survives JSON snapshot round-trip;
- restored active invocations use the same idempotency key;
- inspection projects the same semantic event sequence;
- CLI/slash/tool/workflow availability and parameter behavior do not change;
- no test container resolves more than one implementation for the same seam.

### Commit sequence

Each commit must build and leave `ait` runnable:

1. Add characterization tests and the ADR; no production behavior change.
2. Extract the definition compiler from the current runner; same snapshots and
   results.
3. Extract the current actor host and event projector behind DI; bind only the
   extracted current behavior.
4. Add the branded workflow-command capability and two actor adapters; switch
   nested workflow steps while all command surfaces still resolve `ICommand`.
5. Add durable run repository/checkpoint/restore to the same host; replace and
   delete the temporary current-behavior adapter in that slice.
6. Add stable waiting states and the interaction router; project additive
   events to both UI paths.
7. Convert the existing chat runtime into the durable child machine while
   reusing its current step commands.
8. Add chat-initiated workflow command invocation and correlation.
9. Migrate onboarding, then delete `workflow-phase.ts` and prompt-preface/init
   continuation workarounds.
10. Update architecture/composition docs and run the complete release gate.

If any commit cannot keep current bounded workflows and both UI event streams
working, stop at the last green commit and fix that seam. Do not continue by
adding a compatibility engine.

## Delivery Slices and Stop Gates

Each slice must leave the existing runtime usable and pass its gate before the
next slice starts. This avoids another broad workflow-engine rewrite whose
behavior can only be tested at the end.

### Slice 0: architecture contract and executable spike

- Record the actor/command/chat/wait/output invariants in one ADR.
- Build a test-only parent machine that invokes a multi-turn child, rejects one
  completion attempt, persists, restores, completes, and returns typed output.
- Build a test-only chat actor that selects a known workflow as a tool, invokes
  it, survives restore while the child waits, and correlates final output back
  to the original tool call.
- Compare finite-catalog invocation with dynamic spawning and record the chosen
  strategy.

Gate: no production migration until the spike proves deep restore,
idempotency-key propagation, cancellation, child output, and tool-call
correlation on XState 5.30.

### Slice 1: durable actor host

- Extract compiler and actor-host interfaces from the current
  `xstate-workflow-runner.ts` with characterization tests and no behavior
  change.
- Move the current ephemeral actor creation behind the extracted host, while
  retaining the same `WorkflowRunner` and container token.
- Add the run repository, start/restore/dispatch lifecycle,
  inspection-driven checkpointing, definition versions, and active-interaction
  cursor behind those seams.
- Rebuild existing bounded `run()` on the same host.

Gate: all current bounded workflow tests remain green, and a process-restart
test restores the test child actor. Only one workflow runner implementation is
registered before and after the slice.

### Slice 2: actor-backed `ICommand` capability

- Add command invocation adapters behind DI without adding another registry.
- Preserve `ICommand`, `asCommand()`, command descriptors, availability flags,
  and dispatcher behavior.
- Make workflow commands expose actor logic to XState parents while ordinary
  commands remain promise actors.
- Change nested workflow compilation to select the actor capability from the
  same resolved `ICommand`.

Gate: command, slash, and LLM-tool parameter tests remain green; nested workflow
tests prove native child output and cancellation while resolving the same
`ICommand` used by CLI/slash/tool callers.

### Slice 3: durable chat actor and interactions

- Lift multi-turn lifecycle out of request loops into one state-machine actor.
- Install scoped system prompt and tool policy as actor input.
- Compile durable questions and completion attempts as states/events.
- Project actor interaction events into the existing TUI/Web stream.

Gate: the same chat session accepts turns across separate requests and restart,
and early `/return` is rejected without changing actor/session identity.

### Slice 4: chat-initiated subworkflows

- Expose workflow descriptors in the chat tool catalog.
- Invoke the selected child machine, route nested interactions, and correlate
  final output to the model tool call.
- Add depth, cycle, cancellation, failure, and duplicate-result policies.

Gate: a chat invokes a child workflow containing both a command and a waiting
state, restarts while waiting, completes it, and continues the same model
conversation with exactly one tool result.

### Slice 5: onboarding vertical slice

- Migrate CEO business definition, HR selection/creation, and HR hiring to the
  new primitives.
- Prove the business artifact/revision/approval checks and Head of Development
  invariant.

Gate: the disposable-repository release scenario passes through restarts in CEO
and HR phases.

### Slice 6: cleanup and documentation

- Delete the manual workflow phase and obsolete continuation/prompt-preface
  paths.
- Correct workflow composition documentation and all architecture references.
- Remove compatibility adapters only when no caller remains.

Gate: no onboarding logic exists in UI adapters, no interactive
`IWorkflowCommand` is flattened through its promise-based `execute()` path when
invoked by an actor parent, and the full verification matrix passes.

## Compatibility and Migration Strategy

Do not perform another big-bang replacement.

1. Add `start()` and persistent handles beside the existing `run()`.
2. Reimplement `run()` on top of the handle and retain existing tests.
3. Add the chat child primitive without migrating existing workflows.
4. Prove a small test machine can persist, restore, reject return, and complete.
5. Migrate onboarding as the first production consumer.
6. Remove onboarding-specific compatibility code only after parity passes.
7. Migrate other long-running or nested workflows incrementally.
8. Keep bounded command workflows on `run()` unless actor control is needed.

The migration must coordinate with:

- `.ai-team/tasks/repair-cli-tui-refactor.md`;
- `.ai-team/tasks/structured-workflow-error-messaging.md`;
- `.ai-team/tasks/unified-tui-placement.md`.

This plan supersedes and deletes
`.ai-team/tasks/v2-legacy-removal-workflow-unification.md`. It is the only task
that owns workflow actor lifecycle, nested workflow composition, and removal of
the legacy flattening adapters. The three coordinated tasks above retain their
focused presentation and error-rendering scope.

## Transitional Code Policy

During migration:

- do not add new onboarding-specific branches to the CLI or TUI;
- do not add another manual input loop;
- do not add another workflow/session state store;
- do not encode required parent transitions only in an LLM prompt;
- do not expose continuation tokens as a substitute for a live actor unless
  they are an opaque reference to persisted actor state;
- do not delete compatibility code before the vertical-slice acceptance test
  passes;
- clearly mark temporary compatibility adapters and list their deletion gate;
- retain unrelated fixes such as Git branch discovery and permission-cache
  refresh when they are independently correct.

Expected obsolete code includes:

- `packages/service/src/commands/hr/workflow-phase.ts`;
- init-specific CLI chat handoff orchestration;
- workflow-specific chat option fields that only simulate child ownership;
- duplicate onboarding continuation paths;
- stale prompt-preface injection code;
- tests that validate simulated chat instead of actor completion.

## Failure, Cancellation, and Recovery Semantics

- Domain incompleteness is a normal result and returns the child to
  `conversing`.
- Infrastructure failure transitions to a recoverable failure state or a
  terminal failed state according to policy.
- A nested workflow failure produces one correlated failure event/tool result;
  it does not disappear inside a rejected command promise.
- `/exit` persists the actor tree and detaches the UI.
- `/cancel` emits an explicit cancellation event and requires confirmation for
  destructive cleanup.
- Process termination persists or recovers the latest committed snapshot.
- Duplicate `/return` events are idempotent.
- A finalizer interrupted after a side effect can safely retry.
- A completed child cannot process further chat turns.
- A completed parent cannot be resumed as active.
- Parent cancellation propagates to active invoked children. Child cancellation
  follows the parent state's authored `onError`/cancel transition and does not
  automatically cancel the parent.
- Late or duplicate child-completion messages are ignored by run ID,
  invocation ID, actor path, and tool-call correlation.
- Definition-version incompatibility produces a structured diagnostic instead
  of silently restarting the workflow.
- Secret values and raw API keys never enter persisted actor context.

## Observability Requirements

Every transition should be diagnosable without logging full prompts or private
conversation content:

- workflow run ID;
- workflow definition ID/version;
- parent and child actor IDs;
- state and step IDs;
- triggering event type;
- session and agent IDs;
- completion-check result codes;
- finalizer attempt and idempotency key;
- snapshot sequence/version;
- transition duration;
- structured failure ID and error metadata.

Use the structured workflow error task for cross-UI presentation. Avoid
duplicating raw errors as both logs and transcript events.

## Verification Strategy

Testing must cover behavior at the actor boundary, not only helper functions.

### Unit coverage

- Compile command, question, loop, nested workflow, and chat definitions into
  the expected actor states.
- Verify asynchronous checks are invoked actors and guards only inspect their
  output.
- Verify failed checks transition back to the same `conversing` state.
- Verify successful checks run the finalizer and reach a final state.
- Verify machine output is typed and available only at completion.
- Verify parent `invoke.onDone` receives and stores child output.
- Verify a workflow step resolves the same `IWorkflowCommand` as other surfaces
  and selects its child-machine actor capability rather than its blocking
  `execute()` compatibility path.
- Verify command targets still execute through the command actor adapter and
  normal dispatcher.
- Verify `run()` remains compatible for bounded workflows.

### Persistence coverage

- Persist and restore a parent while its CEO child is conversing.
- Persist and restore while a completion check is running.
- Persist and restore after a failed return attempt.
- Persist and restore after CEO completion but before HR selection.
- Persist and restore while HR chat is active.
- Persist and restore a chat while its LLM-selected child workflow is waiting
  for human input.
- Prevent stale snapshot overwrites.
- Handle incompatible definition versions.
- Prove secrets are absent from snapshots.

### Integration coverage

- Route `/return` from a session to the correct child actor.
- Render failed completion feedback in CLI and Web without ending the chat.
- Render parent `com_ask` selection inside the same UI after CEO completion.
- Create and configure the selected HR agent through parent workflow commands.
- Pass CEO output as HR actor input.
- Reject HR return until Head of Development exists.
- Complete onboarding after the required hire is persisted.
- Confirm permission changes are effective without restarting the process.
- Invoke a workflow from an ordinary chat tool call, complete its nested
  interaction, and append exactly one correlated tool result before continuing
  the same chat.
- Reject excessive depth and direct/indirect workflow cycles.

### End-to-end release gate

One deterministic test or harness must prove:

```text
empty Git repository
→ ait init
→ configure or reuse LLM
→ choose CEO
→ CEO chat starts with its chat system prompt
→ early /return is rejected
→ business document is created
→ invalid/incomplete document is rejected
→ developer approval is captured
→ /return completes CEO child
→ parent presents HR candidates
→ selected HR agent is created and configured
→ HR child starts with CEO output
→ early /return is rejected
→ Head of Development is selected and created
→ /return completes HR child
→ onboarding parent reaches final state
→ closing and reopening during both chats restores exact progress
```

The release gate must run against a disposable repository outside the ai-team
source workspace and must never initialize or delete the ai-team repository's
own `.ai-team` organization.

## Rollout and Rollback

- Land changes in independently reviewable vertical slices.
- Keep the existing runner facade until all current callers pass.
- Gate onboarding migration behind the new actor implementation rather than a
  permanent dual-runtime feature flag.
- During rollout, log which execution model starts each workflow.
- Rollback must restore the previous onboarding entry without corrupting
  persisted actor snapshots.
- Do not attempt to interpret new snapshots with old code.
- Document snapshot compatibility and migration policy before enabling
  restoration by default.

## Non-Goals

- Rewriting the TUI.
- Replacing the command dispatcher.
- Replacing the session/thread model.
- Moving service orchestration into CLI, Web, or VS Code.
- Inventing a general distributed workflow platform.
- Supporting arbitrary code in serialized workflow definitions.
- Automatically migrating every existing workflow before onboarding proves the
  model.
- Treating LLM self-assessment as authoritative completion evidence.
- Removing explicit human cancellation or exit controls.

## Definition of Done

The stabilization effort is complete when:

- the frozen invariants are documented in an accepted ADR;
- `IWorkflowRunner.start()` returns a persistent run handle;
- existing `run()` callers use the compatibility wrapper and pass;
- workflow runs persist and restore deep XState snapshots;
- the workflow DSL supports invoked multi-turn chat actors;
- the one command registry still serves CLI, slash, tool, and workflow callers;
- service-local command actor adapters preserve ordinary-command versus
  actor-backed-workflow lifecycle;
- command actors reuse `ICommand` and the normal dispatcher;
- `asCommand()` still creates the registered `IWorkflowCommand`, while parent
  actors invoke its child-machine capability instead of flattening it through
  `execute()`;
- chat tool calls can invoke child workflows and resume the same chat with one
  correlated typed result;
- chat system prompts are true system messages scoped to child actor lifetime;
- `/return` attempts the active child completion transition;
- failed completion returns actionable feedback to the same chat;
- successful completion emits typed child output through `invoke.onDone`;
- the parent workflow stores output and advances without adapter logic;
- CEO business definition satisfies artifact, quality, revision, and approval
  checks;
- HR hiring satisfies the Head of Development invariant;
- CLI, Web, VS Code, and API use the same service lifecycle;
- process restart restores active onboarding accurately;
- structured failure and cancellation semantics are covered;
- onboarding-specific workarounds and `workflow-phase.ts` are deleted;
- architecture and implementation documentation are updated;
- targeted package builds, tests, lint, whitespace checks, and duplication scan
  pass;
- the complete disposable-repository end-to-end release gate passes.

## Current Implementation Handoff

The actor foundation is implemented in-place. `WorkflowRunner` starts durable
root actors through `WorkflowActorHost`; `WorkflowInteractionRouter` resolves a
session to its active run and opaque child-interaction cursor; and
`WorkflowOperationJournal` makes chat finalizers idempotent. Workflow-run
records persist root/active sessions and `activeActorPath`; migrations `0005`,
`0006`, and `0007` establish the required storage.

The workflow DSL now supports `chat` and `question` steps. Chat steps invoke
`createWorkflowChatActor`, accept `CHAT_TURN` and `RETURN_ATTEMPT`, run typed
completion/finalizer commands, and apply child output through parent
`invoke.onDone`. Question steps persist typed prompt/options metadata and wait
for an `ANSWER` event. `ReturnChatCommand` routes `/return` to an active child
before falling back to the legacy session-return behavior.

Production chat-turn routing now goes through `WorkflowInteractionRouter` using
the persisted active-interaction cursor, and workflow chat children execute on
the same `chat-chat-direct-turn` runtime/dispatcher path as normal chat turns.
Child prompt/tool scope is installed per turn from child actor input and
removed automatically at child completion. `/return`, `/back`, `/cancel`, and
`/exit` are all routed through durable workflow actor semantics without adding a
second chat engine or workflow-specific UI orchestration branch.

Useful verification baseline:

- `pnpm --filter @ai-team/service test -- src/workflow/xstate-workflow-runner.test.ts src/commands/hr/hire-workflow.test.ts src/commands/hr/onboarding-workflow.test.ts src/workflow/chat/chat-runtime.test.ts src/workflow/chat/command-chat-runtime.test.ts`
- `pnpm --filter @ai-team/core build`
- `pnpm --filter @ai-team/infrastructure build`
- `pnpm --filter @ai-team/service build`
- `pnpm --filter @ai-team/service exec eslint src/workflow/xstate-workflow-runner.test.ts src/commands/hr/hire-workflow.ts src/commands/hr/hire-workflow.test.ts`
- `git --no-pager diff --check`
- `pnpm --filter @aspect/duplication build`
- `node analysis/duplication/dist/cli/fuzzy-dup.js packages/service/src/workflow --format text`

The disposable-repository release-gate scenario is now covered in
`packages/service/src/workflow/xstate-workflow-runner.test.ts` by
`passes the disposable-repository release gate across CEO and HR restarts`,
including early-return rejection, artifact completion, approval gating, HR
selection/hiring progression, and restart continuity across both chats.

## Action Items

- [x] Research official XState v5 actor, invoke, guard, output, persistence, system, and inspection semantics.
- [x] Review Stately Agent child-machine, machine-as-tool, hand-rolled-loop migration, and human-wait patterns.
- [x] Compare durable agent/subworkflow patterns in LangGraph, Dapr Agents, and Mastra.
- [x] Supersede and delete `v2-legacy-removal-workflow-unification` so this plan is the single lifecycle source of truth.
- [x] Write and approve an ADR freezing the workflow/actor/chat/return invariants in this plan.
- [x] Inventory every `IWorkflowRunner.run()` caller and classify it as bounded, nested, interactive, or compatibility-only.
- [x] Inventory every `WorkflowRunnerFactory.asCommand()` caller and classify whether it uses `execute()` directly or is composed by an actor parent.
- [x] Inventory every workflow/session/chat continuation mechanism and identify duplicate sources of truth.
- [x] Capture the current init and onboarding failures in a deterministic disposable-repository harness.
- [x] Add a failing actor-lifecycle acceptance test covering parent invocation, failed return, successful return, and parent continuation.
- [x] Add a failing chat-to-workflow test covering tool-call correlation, nested human input, restart, child output, and resumed chat.
- [x] Prototype finite-catalog invoked workflow states and dynamic spawned workflow actors on XState 5.30.
- [x] Record the invocation-versus-spawn decision, including persistence, cancellation, and versioning evidence, in the ADR.
- [x] Define typed workflow input, output, event, status, snapshot, and run-handle contracts in the correct package boundaries.
- [x] Define the service-local branded `IWorkflowCommand`, its type guard, `PreparedCommandInvocation`, and XState-free core contracts.
- [x] Extract reusable argument binding, policy, confirmation, and validation from `CommandDispatcher` behind the invocation-preparation seam.
- [x] Implement DI-resolved ordinary-command and workflow-command actor adapters without adding a second registry.
- [x] Implement the ordinary-command adapter with `fromPromise`, `AbortSignal`, typed output, and deterministic idempotency keys.
- [x] Implement the workflow-command adapter by compiling the definition exposed by the same registered `ICommand`.
- [x] Add `IWorkflowRunner.start()` without changing existing bounded workflow behavior.
- [x] Implement acknowledged `dispatch()`, snapshot views, persisted snapshots, status, checkpoint, wait-for-done, and cancel on the run handle.
- [x] Reimplement `IWorkflowRunner.run()` as a compatibility wrapper over `start()` and `waitForDone()`.
- [x] Keep `asCommand()` as the one workflow-to-`ICommand` adapter and add its service-local actor capability.
- [x] Make `IWorkflowCommand.execute()` await bounded workflows or start/attach interactive runs without holding a multi-turn promise open.
- [x] Update `WORKFLOW-COMPOSITION.md` so actor parents select the child-machine capability on the same registered `IWorkflowCommand`.
- [x] Extract compiler, actor host, interaction router, and event projector behind DI from the current runner before changing behavior.
- [x] Keep exactly one `IWorkflowRunner` and one production adapter per extracted seam registered in every composition root.
- [x] Delete each temporary current-behavior adapter in the same slice that switches its DI binding.
- [x] Ensure actors are not automatically stopped merely because a UI request ends.
- [x] Define workflow definition IDs and explicit definition versions.
- [x] Version the exposed invocation catalog used to compile chat workflow-tool states.
- [x] Add the persisted workflow-run repository and database migration in `.ai-team/private/ai-team.db`.
- [x] Persist ordered root actor snapshots with concurrency protection against stale writes.
- [x] Trigger coalesced root checkpoints from whole-system inspection when child actors advance.
- [x] Add an operation journal for restart-sensitive side effects and finalizers.
- [x] Restore root actors from persisted snapshots, including invoked children.
- [x] Add workflow-run/session/child-actor associations.
- [x] Add the persisted deepest-active-interaction cursor using stable actor/correlation paths.
- [x] Add service APIs to resolve the active workflow actor from a session.
- [x] Define the generic invoked-chat DSL contract with chat config, done checker, finalizer, and result mapping.
- [x] Compile invoked-chat definitions into child XState machines with `conversing`, `checkingCompletion`, `finalizing`, and final states.
- [x] Represent durable human questions as stable states with typed interaction metadata and accepted response events.
- [x] Ensure the chat system prompt is installed as a true system message on every child-chat turn.
- [x] Scope chat tool policy to the child actor and remove it after child completion.
- [x] Route normal chat messages to the active child actor without creating a second chat runtime.
- [x] Route `/return` to the active child actor as a return-attempt event.
- [x] Model asynchronous completion checks as invoked actors.
- [x] Model incomplete completion checks as guarded `onDone` branches back to `conversing`.
- [x] Inject failed completion evidence as system-level workflow feedback rather than human-authored transcript text.
- [x] Implement idempotent finalization and typed child output.
- [x] Deliver child output to parent `invoke.onDone` and apply parent result mapping.
- [x] Expose workflow descriptors in the LLM tool catalog without converting them to command promises.
- [x] Compile finite workflow-tool targets as named child actor sources and guarded invoked substates.
- [x] Persist tool-call ID, child invocation ID, input, depth, ancestry, and definition version before child start.
- [x] Route nested workflow interactions to the same UI through the deepest active actor.
- [x] Convert child final output to exactly one correlated tool result and resume the same chat actor.
- [x] Add structured chat handling for child workflow error, cancellation, and retry.
- [x] Add maximum-depth and direct/indirect cycle protection for chat-initiated and workflow-initiated children.
- [x] Support one foreground chat-initiated child workflow before considering authored parallel fan-out.
- [x] Implement `/exit` as UI detachment with workflow persistence.
- [x] Implement `/cancel` as explicit workflow cancellation with confirmation and structured outcome.
- [x] Implement `/back` only through an explicit child back/abandon transition, distinct from successful completion.
- [x] Define behavior for process termination during commands, completion checks, and finalizers.
- [x] Implement workflow definition-version compatibility checks and controlled failure messaging.
- [x] Implement the business-definition artifact schema and required-section checks.
- [x] Implement meaningful-length and non-trivial-content validation for `.ai-team/business.md`.
- [x] Implement structured business-definition quality evaluation with blocking findings.
- [x] Capture explicit developer approval with message ID, timestamp, and document revision.
- [x] Invalidate approval after any material document revision.
- [x] Implement the business-definition idempotent finalizer and typed output schema.
- [x] Create the CEO business-definition child definition with a strict, goal-driving chat system prompt.
- [x] Migrate onboarding to invoke the CEO child and wait for its typed output.
- [x] Move HR candidate generation and selection into parent workflow steps rendered through the shared question system.
- [x] Create the selected HR Director through a parent workflow command.
- [x] Persist and refresh HR permissions before starting HR chat.
- [x] Define the HR hiring child input using the CEO's typed business-definition output.
- [x] Implement canonical Head of Development capability and approved-equivalent role matching.
- [x] Implement the hiring definition-of-done checker against persisted organization state.
- [x] Implement the hiring finalizer and typed output schema.
- [x] Create the HR hiring child definition with a strict, goal-driving chat system prompt.
- [x] Migrate onboarding to invoke the HR child and wait for its typed output.
- [x] Complete the parent onboarding actor only after HR child completion.
- [x] Emit typed workflow, actor, state, completion, failure, cancellation, and restoration events.
- [x] Project actor inspection/snapshots through the existing `IEmitService` event stream.
- [x] Add only transport-safe, additive workflow events to `api-contracts` and map them through `api-server`.
- [x] Keep CLI, Web, VS Code, and API adapters presentation-only while consuming the shared events.
- [x] Verify both TUI and Web render the same workflow interaction semantics without choosing transitions.
- [x] Verify service imports no infrastructure implementation and UI/API packages import no workflow actor logic.
- [x] Integrate structured workflow errors without duplicate presentation.
- [x] Add unit tests for definition compilation, child completion, output, and compatibility `run()`.
- [x] Add persistence and restoration tests for every active onboarding boundary.
- [x] Add integration tests for `/return`, questions, agent creation, permission refresh, and actor routing.
- [x] Add integration tests for command tools and workflow tools sharing discovery, schema, policy, and confirmation.
- [x] Add nested workflow tests for static invocation, output mapping, cancellation propagation, depth limits, and cycle rejection.
- [x] Add chat-to-workflow tests for waiting-state UI, restore, correlated completion, and exactly-once tool result insertion.
- [x] Add restart tests during CEO chat, HR selection, and HR chat.
- [x] Add cancellation and exit/resume tests.
- [x] Run the complete disposable-repository end-to-end release gate.
- [x] Delete `packages/service/src/commands/hr/workflow-phase.ts` after actor parity passes.
- [x] Remove init-specific CLI chat continuation and prompt-driven parent-transition workarounds.
- [x] Remove obsolete workflow-specific chat options that are replaced by child actor input.
- [x] Remove duplicate workflow/session continuation code made obsolete by actor persistence.
- [x] Update `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, architecture overview, diagrams, implementation entry points, and affected package documentation.
- [x] Run targeted builds, tests, lint, `git diff --check`, and the fuzzy duplication scan on affected workflow/chat scope.
- [x] Record final verification evidence and mark this task done only after every Definition of Done condition passes.
