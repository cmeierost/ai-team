## Plan: User-Local DB Planning with Session-Scoped Tasks

Keep feature/bug intake provider-abstracted and user-local, but enforce execution context by making each task belong to exactly one session. Plans become cross-session artifacts whose visibility is derived from the union of sessions that contain tasks linked to that plan. Persist plans/tasks/todos in SQLite and provide one-way markdown export for Copilot compatibility.

**Steps**

1. Phase 1 — Domain rules and invariants (blocks all later phases)
   1.1 Define lifecycle: intake item -> plan -> task -> todo.
   1.2 Add hard invariant: each task has exactly one `sessionId` (required, non-null, immutable after creation except explicit move operation).
   1.3 Define plan-session visibility rule: a plan is visible in all sessions that have at least one task referencing that plan.
   1.4 Keep source-of-truth user-local in SQLite (`.ai-team/private/ai-team.db`); markdown is exported view only.
2. Phase 2 — Storage schema and intake ingestion (depends on 1)
   2.1 Add tables for intake items, plans, tasks, todos, delegation history, plus relation/index support.
   2.2 Ensure tasks table stores required `sessionId` and `planId`; enforce FK/index constraints for fast session queries.
   2.3 Use `.ai-team/private/intake/` as initial provider source and ingest idempotently into DB.
3. Phase 3 — Plan/task/todo services with session semantics (depends on 2)
   3.1 Implement plan creation from intake items.
   3.2 Derive tasks from plan action items into a target session (single-session ownership per task).
   3.3 Persist todos under tasks and delegation records under tasks.
   3.4 Implement plan visibility resolver by session: list plans available to session via linked tasks.
4. Phase 4 — Command/API surface (depends on 3)
   4.1 Add operations for intake sync/list, plan create/list/get-by-session, derive tasks to session, assign/reassign task, todo update.
   4.2 Add explicit command parameter validation requiring session target for task creation/derivation.
   4.3 Keep provider abstraction boundary stable for future GitHub/GitLab/Jira adapters.
5. Phase 5 — Markdown export (depends on 3, parallel with 4)
   5.1 Implement one-way DB -> markdown export for a plan including tasks grouped by session and todo progress.
   5.2 Preserve compatibility with existing `.ai-team/plans/` markdown style where practical.
6. Phase 6 — Verification and docs alignment (depends on 4 and 5)
   6.1 Unit-test invariants: task requires single session, plan visibility derives from session-linked tasks.
   6.2 Integration-test flow: intake -> plan -> derive tasks into session A/B -> verify plan appears in A/B only.
   6.3 Update docs so session/task/plan visibility behavior is explicit and unambiguous.

**Relevant files**

- `c:/Projects/ai-team/packages/core/src/types/index.ts` — export intake/plan/task/todo/session-link contracts.
- `c:/Projects/ai-team/packages/core/src/types/tasks.ts` — add required single-session ownership metadata.
- `c:/Projects/ai-team/packages/service/src/storage/contracts.ts` — add session-aware plan/task/todo storage queries.
- `c:/Projects/ai-team/packages/service/src/storage/sqlite/migrations.ts` — enforce schema constraints for `sessionId` + `planId` relations.
- `c:/Projects/ai-team/packages/service/src/storage/sqlite/sqlite-storage.ts` — implement session-scoped task persistence + plan visibility queries.
- `c:/Projects/ai-team/packages/service/src/task-manager.ts` — derive/create tasks into a specified session and maintain invariants.
- `c:/Projects/ai-team/packages/service/src/routers/tasks-service.ts` — expose session-scoped task/todo operations.
- `c:/Projects/ai-team/packages/service/src/commands/definitions/` — add plan/task/todo commands requiring session context.
- `c:/Projects/ai-team/packages/api-client/src/contract/routers/streaming.ts` — extend command contracts for session-aware task derivation.
- `c:/Projects/ai-team/packages/service/src/tools/catalog/agent-tools.ts` — delegation persistence tied to session-owned task.
- `c:/Projects/ai-team/.ai-team/private/intake/` — local intake source folder.
- `c:/Projects/ai-team/ARCHITECTURE.md` — document session-scoped task model and plan sharing rule.
- `c:/Projects/ai-team/COPILOT-CONTEXT.md` — clarify DB-first source-of-truth + session sharing semantics.
- `c:/Projects/ai-team/docs/implementation/task-management.md` — describe lifecycle and API behavior.

**Verification**

1. Unit tests for schema/service invariant: task creation fails without `sessionId`.
2. Unit tests for plan visibility resolver: plan appears in session set equal to distinct task sessions for that plan.
3. Unit tests for delegation/todo updates preserving task session ownership.
4. Integration test with two sessions proving plan sharing via task linkage only.
5. Export validation showing plan tasks grouped by session with todo progress.

**Decisions**

- Persistence remains user-local only.
- Intake source remains `.ai-team/private/intake/`.
- Export remains one-way DB -> markdown.
- New rule: tasks are session-owned (exactly one session each).
- New rule: plans are shared across exactly the sessions that contain tasks derived from or linked to that plan.

**Further Considerations**

1. Optional future capability: explicit “move task to another session” operation with audit trail.
2. Optional future capability: plan-level session pinning override if needed for planning without tasks.
3. Optional future capability: session filters in exported markdown for smaller Copilot context payloads.
