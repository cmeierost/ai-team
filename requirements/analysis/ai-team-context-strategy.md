# AI-Team Context & Architecture Strategy

This document describes how **ai-team** adopts the concepts from the deep research report and the general concepts overview, and how it positions itself relative to tools like GitHub Copilot, Claude Code, Cursor, and others.

The focus is **architecture and context management**, not model choice.

---

## 1. Goals

- Make ai-team a **deterministic context optimizer** and **orchestrator** for developer workflows.
- Treat LLMs (e.g., GPT-5.1, Claude, etc.) as **pluggable engines** behind a stable file- and tool-based interface.
- Keep all persistent state and long-term context in **files under `.ai-team/`** so behavior is inspectable, auditable, and VC-friendly.

In short: **ai-team owns context, routing, and permissions; models only own token-level reasoning.**

---

## 2. Concepts We Adopt as First-Class

These are concepts from the deep research report and concepts/overview that ai-team will implement explicitly.

### 2.1. Agents and Subagents

- Each "employee" in ai-team is an **agent** with:
  - Role, objectives, and responsibilities (stored in `agent.md` with YAML frontmatter).
  - Explicit `contextPaths` (which folders/files they can see).
  - A set of allowed tools (read-only vs mutating, etc.).
- **Subagents / handoffs**:
  - Manager-style agents (e.g., "Chief Architect") can **delegate** to specialized agents (e.g., "Refactoring Engineer", "Tester").
  - Delegation uses a structured **handoff payload**: goal, constraints, ownership evidence, and suggested next actions.

### 2.2. Skills / Plugins (Capabilities)

- Skills are stored as `skill.md` with YAML frontmatter + body.
- Each skill bundles:
  - One or more tools (functions) with schemas.
  - Short natural-language descriptions tuned for LLMs.
  - Optional guidance on when to use the skill.
- Agents reference skills by name in their config, which in turn controls **which tools** they can see.

### 2.3. Tool Gateway (Security & Permissions)

- All tool calls go through a central **tool gateway** in `@ai-team/core`.
- The gateway enforces:
  - Per-agent **allowlists** of tools.
  - Path constraints for file tools (no writing outside allowed roots).
  - Timeouts and quotas for expensive tools (tests, builds).
  - Structured error types (e.g., `PermissionError`, `ValidationError`).
- The LLM is never trusted directly; its tool arguments are treated as **untrusted input**.

### 2.4. Context Budgeter & Narrowing Pipeline

For each task/turn, ai-team builds a **ContextPack** for the model:

1. **Brief / Task summary**
   - Normalize user input into: goal, constraints, acceptance criteria, unknowns.
2. **Ownership & routing check**
   - Use a cheap, deterministic index to decide which agent owns the relevant code/files.
   - If a different agent should own it, return a **handoff report** instead of doing the work.
3. **Candidate generation (within scope)**
   - Sources:
     - Active file + selection.
     - Symbols and exact matches.
     - Scoped text search.
     - Import/graph neighbors.
     - Recently touched files for this task.
4. **Ranking**
   - Score chunks (not whole files) by keyword overlap, identifier matches, recency, folder proximity, and type.
5. **Packing under strict token budgets**
   - Tier 1: agent portfolio snippet + core rules + task summary.
   - Tier 2: top-ranked chunks until a configured token budget is filled.
   - Tier 3: minimal transcript snippets, only when explicitly needed.
   - Generate a **manifest** with included paths/ranges and exclusions due to budget.

### 2.5. Working Memory vs Transcripts

- For each active task, ai-team maintains a small **working summary** file (e.g., `WORKING_MEMORY.md` or structured JSON) with:
  - Current goal and constraints.
  - Key decisions.
  - Open questions.
  - Next steps.
- Full chat logs and tool traces are stored as **append-only JSONL** under `.ai-team/` but are *not* routinely sent to the LLM.
- Every N turns, the working summary is regenerated from the old summary + recent turns; old turns can be dropped from model context.

### 2.6. Workflows vs Agents

- **Workflows**:
  - Deterministic sequences (e.g., `ait init`, `ait test-connection`, project scaffolding).
  - Implemented as explicit steps in CLI/VS Code that call core APIs.
  - Easier to test and reason about.
- **Agents**:
  - Used where decisions are non-trivial (e.g., multi-file refactors, debugging).
  - Run in bounded loops with a max number of tool calls and token budgets.

ai-team prefers **workflows by default**, and uses agents only where dynamic reasoning is valuable.

