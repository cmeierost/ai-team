# ai-team as an Org-Native Developer Tool

## TL;DR

> **Summary**: Productize ai-team as a Conway-native task command center for software delivery. It should route work to the right agents, track execution end-to-end, preserve maintainability/scalability through organizational boundaries, and stay out of IDE/git territory.
> **Deliverables**:
>
> - task command center product framing
> - route-and-track MVP architecture
> - web UI reshaping plan
> - domain model for tasks, routes, actors, stages, outcomes, events
> - governance, visibility, and audit guardrails
>   **Effort**: Large
>   **Parallel**: YES - 3 waves
>   **Critical Path**: domain model → route engine → task command center UI → tracking/audit → verification

## Context

### Original Request

- ai-team should become a developer tool like OpenCode in outcome, not in product shape.
- ai-team already is an implementation of Conway's Law in agentic software engineering.
- Goal: get software done.
- Differentiator: maintainability and scalability.
- IDE/git/PR/diff/review remain outside ai-team.

### Interview Summary

- ai-team is **not** a coding-agent clone.
- The current web UI is graph/settings-centric.
- The first-class execution surface should be a **task command center**.
- The first workflow should be **route + track**: create tasks, delegate them, and track execution end-to-end.
- Each session should maintain per-agent task lists under one shared delegated task graph.
- Higher-level agents primarily plan, define contracts, and delegate; lower-level agents execute bounded tasks.
- Agent knowledge boundaries are enforced through `.perm` files.
- The primary UI must support both equal views: per-agent inboxes and delegated task tree.

### Metis Review (gaps addressed)

- Removed product confusion with code-workspace / PR-review scope.
- Added explicit in/out boundaries.
- Added route-and-track as the MVP north star.
- Added acceptance criteria for product framing, architecture, guardrails, and UI direction.

### Oracle Review (gaps addressed)

- Framed the product as a **Route-and-Track Task Command Center**.
- Identified must-have modules: task domain, route engine, agent directory, execution graph, event store, notifications, RBAC/audit.
- Added non-negotiable exclusions to prevent drift into IDE/project-management/tooling sprawl.

## Work Objectives

### Core Objective

Turn ai-team into an org-native developer tool whose primary UX is a task command center that routes work through Conway-aligned agent structures and makes execution visible, auditable, and scalable.

### Deliverables

- Product framing doc inside the plan
- MVP module map for route-and-track execution
- Web UI transition plan from graph/settings-centric to task-command-center-centric
- Task lifecycle model with event history
- Governance and scope guardrails
- Verification and rollout plan

### Definition of Done

- The plan defines a single MVP centered on **route + track**, not code editing.
- All task modules have clear ownership and boundaries.
- The plan explicitly excludes IDE/git/PR/diff/review responsibilities.
- The MVP includes a usable route-and-track task lifecycle: create, assign, start, block, escalate, complete, inspect outcome.
- The MVP includes session-scoped per-agent task lists and a parent/child delegation tree over the same task graph.
- Web UI work is anchored in current `packages/web` patterns and identifies what to reuse.
- Every task below has executable acceptance criteria and QA scenarios.

### Must Have

- Task command center as primary surface
- Dual primary views: per-agent inboxes and delegated task tree
- Conway-aligned module ownership
- Explicit routing and delegation semantics
- Execution state visibility
- Audit/event history
- Governance/RBAC boundaries
- `.perm`-driven knowledge boundaries

### Must NOT Have

- No embedded code editor
- No git/PR/diff/review workflow ownership
- No duplication of IDE responsibilities
- No broad project-management suite scope creep
- No vague “AI assistant” framing detached from org structure

## Verification Strategy

> ZERO HUMAN INTERVENTION in code editing is not relevant because code editing is out of scope. Verification is agent-executed for planning artifacts and architecture consistency.

- Test decision: tests-after for plan and architecture artifacts
- QA policy: every task includes happy-path and failure-path validation
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

Wave 1: product boundary + domain foundation

- T1 framing and scope
- T2 domain model
- T3 module ownership map

Wave 2: orchestration architecture + UI surface

