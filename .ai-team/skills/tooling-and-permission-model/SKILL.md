---
name: tooling-and-permission-model
description: 'Use when working on tool registries, schema-backed tool definitions, permission-aware execution, CLI tool gating, safe file edits, or backend tool authorization rules.'
---

# Tooling and permission model

Use this skill when the backend work touches how tools are defined, validated, authorized, or executed.

Typical triggers:

- a tool should be available but is blocked
- a tool is too broadly allowed or dangerously scoped
- schema-backed tool parameters need refinement
- CLI tool registration or execution rules are changing
- file edit proposals need stronger validation
- tool catalog or authorization logic is drifting

## Focus areas

- `packages/core/src/tools/**/*`
- `packages/service/src/tools/**/*`
- `packages/service/src/orchestrator/defaults/tool-resolver.ts`
- tool-facing contracts that affect execution safety

## Workflow

1. Confirm whether the change is about registry definition, parameter validation, permission policy, or execution flow.
2. Keep tool shape, permission checks, and execution boundaries explicit.
3. Favor schema-backed validation and narrow permissions over convenience shortcuts.
4. Validate both the allowed and denied paths when changing tool behavior.

## Guardrails

- do not silently widen tool access
- do not bypass path or agent permission checks
- keep safe execution concerns separate from higher-level business logic
- prefer clear denial behavior over ambiguous partial success

## Successful outcome

- tool behavior becomes easier to trust and debug
- permissions stay narrow, explicit, and auditable
- backend tooling changes remain safe under real workspace conditions
