# Draft: ai-team Developer Tool

## Requirements (confirmed)

- "ai team should become a developer tool.. like open code.."
- "we are applying conveys law to ai-agents"
- "ai team is that! an implementation of conweys law in agentic software engineering"
- Goal: get software done
- Differentiator: ai-team focuses on maintainability and scalability
- Immediate focus: inspect the current web UI before locking product framing
- PR/diff/review flow is NOT the concern of ai-team; that belongs to the IDE and git
- First-class execution surface: Task command center
- Every agent has its own task list within a given session
- Higher-level agents primarily plan, define API/contracts, and delegate tasks downward
- What each agent may know/access is defined by `.perm` files
- Primary UI should support both equally: per-agent inboxes and a delegated parent/child task tree

## Technical Decisions

- Product framing is shifting away from direct OpenCode parity toward an org-native developer tool built around Conway-aligned agent boundaries.
- Web UI review should inform the next planning pass before restructuring the plan.
- ai-team should not absorb IDE/VCS responsibilities; it should orchestrate and structure software delivery around them.
- The web UI should center on task-driven orchestration with explicit delegation, workflow tracking, and execution visibility.
- Task ownership is session-scoped and agent-local before aggregation.
- Delegation hierarchy should mirror agent seniority/responsibility: higher-level agents coordinate, lower-level agents execute.
- Knowledge/access boundaries are policy-driven through `.perm` files, not implicit prompt conventions.
- The task system should have one underlying session task graph with two equal projections: inbox view and delegation-tree view.

## Research Findings

- Existing plan saved at `.sisyphus/plans/ai-team-dev-tool.md`
- OpenCode is a coding-agent product with TUI/web/desktop surfaces and a provider-agnostic runtime.
- ai-team already uses a multi-surface architecture with CLI, VS Code, and Web adapters over shared service/core layers.
- Current web UI is graph- and configuration-centric, not chat-first.
- Main visible UX centers on org/session visibility and settings (`packages/web/src/pages/SettingsPage.tsx`, `packages/web/src/components/TeamGraph.tsx`, `packages/web/src/components/SessionGraph.tsx`, `packages/web/src/components/Sidebar.tsx`).
- Reusable patterns already support maintainability/scalability: thin layout shell, context-driven shared state, and hook-based data access.
- Main gap versus desired framing: no explicit software-delivery surface centered on orchestration, tasks, architecture, handoffs, and execution visibility.
- Preferred first-class surface is a task command center, not a code workbench or review tool.
- Existing access-boundary concepts already support this direction via `.perm` files and `packages/core/src/context/permission-adapter.ts`.

## Open Questions

- How much of the current web UI can be reused vs replaced?

## Scope Boundaries

- INCLUDE: product framing, web UI review, Conway-aligned architecture, maintainability/scalability positioning, orchestration/task visibility
- INCLUDE: session-scoped task lists, delegation hierarchy, `.perm`-driven knowledge boundaries
- EXCLUDE: implementation work outside `.sisyphus/`
- EXCLUDE: replacing IDE code editing, git workflows, PR review UX, or diff tooling
