# Copilot System Overview

This document provides a high-level overview of how **GitHub Copilot** and similar AI coding assistants operate, with emphasis on context management, customization, tool use, and agent-oriented workflows.

It intentionally separates **documented platform behavior** from **reasonable architectural inference**. Exact internal implementations are proprietary and can change over time.

---

## 1. What is Copilot?

GitHub Copilot is an AI-powered coding assistant that helps developers by suggesting code, generating functions, and automating repetitive tasks. It leverages large language models (LLMs) and a tool system to provide context-aware assistance directly in the IDE.

---

## 2. Context Management

### 2.1. Context Narrowing

- **Purpose:** To reduce irrelevant context, improve relevance, and keep latency and token usage under control.

- **How it works (documented + inferred):**
  - VS Code automatically provides local context such as the active file, current selection, and nearby code.
  - Copilot can also use broader codebase context through indexing, search, symbols, references, and explicitly attached context.
  - Recent edits, open files, referenced files, and specific user-supplied context are typically more influential than unrelated repository content.
- **Benefits:**
  - Reduces token usage (cost and latency).
  - Increases the quality of suggestions by focusing on relevant context.

### 2.2. Context Storage

- **Session context:**
  - Chat sessions retain conversation history and task context until the session is reset, trimmed, or replaced.

- **Workspace context:**
  - Copilot can use project structure, indexing, referenced files, and customization files to recover relevant context across requests.

- **Important note:**
  - Public docs describe context sources and session behavior, but do **not** fully document GitHub's exact internal storage model.

---

## 3. Token Cost Optimization

- **Token Budgeting:**
  - Each LLM call has a token limit (input + output). Copilot dynamically selects context to fit within this budget.
- **Chunking:**
  - Large files are split into chunks; only the most relevant are included.
- **Deduplication:**
  - Removes redundant or repeated context.
- **Compression:**
  - May use summarization or code folding to fit more information.

---

## 4. Tool System & Invocation

### 4.1. Tool Calls

- **Definition:** Tools are capabilities Copilot can use to inspect code, gather context, or take action.

- **How it works (conceptually):**
  - In agent-capable environments, the model can request tool use.
  - The host environment executes the tool and returns the result back into the interaction.

- **Examples of tool categories:**
  - file and symbol search
  - reading workspace files
  - running terminal commands
  - fetching external documentation
  - interacting with MCP-provided services

> Note: Tool names vary by environment. This repository's tool names are **not** official GitHub Copilot tool names.

### 4.2. Tool Handling

- **Permission Checks:**
  - Available tools depend on the client, configuration, repository policies, and enabled integrations.

- **Chaining:**
  - Agent workflows may combine search, edits, terminal actions, and follow-up reasoning.

- **Error Handling:**
  - Tool failures become part of the interaction and can inform the next model step.

---

## 5. Agents, Subagents, and Skills

### 5.1. Agents

- **Definition:** Agent-capable Copilot experiences can plan and execute multi-step tasks instead of only answering with plain text.

- **Capabilities:**
  - Agents can gather context, edit files, run commands, and iterate toward a result depending on the host environment.

### 5.2. Subagents

- **Definition:** Some Copilot environments support delegating work to specialized subordinate agents.

- **Usage:**
  - Useful for isolated research, planning, or role-specific workflows.

### 5.3. Skills

- **Definition:** Portable, task-specific capabilities packaged as folders containing a `SKILL.md` file and optional supporting resources.

- **Format:**
  - Agent Skills are an open standard documented at `agentskills.io` and supported across multiple Copilot-related environments.

---

## 6. Model Context Protocol (MCP)

- **Purpose:**
  - MCP standardizes how external tools and services are exposed to agentic AI systems.
- **Features:**
  - Enables Copilot to connect to external systems through structured tool integrations.
  - Improves interoperability between agent hosts and external tool providers.

---

## 7. Extensibility & Related Systems

- **Claude Code, Codex, Cursor, and similar systems:**
  - Other AI coding assistants use related ideas: context selection, tool invocation, instructions, skills, and session management.
- **Important caution:**
  - Similar concepts do **not** imply identical protocols, file locations, or exact behavior.

---

## 8. References & Further Reading

- See project documentation in `ARCHITECTURE.md` and `COPILOT-CONTEXT.md` for local implementation context.
- See `analysis/copilot/copilot-files.md` for current guidance on instructions, prompts, agents, skills, and file discovery behavior.

---

*Updated March 2026. This document reflects current public documentation plus clearly labeled architectural inference where GitHub or Microsoft do not publish exact implementation details.*
