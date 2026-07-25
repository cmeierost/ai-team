# ADR-001: XState workflow actor model

**Status:** Accepted  
**Date:** 2026-07-25

## Context

The current workflow runner creates an XState actor inside `run()` and awaits
its completion. That is appropriate for a bounded command workflow, but it
cannot represent a parent workflow that remains active while a child chat waits
for multiple developer turns or the process restarts.

Initialization/onboarding must become the first production consumer of one
durable actor tree. This decision freezes the lifecycle rules before changing
the production runner.

## Decision

- A workflow run is a durable XState root actor with a stable run ID,
  definition ID/version, JSON-serializable input/context/output, and a
  persisted XState snapshot.
- Bounded commands are invoked promise actors. Multi-turn chats and nested
  workflows are invoked child machine actors.
- A child produces typed output only by reaching a final state. Its parent
  receives that output through `invoke.onDone` and decides the next transition.
- `/return` routes a typed return-attempt event to the deepest active child.
  A failed definition-of-done check returns the same child to its waiting state
  with system feedback; it does not change session or actor identity.
- Durable human input is an explicit waiting state and typed event, never a
  promise that holds a request open.
- `IWorkflowRunner.start()` and its persistent run handle become the canonical
  lifecycle. `run()` remains a compatibility wrapper for bounded callers.
- `WorkflowRunnerFactory.asCommand()` remains the only workflow-to-`ICommand`
  adapter. It returns a service-local branded workflow command so actor parents
  can invoke its machine directly without a second registry or flattening it
  through `execute()`.
- The finite, versioned catalog of workflow tools available to a chat compiles
  to named invoked child actor sources. Invocation is selected over dynamic
  spawning because it gives XState native child ownership, `onDone`/`onError`,
  cancellation on state exit, and recursive persisted snapshots. Spawning is
  reserved for a future genuinely dynamic catalog and must then provide the
  same persistence, cancellation, correlation, and exactly-once guarantees.
- Root snapshots use XState's persisted-snapshot API, including invoked
  children. The workflow run repository serializes ordered checkpoints and
  records an operation journal for restart-sensitive side effects. Idempotency
  keys derive from run ID, actor path, step ID, and attempt.
- The service owns actor lifecycle, interaction routing, and event projection.
  Core remains XState-free; adapters only send typed intents and render typed
  service events. There is one workflow runner and one chat runtime.

## Consequences

- Existing bounded workflows retain their `run()` and `ICommand` behavior while
  the runner is refactored in place behind narrow DI seams.
- Persisted definitions and exposed workflow-tool catalogs must be versioned and
  checked before restore.
- UI detachment is not cancellation; `/cancel` is an explicit actor event.
- Parent cancellation stops invoked children. A child failure reaches its
  authored parent error transition.
- Production migration proceeds one green slice at a time. No parallel
  workflow engine, second registry, or workflow-specific UI control flow is
  permitted.

## Evidence

`packages/service/src/workflow/xstate-actor-workflow-spike.test.ts` proves the
chosen invoked-child model on the repository's XState 5.30 dependency:

- rejected and successful return attempts across deep persisted-snapshot
  restoration;
- propagation of the persisted deterministic idempotency key;
- parent cancellation stopping an invoked child; and
- a chat tool call invoking a known child workflow, restoring while it waits,
  and emitting exactly one correlated tool result when it completes.

## Migration inventory (2026-07-25)

`IWorkflowRunner.run()` has one compatibility implementation in
`xstate-workflow-runner.ts` and these production callers:

- Bounded: initialization (`init.command.ts`, `init-workflow.ts`), HR fire,
  hiring, onboarding wrappers, and the JSON workflow tool.
- Interactive but currently flattened into one request: `ChatRuntime`.
- Compatibility-only: `WorkflowRunnerFactory.asCommand()` and runner tests.

There is no production workflow parent that invokes a workflow child as a native
actor today. `workflow-composition-example.ts` registers two `asCommand()`
examples, and `HireWorkflowCommand.asCommand()` exposes the third factory call;
all preserve the current direct `execute()` behavior. Slice 2 migrates these
surfaces to the branded child-machine capability without creating a new
registry.

The duplicate continuation sources to remove only after actor parity are:

- `commands/hr/workflow-phase.ts`, which owns the HR interactive phase;
- init's returned `workflowSystemPrompt` and `workflowToolAllowlist`, forwarded
  through CLI and chat options; and
- workflow question continuation tokens.

They are transitional adapter inputs, not durable workflow state.

## Alternatives considered

**Awaiting `workflowRunner.run()` in a promise actor** was rejected because the
parent cannot observe, checkpoint, restore, or route input to the child.

**Dynamic spawned workflow actors** were not selected for the initial finite
tool catalog. They require explicit parent messages and additional persistence
and duplicate-result safeguards that invocation supplies by construction.