- T4 route engine design
- T5 task lifecycle/event model
- T6 web UI reshaping
- T7 agent directory/capability routing

Wave 3: governance + rollout + verification

- T8 audit and observability
- T9 RBAC/guardrails
- T10 notifications/integrations
- T11 MVP rollout plan
- T12 final verification pack

### Dependency Matrix

| Task | Blocked By          | Blocks       |
| ---- | ------------------- | ------------ |
| T1   | none                | T4,T6,T9,T11 |
| T2   | none                | T4,T5,T7     |
| T3   | none                | T6,T7,T9     |
| T4   | T1,T2               | T5,T10,T11   |
| T5   | T2,T4               | T8,T11,T12   |
| T6   | T1,T3               | T11,T12      |
| T7   | T2,T3               | T10,T11      |
| T8   | T5                  | T12          |
| T9   | T1,T3               | T12          |
| T10  | T4,T7               | T11,T12      |
| T11  | T1,T4,T5,T6,T7,T10  | T12          |
| T12  | T5,T6,T8,T9,T10,T11 | none         |

### Agent Dispatch Summary

| Wave | Task Count | Categories                                 |
| ---- | ---------: | ------------------------------------------ |
| 1    |          3 | writing, deep                              |
| 2    |          4 | deep, visual-engineering, unspecified-high |
| 3    |          5 | writing, deep, unspecified-high            |

## TODOs

