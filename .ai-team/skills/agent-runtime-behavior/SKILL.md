---
name: agent-runtime-behavior
description: 'Use when working on agent chat behavior, system prompt construction, handoffs, context injection, or runtime behavior across packages/core and packages/service.'
---

# Agent runtime behavior

Use this skill when the work touches how agents behave at runtime rather than how they are described in portfolio files.

Typical triggers:

- agent behavior feels wrong in chat
- handoffs are awkward or missing context
- system prompt construction needs changes
- runtime context injection is too weak or too noisy
- role, skill, and team roster information are affecting conversation quality

## Focus areas

- `packages/core/src/llm/**/*`
- `packages/service/src/orchestrator/**/*`
- `packages/service/src/contracts.ts`
- `packages/service/src/index.ts`

## Workflow

1. Identify whether the issue is prompt construction, message shaping, handoff flow, or runtime event flow.
2. Keep persona authoring concerns separate from runtime behavior concerns.
3. Preserve package boundaries: shared behavior logic in `packages/core`, orchestration flow in `packages/service`.
4. Test the behavior path that changed, especially chat, handoff, or workflow continuation paths.

## Guardrails

- do not move agent portfolio-writing guidance into runtime code
- do not mix organizational role design with message orchestration logic
- keep system prompt changes explicit and easy to reason about
- prefer small behavior adjustments over sweeping prompt rewrites

## Successful outcome

- agent runtime behavior becomes easier to predict
- handoffs and context injection improve without bloating prompts
- core/service boundaries stay clean
