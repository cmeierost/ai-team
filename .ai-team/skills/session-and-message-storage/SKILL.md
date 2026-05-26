---
name: session-and-message-storage
description: 'Use when working on SQLite-backed sessions, messages, notes, tasks, storage contracts, migrations, serialization, or persistence behavior in packages/service.'
triggers:
  - "\\bsqlite\\b"
  - "\\bmigration\\b"
  - "\\bsession.?skill\\b"
  - "\\bpersist\\b"
  - "packages/service.*storage"
  - "storage.*contract"
---

# Session and message storage

Use this skill when the work touches persistence for conversations, workflow history, notes, or task data.

Typical triggers:

- session history is missing or corrupted
- message insertion or retrieval is wrong
- SQLite schema or migration changes are needed
- storage contracts need to evolve safely
- serialization between database rows and runtime objects is inconsistent
- search, archive, merge, or delete behavior is failing

## Focus areas

- `packages/service/src/storage/**/*`
- `packages/service/src/session-manager.ts`
- `packages/service/src/task-manager.ts`
- `packages/service/src/workflow-state.ts`

## Workflow

1. Identify the storage boundary involved: sessions, messages, notes, tasks, or workflow state.
2. Preserve storage contracts before changing implementation details.
3. Make schema and migration changes conservatively.
4. Validate full read/write round-trips, not only inserts.
5. Check cross-session references, archival behavior, and search paths when persistence logic changes.

## Guardrails

- do not change serialization shapes casually
- do not break migration compatibility for existing workspaces
- keep business logic out of low-level persistence helpers
- prefer transaction-safe updates for multi-table operations

## Successful outcome

- persistence stays reliable and debuggable
- storage changes remain backward-safe
- runtime objects and stored data stay consistent