### 2.7. Evaluation & Tracing

- Every LLM call and agent run should log:
  - Token usage per section (system, task summary, retrieved chunks, tools, output).
  - Files/chunks included.
  - Tools called (name + arguments + result type).
  - Ownership decisions and handoffs.
- These traces live under `.ai-team/` as JSONL and can be inspected by humans or evaluation tools later.

---

## 3. Concepts We Defer or Keep Lightweight

Some ideas from the deep report are valuable but will be implemented in minimal form at first:

- **Full-blown hierarchical memory services**:
  - We use simple files + summaries instead of a dedicated memory service.
- **Complex graph engines (LangGraph-style)**:
  - We start with simple step sequences (pipelines) inside `@ai-team/core`.
  - If needed later, we can introduce a small, explicit state machine/graph abstraction.
- **Heavy external RAG frameworks**:
  - We implement our own minimal index per agent (files, symbols, small embeddings if needed).
  - No dependency on LangChain/LlamaIndex/Haystack unless we find a clear need.

---

## 4. How Other Tools Map to AI-Team

ai-team should understand and, where helpful, emulate patterns from other tools while remaining independent.

### 4.1. GitHub Copilot (IDE-native assistant)

Key traits:
- Strong VS Code integration (inline suggestions, chat, PR review).
- Server-side repo indexing and context retrieval.
- Proprietary orchestration and safety layers.

For ai-team:
- We reuse the **agent + tools + context narrowing** ideas, but keep all logic in our own file-based core.
- ai-team can run alongside Copilot and even produce **"Focus Bundles"** that users paste into Copilot chat.

Docs:
- Copilot docs – https://docs.github.com/copilot

### 4.2. Claude Code (Anthropic)

Claude Code (part of Claude’s developer tooling) offers:
- Project-wide understanding with large context windows.
- Agent-like behaviors in editors (refactors, explanations, tests).
- Strong support for tools via Anthropic’s tool use API and MCP.

For ai-team:
- We can use Claude models as alternative backends via Anthropic’s APIs.
- ai-team can expose its tools and resources over **MCP**, so Claude Desktop / Claude Code can treat ai-team as an MCP server.
- We align with Anthropic’s **tool use** concepts: structured tools, programmatic tool calling, and multi-agent orchestration.

Docs:
- Tool use – https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Model Context Protocol – https://modelcontextprotocol.io

### 4.3. Cursor

Cursor is an AI-powered IDE/editor that:
- Adds agentic refactors, chat, and inline completions.
- Uses multiple models and retrieval strategies internally.
- Supports MCP servers and custom tools.

For ai-team:
- We treat Cursor as another **client surface** that can connect to ai-team via MCP or CLI.
- The same `.ai-team/` config and agent definitions should work whether the user is in VS Code, Cursor, or a terminal.

Docs:
- Cursor – https://www.cursor.com

### 4.4. Other Relevant Tools (High-Level)

- **ChatGPT / OpenAI API**
  - General-purpose chat and tools/function calling.
  - ai-team can use OpenAI models as one possible LLM backend.
  - Docs: https://platform.openai.com/docs

- **Codeium / Sourcegraph Cody / Replit Agents / etc.**
  - Offer coding assistance, semantic search, and/or agentic workflows.
  - Architecturally similar patterns: retrieval, tools, guardrails.
  - ai-team’s design should remain *compatible* conceptually so those tools can consume ai-team outputs (e.g., summaries, focus bundles).

ai-team’s stance:
- **No vendor lock-in**: agents, skills, and context logic live in the repo, not inside a hosted product.
- **Interop via files and MCP**: any tool that supports MCP, CLI, or simple file conventions can collaborate with ai-team.

---

## 5. Summary: What AI-Team Is (and Is Not)

- **Is:**
  - A file-based **orchestrator** that manages agents, skills, context narrowing, and tools for your codebase.
  - A way to give tools like Copilot, Claude Code, Cursor, etc. a **precise, scoped view** of your organization and responsibilities.
- **Is not:**
  - A new LLM or a competing prompt framework.
  - A monolithic agent platform with opaque state.

If a future contributor wants to add a new agent or tool, they should:
- Define it in `.ai-team/` (agent/skill files).
- Wire up a deterministic tool implementation in `@ai-team/core`.
- Ensure it passes through the context budgeter and tool gateway.

This keeps ai-team aligned with the best practices in the deep research report while staying simple, inspectable, and vendor-agnostic.