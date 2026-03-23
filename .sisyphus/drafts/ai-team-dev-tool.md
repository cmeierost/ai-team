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

## Technical Decisions

- Product framing is shifting away from direct OpenCode parity toward an org-native developer tool built around Conway-aligned agent boundaries.
- Web UI review should inform the next planning pass before restructuring the plan.
- ai-team should not absorb IDE/VCS responsibilities; it should orchestrate and structure software delivery around them.
- The web UI should center on task-driven orchestration with explicit delegation, workflow tracking, and execution visibility.

## Research Findings

- Existing plan saved at `.sisyphus/plans/ai-team-dev-tool.md`
- OpenCode is a coding-agent product with TUI/web/desktop surfaces and a provider-agnostic runtime.
- ai-team already uses a multi-surface architecture with CLI, VS Code, and Web adapters over shared service/core layers.
- Current web UI is graph- and configuration-centric, not chat-first.
- Main visible UX centers on org/session visibility and settings (`packages/web/src/pages/SettingsPage.tsx`, `packages/web/src/components/TeamGraph.tsx`, `packages/web/src/components/SessionGraph.tsx`, `packages/web/src/components/Sidebar.tsx`).
- Reusable patterns already support maintainability/scalability: thin layout shell, context-driven shared state, and hook-based data access.
- Main gap versus desired framing: no obvious code-workbench, repo/PR/diff workflow, or explicit software-delivery surface.
- Main gap versus desired framing: no explicit software-delivery surface centered on orchestration, tasks, architecture, handoffs, and execution visibility.
- Preferred first-class surface is a task command center, not a code workbench or review tool.

## Open Questions

- What should the web UI optimize for first: orchestration visibility, task execution, review/governance, or code workbench?
- What should the web UI optimize for first: orchestration visibility, task execution, architecture stewardship, or governance?
- How should the task command center prioritize its first workflow: create tasks, route tasks, track execution, or inspect outcomes?
- How much of the current web UI can be reused vs replaced?

## Scope Boundaries

- INCLUDE: product framing, web UI review, Conway-aligned architecture, maintainability/scalability positioning
- INCLUDE: product framing, web UI review, Conway-aligned architecture, maintainability/scalability positioning, orchestration/task visibility
- EXCLUDE: implementation work outside `.sisyphus/`
- EXCLUDE: replacing IDE code editing, git workflows, PR review UX, or diff tooling
