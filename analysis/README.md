# Analysis Knowledge Base

This folder collects structured knowledge about external tools, AI assistants, and related systems that we want to learn from when designing and implementing features in **ai-team**.

---

## Purpose

- Document how tools (e.g., GitHub Copilot, ChatGPT, other assistants) work conceptually and architecturally.
- Capture patterns around context management, tool invocation, modes, and security.
- Serve as a long-lived reference for designing agents, tools, and workflows in this repo.

---

## Structure

- Each subfolder focuses on a specific system or product, for example:
  - `copilot/` – GitHub Copilot and related coding assistants.
  - `chaggpt/` – ChatGPT modes, research/browsing, tools, MCP.
  - Additional folders can be added for other tools (e.g., `cursor/`, `opencode/`, etc.).
- Inside each subfolder:
  - `*-overview.md` files: high-level conceptual and architectural summaries.
  - Optional deep-dive docs: focused topics (e.g., context narrowing, code execution, web search).

---

## How to Use This Folder

- When designing a new **ai-team** feature (agent behavior, tool, UI flow):
  - Check the relevant subfolder for patterns and constraints.
  - Reuse concepts like context narrowing, tool schemas, and permission models.
- When learning from a new external system:
  - Create a new subfolder.
  - Add an `*-overview.md` summarizing how it works.
  - Keep documents concise, implementation-focused, and updated with the current understanding.

---

*This folder is for durable, implementation-relevant knowledge. Prefer clear, action-oriented summaries over long essays, so both humans and agents can quickly retrieve what they need.*
