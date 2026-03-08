# ChatGPT Modes Overview

This document summarizes how ChatGPT "modes" work conceptually, focusing on research/browsing, tools, and other major capabilities. It is written for both humans and AI agents in this repo.

---

## 1. Standard Chat Mode

- Uses only the base LLM + conversation history.
- No explicit web access or code execution.
- All answers are generated from model weights and the current chat context.

---

## 2. Research / Browsing Mode

- Purpose: answer questions that depend on up-to-date or niche information from the internet.
- Pipeline (conceptual):
  - **Query analysis:** interpret the user request and derive one or more search queries.
  - **Web search:** call a search engine API to get ranked results.
  - **Page selection:** choose a small number of promising URLs.
  - **Content extraction:** fetch pages and strip boilerplate (ads, layout) to keep main text.
  - **Source reading:** summarize each source, extract key facts, and note conflicts.
  - **Answer synthesis:** combine user question + extracted facts into a final answer, often with citations.
- Guarantees/limits:
  - Still grounded in the base model; web results are extra context, not a replacement.
  - Cannot typically access paywalled or login-gated internal content.
  - Reduces hallucinations on factual/current topics compared to offline-only mode, but is still fallible.

---

## 3. Advanced Data Analysis / Code-Interpreter Style Mode

- Adds a sandboxed runtime (typically Python) and a temporary filesystem.
- The model can:
  - Load user-uploaded files (CSV, JSON, text, etc.).
  - Execute analysis code (statistics, transformations, plotting).
  - Generate artifacts (images, reports, transformed datasets).
- Loop:
  - Model writes code → sandbox executes → outputs (stdout, errors, files) are fed back into the model → model explains or refines.
- Security is enforced by the sandbox (no or limited network, resource limits, restricted libraries).

---

## 4. Image Generation Mode

- Uses a dedicated image-generation model (e.g., DALL·E-like) separate from the main chat model.
- Flow:
  - Chat model helps interpret/refine the user prompt.
  - Image model generates one or more images from the refined prompt.
  - Images are returned directly; the chat model may optionally describe or iterate based on feedback.

---

## 5. Vision / Image Understanding Mode

- Makes the model multimodal: it can consume images + text.
- Pipeline:
  - A vision encoder turns the image into a compact representation.
  - The LLM conditions on this representation plus the user prompt.
  - The model answers questions, describes the image, reads text in the image, etc.
- Can solve tasks like:
  - Describing UI screenshots.
  - Reading charts and tables.
  - Explaining diagrams or code snippets in images.

---

## 6. Voice Mode

- Primarily a UX layer around standard chat:
  - Speech-to-text (STT) converts audio to text.
  - Text is sent to the LLM as a normal prompt.
  - Text-to-speech (TTS) renders the answer as audio.
- May use specialized, lower-latency models or streaming strategies to keep conversations fluid.

---

## 7. Tools, Integrations, and MCP

- ChatGPT can call external tools via structured tool calls (functions with JSON parameters).
- Examples of tool capabilities:
  - Call REST or GraphQL APIs.
  - Query internal knowledge bases or databases.
  - Manipulate files or trigger workflows.
- The **Model Context Protocol (MCP)** standardizes how these tools are exposed as separate servers:
  - Each MCP server defines tools with schemas and capabilities.
  - Multiple clients (ChatGPT, IDEs, custom apps) can connect to the same MCP server.
  - Centralizes permissions, logging, and behavior instead of reimplementing integrations per client.

---

## 8. Relationship to This Project

- Our `ai-team` project uses a similar concept of agents + tools:
  - Agents call tools like `semantic_search`, `read_file`, `write_file`, `get_errors`, etc.
  - Context and permissions are controlled via file-based state and `contextPaths`.
- ChatGPT research mode ≈ an external web-search toolchain.
- ChatGPT code-interpreter mode ≈ an external analysis runtime tool.
- MCP-like servers map well to our agent tools:
  - A single backend can expose capabilities to multiple frontends (CLI, VS Code, web, ChatGPT).

---

*Maintained as of February 2026. Update this document as new modes or capabilities become relevant to the project.*