- [ ] 1. Define product framing and hard scope boundaries

  **What to do**: Rewrite product language so ai-team is positioned as an org-native task command center for software delivery. Explicitly document that IDE, git, PRs, diffs, and review UX stay outside the product boundary.
  **Must NOT do**: Reintroduce code-workspace, code editor, or PR tooling scope.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: this is a product-definition artifact
  - Skills: `[]` — Reason: repo context is already sufficient
  - Omitted: `git-master` — Reason: no git operation planning needed here

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T4,T6,T9,T11 | Blocked By: none

  **References**:
  - `README.md` — current repository positioning
  - `ARCHITECTURE.md` — current architecture boundaries
  - `packages/web/src/pages/SettingsPage.tsx` — current web UI emphasis
  - `.sisyphus/drafts/ai-team-dev-tool.md` — confirmed user decisions

  **Acceptance Criteria**:
  - [ ] The plan contains a product statement that names the task command center as the primary surface.
  - [ ] The plan lists explicit out-of-scope items: IDE, git, PRs, diffs, review UX.
  - [ ] The plan distinguishes ai-team from OpenCode by method, not by end goal.

  **QA Scenarios**:

  ```
  Scenario: Scope statement is consistent
    Tool: Read
    Steps: Read the plan sections TL;DR, Context, Work Objectives, Must NOT Have.
    Expected: All four sections consistently describe ai-team as route-and-track command center and exclude IDE/git/PR scope.
    Evidence: .sisyphus/evidence/task-1-framing.md

  Scenario: Scope drift detected
    Tool: Grep
    Steps: Search the plan for "PR", "diff", "code editor", and "git workflow".
    Expected: Any mention appears only in explicit out-of-scope / exclusion context.
    Evidence: .sisyphus/evidence/task-1-framing-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define org-native task command center scope` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 2. Define the task domain model

  **What to do**: Specify the MVP domain entities and relationships: SessionTaskGraph, AgentTaskList, Task, Route, Stage, Actor, Assignment, Outcome, Event, EscalationPolicy, ArtifactLink.
  **Must NOT do**: Add code-editing entities or repository diff abstractions.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: foundational product architecture decision
  - Skills: `[]` — Reason: internal modeling task
  - Omitted: `frontend-ui-ux` — Reason: not UI-first

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T4,T5,T7 | Blocked By: none

  **References**:
  - `packages/service/src/contracts.ts` — mediator and command-contract patterns
  - `packages/service/src/orchestrator/chat-orchestrator.ts` — orchestration flow concepts
  - `packages/web/src/hooks/useTasksForAgent.ts` — existing task-oriented web pattern

  **Acceptance Criteria**:
  - [ ] The plan defines each MVP entity with purpose and minimum fields.
  - [ ] The model explains how per-agent task lists derive from a shared session task graph.
  - [ ] Route and stage semantics are explicit enough to support sequential and parallel delegation.
  - [ ] Event history is included as a first-class element.

  **QA Scenarios**:

  ```
  Scenario: Domain model completeness
    Tool: Read
    Steps: Read the task domain section and check for SessionTaskGraph, AgentTaskList, Task, Route, Stage, Actor, Assignment, Outcome, Event.
    Expected: All entities appear with non-overlapping responsibilities and AgentTaskList is derived from SessionTaskGraph.
    Evidence: .sisyphus/evidence/task-2-domain.md

  Scenario: Model drift into coding scope
    Tool: Grep
    Steps: Search the domain-model section for code editor, diff, patch, pull request.
    Expected: None of those appear as domain entities.
    Evidence: .sisyphus/evidence/task-2-domain-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define route-and-track domain model` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 3. Define Conway-aligned module ownership

  **What to do**: Map organizational responsibilities to product modules: command center surface, orchestration core, route engine, agent directory, audit/guardrails, adapters.
  **Must NOT do**: Leave ownership implicit or allow duplicate responsibilities across modules.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: architecture and ownership mapping
  - Skills: `[]` — Reason: repo architecture already known
  - Omitted: `git-master` — Reason: no git concern

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6,T7,T9 | Blocked By: none

  **References**:
  - `.ai-team/agents/` — organizational source of truth
  - `AGENTS.md` — executive routing context
  - `packages/core/src/context/permission-adapter.ts` — policy/access boundary pattern
  - `packages/service/src/index.ts` — shared service surface

  **Acceptance Criteria**:
  - [ ] Every major MVP module has one primary owner and one clear API boundary.
  - [ ] The plan includes a role-to-module mapping table.
  - [ ] The plan explains why this structure preserves maintainability/scalability.

  **QA Scenarios**:

  ```
  Scenario: Ownership map is complete
    Tool: Read
    Steps: Read the ownership section and enumerate modules and owners.
    Expected: No module lacks an owner and no owner is ambiguously assigned to the same responsibility twice.
    Evidence: .sisyphus/evidence/task-3-ownership.md

  Scenario: Boundary confusion check
    Tool: Read
    Steps: Compare ownership map against Must NOT Have and Scope Boundaries.
    Expected: No module owns IDE/git/PR capabilities.
    Evidence: .sisyphus/evidence/task-3-ownership-error.md
  ```

  **Commit**: YES | Message: `docs(plan): map conway-aligned module ownership` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 4. Design the route engine MVP

  **What to do**: Define how routes are declared and executed: sequential stages, parallel stages, conditional branching, fallback routing, and escalation triggers.
  **Must NOT do**: Turn the route engine into a generic BPM suite.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: execution semantics are core product value
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` — Reason: backend/domain-first decision

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T5,T10,T11 | Blocked By: T1,T2

  **References**:
  - `packages/service/src/orchestrator/chat-orchestrator.ts` — existing orchestration semantics
  - `packages/service/src/contracts.ts` — command/event contract pattern

  **Acceptance Criteria**:
  - [ ] Route declarations support sequential and parallel stage types.
  - [ ] The plan defines escalation, fallback, and blocked-state behavior.
  - [ ] Route engine scope is explicitly smaller than a generic workflow/BPM platform.

  **QA Scenarios**:

  ```
  Scenario: Route execution model covers core cases
    Tool: Read
    Steps: Inspect route engine section for sequential, parallel, conditional, fallback, escalation.
    Expected: All five behaviors are defined.
    Evidence: .sisyphus/evidence/task-4-route-engine.md

  Scenario: BPM scope creep check
    Tool: Grep
    Steps: Search for enterprise BPM, generic workflow engine, low-code automation in the route-engine section.
    Expected: None are used as product scope.
    Evidence: .sisyphus/evidence/task-4-route-engine-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define route engine MVP semantics` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 5. Define task lifecycle and event history

  **What to do**: Define lifecycle states and transition rules for tasks and assignments: created, routed, assigned, in-progress, blocked, escalated, completed, aborted, archived.
  **Must NOT do**: Leave lifecycle semantics implicit.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: state model underpins tracking and audit
  - Skills: `[]`
  - Omitted: `git-master`

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T8,T11,T12 | Blocked By: T2,T4

  **References**:
  - `packages/service/src/workflow-state.ts` — workflow persistence concept
  - `packages/service/src/session-manager.ts` — state-management precedent
  - `packages/web/src/components/SessionGraph.tsx` — execution visibility precedent

  **Acceptance Criteria**:
  - [ ] Lifecycle states and legal transitions are listed.
  - [ ] Event history covers who acted, when, why, and resulting state.
  - [ ] Blocked and escalated states are first-class, not edge cases.

  **QA Scenarios**:

  ```
  Scenario: Lifecycle is executable
    Tool: Read
    Steps: Read the lifecycle section and simulate create → assign → block → escalate → complete.
    Expected: Every transition is explicitly allowed or denied.
    Evidence: .sisyphus/evidence/task-5-lifecycle.md

  Scenario: Missing audit semantics check
    Tool: Read
    Steps: Inspect whether event history captures actor, timestamp, action, state change, rationale.
    Expected: All five are present.
    Evidence: .sisyphus/evidence/task-5-lifecycle-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define task lifecycle and event history` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 6. Redesign the web UI around a task command center

  **What to do**: Define the target web IA and primary screens for the MVP: per-agent inboxes, delegated task tree, execution detail, escalation queue, outcome inspector. Reuse existing graph/settings assets where they support command-center visibility.
  **Must NOT do**: Build a chat-first UI or code workbench as the primary MVP surface.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UX restructuring while preserving current architecture
  - Skills: []
  - Omitted: `playwright` — Reason: this is plan work, not implementation QA yet

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T11,T12 | Blocked By: T1,T3

  **References**:
  - `packages/web/src/main.tsx` — app shell/bootstrap
  - `packages/web/src/components/Sidebar.tsx` — persistent navigation pattern
  - `packages/web/src/components/TeamGraph.tsx` — reusable org visibility component
  - `packages/web/src/components/SessionGraph.tsx` — reusable execution visibility component
  - `packages/web/src/context/TeamContext.tsx` — shared-state pattern

  **Acceptance Criteria**:
  - [ ] The MVP UI defines a primary task-command-center navigation model.
  - [ ] Per-agent inboxes and delegated task tree are treated as equal primary views over the same underlying session task graph.
  - [ ] Existing graph/settings surfaces are either reused or deliberately demoted with rationale.
  - [ ] The UI plan explains how maintainability/scalability remain visible in the surface.

  **QA Scenarios**:

  ```
  Scenario: UI shift is explicit
    Tool: Read
    Steps: Read the web UI section and list primary MVP screens.
    Expected: Per-agent inboxes, delegated task tree, execution detail, escalation queue, outcome inspector are present.
    Evidence: .sisyphus/evidence/task-6-web-ui.md

  Scenario: Old UI bias remains primary
    Tool: Read
    Steps: Check whether Settings/TeamGraph/SessionGraph are still described as the primary product surface.
    Expected: They are secondary/supporting unless explicitly justified as command-center views.
    Evidence: .sisyphus/evidence/task-6-web-ui-error.md
  ```

  **Commit**: YES | Message: `docs(plan): reshape web IA around task command center` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 7. Define agent directory and capability routing

  **What to do**: Specify how the command center discovers available actors, capabilities, role boundaries, preferred routing targets, and `.perm`-based knowledge visibility.
  **Must NOT do**: Assume all agents are interchangeable executors.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: capability routing is core to Conway-native execution
  - Skills: []
  - Omitted: `git-master`

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T10,T11 | Blocked By: T2,T3

  **References**:
  - `.ai-team/agents/` — current role portfolio
  - `.ai-team/ai-team-way.md` — org design doctrine
  - `packages/web/src/hooks/useSkillsForAgent.ts` — current skill/agent UI precedent

  **Acceptance Criteria**:
  - [ ] Capability routing uses role boundaries and specialization, not flat agent selection.
  - [ ] Availability/fallback semantics are included.
  - [ ] Human and agent actors can both exist in the model if needed.
  - [ ] The plan explains how `.perm` boundaries constrain what each agent can know about session tasks and context.

  **QA Scenarios**:

  ```
  Scenario: Capability routing is non-flat
    Tool: Read
    Steps: Read agent-directory section and inspect routing logic assumptions.
    Expected: Routing uses roles/capabilities/fallbacks rather than random or purely manual selection.
    Evidence: .sisyphus/evidence/task-7-agent-directory.md

  Scenario: Interchangeable-agent anti-pattern check
    Tool: Read
    Steps: Inspect whether all agents are treated as generic workers.
    Expected: No; specialization and ownership are explicit.
    Evidence: .sisyphus/evidence/task-7-agent-directory-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define capability-aware routing model` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 8. Define audit, observability, and execution visibility

  **What to do**: Define the evidence and telemetry model for route-and-track execution: event log, route replay, stuck-task signals, escalation history, and command-center metrics.
  **Must NOT do**: Reduce visibility to raw logs only.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: observability is core trust mechanism
  - Skills: []
  - Omitted: `frontend-ui-ux`

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T12 | Blocked By: T5

  **References**:
  - `packages/service/src/workflow-state.ts` — persistence pattern
  - `packages/web/src/components/SessionGraph.tsx` — execution-history visualization precedent

  **Acceptance Criteria**:
  - [ ] The plan defines replayable event history.
  - [ ] The plan defines at least three command-center metrics: routing latency, blocked-task count, escalation rate, or equivalent.
  - [ ] Visibility includes current state and historical explanation.

  **QA Scenarios**:

  ```
  Scenario: Observability covers present and history
    Tool: Read
    Steps: Read observability section and list current-state and historical-state mechanisms.
    Expected: Both are present.
    Evidence: .sisyphus/evidence/task-8-observability.md

  Scenario: Metrics are too vague
    Tool: Read
    Steps: Inspect whether metrics are concrete and countable.
    Expected: Each metric has a name and measurable meaning.
    Evidence: .sisyphus/evidence/task-8-observability-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define audit and execution visibility` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 9. Define governance and RBAC guardrails

  **What to do**: Specify who can create routes, override routing, reassign tasks, escalate tasks, and inspect sensitive execution data.
  **Must NOT do**: Leave governance to future implementation.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: policy and guardrail specification
  - Skills: []
  - Omitted: `git-master`

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T12 | Blocked By: T1,T3

  **References**:
  - `packages/core/src/context/permission-adapter.ts` — access-policy pattern
  - `.ai-team/agents/*.perm` — current access boundary concept

  **Acceptance Criteria**:
  - [ ] RBAC roles and permissions are named.
  - [ ] Override/escalation authority is explicit.
  - [ ] Sensitive visibility is governed.

  **QA Scenarios**:

  ```
  Scenario: Governance is explicit
    Tool: Read
    Steps: Read governance section and enumerate role powers.
    Expected: Route creation, override, reassignment, escalation, inspection all have owners.
    Evidence: .sisyphus/evidence/task-9-governance.md

  Scenario: Governance hole check
    Tool: Read
    Steps: Look for any privileged action without an owning role.
    Expected: None found.
    Evidence: .sisyphus/evidence/task-9-governance-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define rbAC and task-governance guardrails` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 10. Define notifications and external integrations

  **What to do**: Specify thin integration points for notifying humans and external systems about task assignment, blockage, escalation, and completion.
  **Must NOT do**: Expand into full collaboration-suite scope.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: bounded integration design across surfaces
  - Skills: []
  - Omitted: `dev-browser`

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T11,T12 | Blocked By: T4,T7

  **References**:
  - `packages/api-server/README.md` — transport/integration boundary precedent
  - `packages/service/src/contracts.ts` — event surface precedent

  **Acceptance Criteria**:
  - [ ] Integrations are event-driven and thin.
  - [ ] Supported notification moments are named.
  - [ ] Collaboration integrations do not become the primary product surface.

  **QA Scenarios**:

  ```
  Scenario: Integration points are bounded
    Tool: Read
    Steps: Read integrations section and list supported events.
    Expected: Assignment, blockage, escalation, completion are included; full chat-suite scope is excluded.
    Evidence: .sisyphus/evidence/task-10-integrations.md

  Scenario: Collaboration-suite scope creep check
    Tool: Grep
    Steps: Search integrations section for broad messaging-platform replacement claims.
    Expected: None found.
    Evidence: .sisyphus/evidence/task-10-integrations-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define thin notification and integration layer` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 11. Define the MVP rollout and adoption plan

  **What to do**: Define a phased MVP rollout centered on 2-3 route types, clear pilot users, and measurable success metrics for route-and-track adoption.
  **Must NOT do**: Promise full product breadth in MVP.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: rollout and success-definition artifact
  - Skills: []
  - Omitted: `git-master`

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T12 | Blocked By: T1,T4,T5,T6,T7,T10

  **References**:
  - `README.md` — current repo entry framing
  - `packages/web/src/hooks/useRecentSessions.ts` — current recency/activity precedent

  **Acceptance Criteria**:
  - [ ] MVP route types are named.
  - [ ] Pilot audience is named.
  - [ ] Success metrics are measurable and tied to route-and-track behavior.

  **QA Scenarios**:

  ```
  Scenario: MVP scope is concrete
    Tool: Read
    Steps: Read rollout section and extract route types, pilot users, metrics.
    Expected: All three are explicitly listed.
    Evidence: .sisyphus/evidence/task-11-rollout.md

  Scenario: MVP inflation check
    Tool: Read
    Steps: Inspect rollout section for broad platform promises beyond route-and-track MVP.
    Expected: MVP remains narrow and pilotable.
    Evidence: .sisyphus/evidence/task-11-rollout-error.md
  ```

  **Commit**: YES | Message: `docs(plan): define route-and-track MVP rollout` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

- [ ] 12. Produce the final verification pack

  **What to do**: Add a final review checklist that verifies scope fidelity, module ownership, UI focus, governance, and MVP completeness.
  **Must NOT do**: Leave verification implicit.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: plan verification artifact
  - Skills: []
  - Omitted: `git-master`

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: none | Blocked By: T5,T6,T8,T9,T10,T11

  **References**:
  - entire plan file
  - `.sisyphus/drafts/ai-team-dev-tool.md` — confirmed decision record

  **Acceptance Criteria**:
  - [ ] Final checklist covers scope, lifecycle, routing, UI, governance, rollout.
  - [ ] The checklist can be executed by an agent reading the plan only.
  - [ ] No unresolved product-boundary ambiguity remains.

  **QA Scenarios**:

  ```
  Scenario: Final checklist is complete
    Tool: Read
    Steps: Read final verification pack and enumerate checklist categories.
    Expected: Scope, lifecycle, routing, UI, governance, rollout are all present.
    Evidence: .sisyphus/evidence/task-12-verification.md

  Scenario: Hidden ambiguity remains
    Tool: Read
    Steps: Cross-check checklist against TL;DR, Must Have, Must NOT Have, and rollout.
    Expected: No contradiction remains.
    Evidence: .sisyphus/evidence/task-12-verification-error.md
  ```

  **Commit**: YES | Message: `docs(plan): add final verification pack` | Files: `.sisyphus/plans/ai-team-dev-tool.md`

## Final Verification Wave

> 4 review agents run in parallel. All must approve before execution is considered ready.

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review of plan clarity — unspecified-high
- [ ] F3. Real Manual QA of plan consistency — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- One atomic commit per task section improvement.
- Commit messages focus on **why** the plan changed.
- Do not mix product-boundary fixes with UI restructuring fixes in the same commit.
- Suggested commit order:
  - `docs(plan): define org-native command center scope`
  - `docs(plan): define route-and-track domain and ownership`
  - `docs(plan): add route engine and lifecycle model`
  - `docs(plan): reshape web IA around task command center`
  - `docs(plan): add governance, observability, and rollout`

## Success Criteria

- ai-team is framed as a task command center, not a code-editing tool.
- The MVP route-and-track workflow is decision-complete.
- The web UI transition is grounded in current repo structure.
- Governance and scope guardrails prevent OpenCode-style product drift.
- The plan is executable by a downstream builder without needing new product decisions.
