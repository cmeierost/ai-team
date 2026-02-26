# Core Concepts for LLM-Based Developer Tools

This document summarizes core concepts used across modern AI coding assistants and agentic systems (e.g., GitHub Copilot, Cursor, Claude Code, ChatGPT, etc.). It is **tool-agnostic** and focuses on patterns that we want ai-team (and its agents) to understand and reuse.

The goal is to give both humans and LLMs a shared vocabulary for designing, configuring, and collaborating with agents.

---

## 1. Agents

**Agent**: An LLM-driven process with a defined role, objectives, tools, and context. Instead of answering a single prompt, an agent pursues goals over multiple steps.

Typical properties:
- **Role & persona** – what the agent is (e.g., "Senior TypeScript Architect").
- **Objectives** – what success looks like (e.g., "keep architecture consistent", "minimize breaking changes").
- **Scope & responsibilities** – what it is allowed/expected to do.
- **Context** – which files, documents, or APIs it can see.
- **Tools** – functions or APIs the agent can call (e.g., run tests, edit files).

Patterns:
- Agents operate in **loops**: observe → think → act (tools) → observe results → continue or stop.
- Good agents have **clear boundaries** (what they may *not* do) to reduce hallucinations and mistakes.
- Agents often maintain **state** (memory, plans, logs) across steps or sessions.

References:
- OpenAI: *Function calling and agents* – https://platform.openai.com/docs/guides/function-calling
- Anthropic: *Tool use and agents* – https://docs.anthropic.com/en/docs/build-with-claude/tool-use

---

## 2. Subagents (Hierarchies of Agents)

**Subagent**: An agent that is invoked by another agent (the "parent") to handle a subtask or a specialized role.

Patterns:
- **Hierarchical delegation** – a top-level agent (e.g., "Chief Architect") delegates to specialized agents (e.g., "Refactoring Engineer", "Test Writer").
- **Narrower context** – subagents usually see a smaller subset of files or data.
- **Specialized tools** – subagents may have extra tools or stricter constraints.
- **Explicit contracts** – parents call subagents with a clear task, inputs, and expected outputs.

Benefits:
- Decomposes large tasks into smaller, easier subtasks.
- Encourages *separation of concerns* and reduces context size.
- Makes it easier to reason about responsibilities and permissions.

References:
- Anthropic: *Orchestrating multi-agent systems* – https://docs.anthropic.com/en/docs/build-with-claude/multi-agent
- Microsoft: *Agent orchestration patterns* – https://learn.microsoft.com/azure/ai-services/openai/concepts/agents

---

## 3. Skills (Capabilities / Tools / Abilities)

**Skill**: A reusable capability that an agent can invoke. Skills are often implemented as tools, functions, or APIs with structured inputs and outputs.

Examples:
- Code skills: search repo, read file, apply patch, run tests, run formatter.
- Knowledge skills: semantic search, question answering over docs.
- Operations skills: call external APIs, manage tickets, update dashboards.

Characteristic properties:
- **Name** – how the agent refers to the skill (e.g., `read_file`, `run_tests`).
- **Description** – short natural-language explanation, tuned for LLMs.
- **Parameters schema** – typically defined with JSON Schema-like structures (types, required fields, enums).
- **Return shape** – structured output that downstream steps can interpret.

Design guidelines:
- Make skills **small, composable, and side-effect-aware**.
- Use **clear, unambiguous names** and **short descriptions** focused on when to use the skill.
- Always validate & sanitize inputs on the implementation side.
- Capture **permissions** and **scope** in the skill design (e.g., which paths an agent can read/write).

References:
- OpenAI: *Tools (formerly functions)* – https://platform.openai.com/docs/guides/tools
- Microsoft: *Agent tools and actions* – https://learn.microsoft.com/azure/ai-services/openai/concepts/tools

---

## 4. Tool Use (Function Calling)

**Tool use** (or **function calling**) is how an LLM decides to call structured functions instead of only replying with text.

Key ideas:
- The model is given a list of tools (skills) with JSON-like schemas.
- The model chooses whether to call a tool, which one, and with what arguments.
- The host system executes the tool and feeds the results back into the model as context.

Patterns used by coding assistants:
- **Read → analyze → modify** loops: read files, propose edits, apply patches, re-run tests.
- **Verification loops**: run linters/tests after changes and inspect outputs.
- **Backtracking**: undo/revise earlier changes based on errors or feedback.

Good practice:
- Use **narrow, well-typed tool schemas**.
- Make error messages and tool outputs **LLM-friendly** (concise, structured).
- Log tool calls for **auditability and debugging**.

References:
- OpenAI: *Tool calling* – https://platform.openai.com/docs/guides/function-calling
- Anthropic: *Tool use* – https://docs.anthropic.com/en/docs/build-with-claude/tool-use

---

## 5. MCP (Model Context Protocol)

**MCP – Model Context Protocol** is an open protocol for connecting models to external data sources and tools in a consistent way.

Core concepts:
- **Servers** – provide tools, resources, and prompts; can be written in many languages.
- **Clients** – editors and apps (e.g., VS Code, Cursor, Claude Desktop) that host the model and talk to MCP servers.
- **Resources** – read-only data sources (files, HTTP endpoints, DBs) exposed to the model.
- **Tools** – callable operations the model can execute via MCP.

