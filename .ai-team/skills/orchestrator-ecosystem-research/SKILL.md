---
name: orchestrator-ecosystem-research
description: Use when comparing AI coding assistants, agent orchestrators, MCP clients, IDE extensions, or open-source agent stacks such as Copilot, Claude Code, Cursor, OpenCode, Continue, Goose, and similar tools, especially when the goal is to turn ecosystem research into concrete ai-team strategy.
---

# Orchestrator ecosystem research

Use this skill when the work is not just “look something up,” but “understand what the current ecosystem is doing and what that should change for ai-team.”

This includes:

- comparing AI coding assistants and agent orchestrators
- reading official docs, product docs, open-source repos, and extension code
- understanding MCP support, tool models, delegation patterns, and UX surfaces
- identifying where ai-team is ahead, behind, or intentionally different
- turning research into architecture or product recommendations

## Read these first

1. `analysis/ai-team-context-strategy.md`
2. `analysis/concepts/overview.md`
3. `analysis/concepts/deep-research-report.md`
4. `analysis/copilot/**/*`
5. `ARCHITECTURE.md`
6. `COPILOT-CONTEXT.md`

## Workflow

### 1. Frame the comparison question tightly

Decide what kind of question this is:

- product capability comparison
- orchestration/runtime pattern comparison
- extension or IDE workflow comparison
- protocol/tooling interoperability comparison
- strategic gap analysis for ai-team

Do not start with one giant “compare everything” query if the real question is narrower.

### 2. Use repo knowledge before outside noise

Check whether `analysis/` already contains durable notes about the tools or patterns in question.

Prefer repo-local conclusions when they already answer the question well enough.

### 3. Use Tavily-first search discipline for external research

When a Tavily-backed search path is available in the calling environment, use Tavily as the primary external retrieval engine.

Apply Tavily best practices:

- keep queries concise and precise
- split broad comparisons into focused subqueries
- prefer official docs and source repos before commentary
- use search first, then extract/fetch deeper pages when needed
- gather enough evidence to separate product facts from marketing language

If Tavily is not directly available, keep the same research discipline with the best available search and fetch tools instead of dropping into random browsing.

### 4. Inspect code when docs are not enough

For claims about real behavior, inspect:

- public repos
- extension manifests
- package structure
- protocol/server examples
- issue discussions or release notes when they materially change behavior

Do not rely on feature matrices alone when implementation reality matters.

### 5. Turn findings into ai-team implications

For each important finding, summarize:

- **Signal** — what changed or what the other tool clearly does
- **Evidence** — docs, code, or release/source backing it
- **Implication for ai-team** — why this matters here
- **Recommended move** — adopt, ignore, watch, or differentiate

### 6. Stay in the right lane

- research should support strategy and architecture, not replace them
- hand Copilot-specific discovery questions to `copilot-expert` when that is the real core of the task
- hand extension implementation follow-through to `marcus-vale`
- hand backend runtime or provider execution changes to the relevant backend owner

## Successful outcome

- ecosystem research is current, evidence-backed, and implementation-aware
- ai-team gets concrete strategic recommendations instead of trend summaries
- official docs, repo evidence, and code inspection are separated clearly from speculation