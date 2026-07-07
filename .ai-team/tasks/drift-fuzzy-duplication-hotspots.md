---
id: drift-fuzzy-duplication-hotspots
type: chore
title: Resolve fuzzy duplication hotspots from packages scan
status: todo
priority: high
assignedTo: alex-morgan
createdBy: copilot
createdByType: agent
requiresApproval: false
subtaskIds: []
estimatedHours: 10
deadline: null
tags:
  - architecture
  - duplication
  - quality
  - backend
createdAt: 2026-06-29T12:30:00.000Z
updatedAt: 2026-06-29T12:30:00.000Z
---

## Goal

Reduce high-confidence fuzzy duplicate code hotspots identified in `packages/` and prevent re-introduction by adopting duplication checks in regular feature and cleanup workflows.

## Action Items

- [x] Consolidate `service/src/commands/edit/code-edit-list.command.ts` and `service/src/commands/edit/edit-list.command.ts` into a single implementation path.
- [x] Consolidate `service/src/commands/edit/edit-patch.command.ts` and `service/src/commands/edit/patch-apply.command.ts` into a single implementation path.
- [x] Consolidate `service/src/commands/hr/hh-refresh.command.ts` and `service/src/commands/hr/hr-refresh.command.ts` into a single implementation path.
- [ ] Resolve high-overlap `core/src/context/perm-overlap.ts` duplication by extracting shared logic where possible.
- [x] Resolve overlap between `service/src/commands/fs/do-i-have-access.tool.ts` and `service/src/commands/fs/who-has-access.tool.ts`.
- [x] Resolve overlap between `cli/src/handlers/debug-log.ts` and `service/src/utils/debug-log.ts` via shared utility ownership.
- [ ] Review `core/src/code-edit/tree-sitter-manager.ts` hotspots and remove duplicated helper logic.
- [ ] Review `core/src/types/tasks.ts` and `core/src/code-edit/edit-proposal.ts` duplication hotspots and normalize repeated type/shape logic.
- [ ] Re-run fuzzy duplication scan on `packages/` and capture before/after summary metrics in this task.
- [ ] Add/adjust tests around consolidated implementations so behavior remains stable.

## Progress Notes

- Completed first wave of command/tool duplication reduction in `packages/service` and shared debug-log utility extraction used by both service + CLI.
- Validation executed after each change cluster: targeted `vitest` suites for access tools and debug-log modules, plus `pnpm --filter @ai-team/service build` and `pnpm --filter @ai-team/cli build`.
- Core dedupe follow-up:
  - Consolidated command-catalog metadata types via `packages/core/src/command-catalog/index.ts` re-exporting `packages/core/src/types/cli.ts`.
  - Extracted shared code-analysis location shape into `packages/core/src/code-analysis/location.ts` and reused it in `reference-finder.ts` + `pattern-matcher.ts`.
  - Focused `packages/core` fuzzy scan reduced summary from **186 duplicate lines / 9 match blocks** to **117 duplicate lines / 7 match blocks**.