Why it matters:
- Standardizes how tools/resources are described and discovered.
- Supports **secure, permissioned access** to local and remote data.
- Allows multiple tools to be shared across different model hosts and UIs.

References:
- Model Context Protocol: https://modelcontextprotocol.io
- Claude Desktop + MCP: https://docs.anthropic.com/en/docs/model-context-protocol

---

## 6. Context Management (Focusing the Model)

**Context**: The information (files, history, instructions, tool results) the model sees at a given step. Because context is limited, good tools aggressively **narrow** and **prioritize** it.

Common techniques:
- **File & symbol selection** – only load the files relevant to the current task.
- **Semantic search** – retrieve code or docs by meaning, not just keywords.
- **Summaries & embeddings** – store compressed representations of files, PRs, or docs for quick lookup.
- **Windows & chunking** – break large files into chunks, bring in only what is needed.
- **Role-based views** – different agents see different slices of the workspace.

Goals:
- Minimize distractions and irrelevant context.
- Keep *instructions* and *constraints* prominent (e.g., architecture rules, coding standards).
- Ensure privacy and security boundaries are respected.

References:
- Microsoft: *Prompt engineering and context windows* – https://learn.microsoft.com/azure/ai-services/openai/concepts/prompt-engineering
- OpenAI: *Context and retrieval* – https://platform.openai.com/docs/guides/retrieval

---

## 7. Planning and Decomposition

**Planning**: Asking the model to outline steps before acting, then executing those steps one by one.

Patterns:
- **Plan-then-act** – first generate a numbered plan, then execute each step.
- **Dynamic replanning** – revise the plan when new information arrives (e.g., failing tests).
- **Checkpoints** – summarize progress periodically so humans (and other agents) can inspect.

Benefits:
- Makes agent behavior more **transparent** and debuggable.
- Helps with long, multi-step coding tasks (refactors, migrations, large features).

References:
- Microsoft: *Agent patterns and planning* – https://learn.microsoft.com/azure/ai-concepts/ai-agents-patterns
- Anthropic: *Building dependable agents* – https://docs.anthropic.com/en/docs/build-with-claude/dependable-agents

---

## 8. Memory (Short-Term and Long-Term)

**Memory**: Information persisted across turns or sessions so agents can stay consistent over time.

Types:
- **Short-term** – conversation history, recent tool results, current task state.
- **Long-term** – project decisions, architecture rules, prior incidents, per-user preferences.

Implementation patterns:
- **Message logs** – append-only logs (often JSONL) of interactions.
- **Knowledge base** – curated docs (markdown, wikis) that agents can search.
- **Vector stores** – embedding-based retrieval for free-form text and code.

Design considerations:
- Privacy & security: what must *not* be persisted.
- Freshness: when and how to update or expire memory.
- Provenance: link memories back to source files or discussions.

References:
- OpenAI: *Long-term memory concepts* – https://platform.openai.com/docs/guides/memory
- Microsoft: *AI memory patterns* – https://learn.microsoft.com/azure/ai-concepts/ai-memory-patterns

---

## 9. Guardrails, Permissions, and Safety

**Guardrails**: Constraints and checks that shape what agents are allowed to do and how they behave.

Common patterns:
- **Permissioned tools** – agents can only call tools on specific paths or resources.
- **Read/write separation** – read-only vs. mutating capabilities.
- **Policy prompts** – explicit instructions about forbidden actions (e.g., no secrets, no network).
- **Human-in-the-loop** – require user confirmation for high-risk operations (large refactors, deletions, deployments).

Why it matters:
- Protects codebases and infrastructure.
- Increases trust in autonomous or semi-autonomous agents.
- Makes failures more graceful and recoverable.

References:
- Microsoft: *Safety for AI systems* – https://learn.microsoft.com/azure/ai-services/openai/concepts/safety
- Anthropic: *Responsible use of Claude* – https://docs.anthropic.com/en/docs/safety

---

## 10. Multi-Modal Inputs (Code, Text, UI, Logs)

Modern tools increasingly mix **multiple modalities**:
- **Code** – source files, diffs, ASTs.
- **Text** – docs, tickets, commit messages.
- **UI state** – cursor position, selected text, active tests.
- **Runtime data** – logs, stack traces, profiler output.

Agents can be more effective when they:
- Combine code and docs to infer intent.
- Use runtime signals (errors, performance issues) to propose targeted fixes.
- Reflect UI context (what the developer is looking at) when generating suggestions.

References:
- GitHub Copilot: *Context-aware coding* – https://docs.github.com/copilot
- OpenAI: *Multimodal models* – https://platform.openai.com/docs/guides/vision

---

## How ai-team Should Use These Concepts

- Represent **agents**, **subagents**, and **skills** explicitly in files under `.ai-team/` (YAML/JSON + markdown).
- Use **context paths** and **permissions** to enforce which files agents can see and modify.
- Expose capabilities as **tools/skills** with clear schemas, not ad-hoc strings.
- Use **semantic search and summaries** to keep context focused.
- Encourage **planning, logging, and checkpoints** for all non-trivial tasks.
- Treat **guardrails and safety** as first-class concerns, not afterthoughts.

This document is intentionally high-level and implementation-agnostic so it can guide designs for VS Code, CLI, web, or any future surfaces that rely on ai-team agents.