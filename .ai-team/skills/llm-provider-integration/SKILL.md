---
name: llm-provider-integration
description: 'Use when working on GitHub Copilot, OpenAI-compatible providers, model discovery, connection testing, provider config, env resolution, streaming behavior, or model fallback logic.'
---

# LLM provider integration

Use this skill when the backend work touches provider setup, model resolution, connection handling, or provider-specific runtime quirks.

Typical triggers:

- provider setup or switching is failing
- model discovery is wrong or incomplete
- API keys or env resolution behave incorrectly
- streaming responses stall or break
- provider-specific parameter fallbacks are needed
- connection testing or init setup needs changes

## Focus areas

- `packages/core/src/llm/index.ts`
- `packages/service/src/commands/provider.ts`
- `packages/service/src/commands/models.ts`
- `packages/service/src/commands/test-connection.ts`
- `packages/service/src/commands/init.ts`

## Workflow

1. Identify whether the issue is config resolution, credential loading, model selection, request shaping, or streaming.
2. Prefer official provider documentation and current model guidance before changing endpoints, request parameters, or model assumptions.
3. Keep provider abstraction in `packages/core` and command/setup flow in `packages/service`.
4. Test both happy paths and provider-specific fallback paths.
5. Keep logs and diagnostics useful enough to debug real provider failures.

## Guardrails

- do not hardcode one provider's assumptions into the abstraction
- do not leak secrets into logs
- keep `.env` and config handling explicit and auditable
- prefer targeted fallbacks over provider-specific branching everywhere

## Successful outcome

- provider integration remains flexible and reliable
- setup, testing, and runtime usage behave consistently
- model and credential handling stay understandable
