# Copilot System Overview

This document provides a comprehensive, up-to-date overview of how GitHub Copilot and similar AI coding assistants operate, focusing on context management, token efficiency, tool invocation, and advanced agent concepts. It is structured for both human and AI readability, starting from high-level concepts and drilling down into technical details.

---

## 1. What is Copilot?

GitHub Copilot is an AI-powered coding assistant that helps developers by suggesting code, generating functions, and automating repetitive tasks. It leverages large language models (LLMs) and a tool system to provide context-aware assistance directly in the IDE.

---

## 2. Context Management

### 2.1. Context Narrowing
- **Purpose:** To reduce the amount of code and information sent to the LLM, improving relevance and reducing cost.
- **How it works:**
  - Uses semantic and syntactic search to select only the most relevant files, code snippets, or documentation.
  - Prioritizes recent edits, open files, and code near the cursor.
  - May use embeddings or similarity search to find related code.
- **Benefits:**
  - Reduces token usage (cost and latency).
  - Increases the quality of suggestions by focusing on relevant context.

### 2.2. Context Storage
- **Short-term:**
  - Keeps a working set of files, recent edits, and user queries in memory.
- **Long-term:**
  - May store summaries, embeddings, or metadata in local files or a database for faster retrieval.
  - In multi-agent systems, context is often stored in structured files (e.g., JSON, Markdown with YAML frontmatter) for agent access and permission control.

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
- **Definition:** Tools are external functions or APIs Copilot can invoke to perform actions (e.g., file search, run tests, fetch documentation).
- **How it works:**
  - The LLM generates a structured tool call (with parameters).
  - The Copilot agent executes the tool, collects results, and may feed them back into the LLM for further reasoning.
- **Examples:**
  - `semantic_search`, `read_file`, `write_file`, `get_errors`, `run_in_terminal`, etc.

### 4.2. Tool Handling
- **Permission Checks:**
  - Agents check if they have access to the requested files or actions.
- **Chaining:**
  - Tools can be called in sequence, with outputs from one used as inputs to another.
- **Error Handling:**
  - Typed errors are thrown for permission issues, missing files, or invalid tool calls.

---

## 5. Agents, Subagents, and Skills

### 5.1. Agents
- **Definition:** Autonomous entities with specific roles (e.g., code writer, reviewer, HR director).
- **Capabilities:**
  - Each agent has a set of tools and context paths it can access.
  - Agents can delegate tasks to subagents or other agents.

### 5.2. Subagents
- **Definition:** Temporary or specialized agents spawned to handle complex or multi-step tasks.
- **Usage:**
  - Used for research, multi-file search, or when a task requires isolation.

### 5.3. Skills
- **Definition:** Domain-specific knowledge or capabilities that can be loaded by agents (e.g., knowledge of a framework, API, or workflow).
- **Format:**
  - Typically stored as Markdown with YAML frontmatter for metadata.

---

## 6. Model Context Protocol (MCP)

- **Purpose:**
  - Standardizes how context, tool calls, and agent interactions are structured and exchanged between the IDE, LLM, and tools.
- **Features:**
  - Defines schemas for tool calls, agent messages, and context payloads.
  - Enables interoperability between different AI assistants and tools.

---

## 7. Extensibility & Other Tools

- **Claude Code, Codex, OpenCode, Cursor, etc.:**
  - Other AI coding assistants with similar architectures, often supporting their own tool/plugin systems and context management strategies.
- **Tool List (examples):**
  - `semantic_search`, `file_search`, `read_file`, `write_file`, `get_errors`, `get_git_status`, `delegate_to_agent`, `ask_human`, `create_agent`, `archive_agent`, `assess_performance`.

---

## 8. References & Further Reading
- See project documentation in `ARCHITECTURE.md` and `COPILOT-CONTEXT.md` for implementation details.
- For agent/skill file formats, see `packages/core/` and `requirements/analysis/`.

---

*This document is maintained as of February 2026 and reflects the latest best practices and system architecture for Copilot and related AI coding assistants.*
