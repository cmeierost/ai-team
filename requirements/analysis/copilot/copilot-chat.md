# Copilot Chat System: Detailed Technical Explanation

This document provides an in-depth, up-to-date explanation of how the Copilot chat system operates, with a focus on tool invocation, message flow, and the mechanisms that enable the LLM to call tools. It is intended for both human and AI readers.

---

## 1. Chat System Overview

The Copilot chat system is an interactive interface where users can converse with an AI assistant. The assistant can answer questions, generate code, and perform actions by invoking tools. The chat system is designed to:
- Maintain conversational context
- Dynamically decide when to call tools
- Integrate tool results into the conversation

---

## 2. Message Flow & Context Handling

### 2.1. Message Structure
- Each chat message is stored as a structured object (often JSONL for append-only logs).
- Messages include:
  - `role` (user, assistant, tool, system)
  - `content` (text, code, or tool call)
  - `metadata` (timestamp, tool name, parameters, etc.)

### 2.2. Context Window
- The chat system maintains a rolling window of recent messages, fitting within the LLM's token budget.
- Older messages may be summarized or omitted to save tokens.
- Context includes:
  - User queries
  - Assistant responses
  - Tool call requests and results

---

## 3. Tool Call Mechanism

### 3.1. How the LLM Knows It Can Call Tools
- **System Prompt:**
  - The LLM is initialized with a system prompt that describes available tools, their schemas, and usage instructions.
  - Example: "You can call tools by emitting a JSON object with the tool name and parameters."
- **Tool Manifest:**
  - A manifest (list of available tools, their descriptions, and parameter schemas) is provided to the LLM at the start of the session or on demand.
- **Schema Injection:**
  - Tool schemas are injected into the prompt, so the LLM knows the exact input/output format for each tool.
- **Few-shot Examples:**
  - The prompt may include example tool calls and responses to teach the LLM how to invoke tools.

### 3.2. Tool Call Generation
- When the LLM determines that a user request requires external action (e.g., file read, search, run command), it emits a structured tool call in its response.
- The tool call is typically a JSON object specifying:
  - `tool_name`
  - `parameters`
- The chat system parses the LLM output, detects tool calls, and routes them to the appropriate handler.

### 3.3. Tool Execution & Result Integration
- The backend executes the requested tool with the provided parameters.
- The result (success, error, or data) is appended to the chat as a new message (role: tool).
- The LLM receives the tool result as part of the next prompt, allowing it to continue the conversation or reason further.

---

## 4. Tool Call Lifecycle (Step-by-Step)

1. **User Message:** User sends a query (e.g., "Show me all errors in main.ts").
2. **LLM Processing:**
   - LLM receives the chat history and system prompt (with tool schemas).
   - LLM decides a tool call is needed and emits a tool call object.
3. **Tool Call Detection:**
   - The chat system parses the LLM output for tool call objects.
   - If found, it extracts the tool name and parameters.
4. **Tool Execution:**
   - The backend runs the tool (e.g., `get_errors` on `main.ts`).
   - The result is captured (output, error, or data).
5. **Result Message:**
   - The tool result is appended to the chat log as a tool message.
6. **LLM Follow-up:**
   - The LLM receives the updated chat history (including the tool result) and generates a new response, which may:
     - Present the result to the user
     - Chain further tool calls
     - Continue the conversation

---

## 5. Tool Call Permissions & Safety
- **Permission Checks:**
  - Before executing a tool, the system checks if the agent has access to the requested resource (file, command, etc.).
  - If not, a typed error (e.g., `PermissionError`) is returned to the LLM.
- **Error Handling:**
  - Tool errors are formatted as tool messages and included in the chat context for the LLM to handle gracefully.

---

## 6. Advanced Concepts

### 6.1. Multi-Turn Tool Chaining
- The LLM can chain multiple tool calls across several turns, using results from previous calls as input for subsequent actions.

### 6.2. Subagents in Chat
- For complex tasks, the chat system may spawn subagents to handle research, multi-step workflows, or isolated tool calls.
- Subagent results are integrated back into the main chat context.

### 6.3. Skill Injection
- Domain-specific skills (knowledge, workflows) can be injected into the chat context, enabling the LLM to answer specialized queries or use custom tools.

---

## 7. File Formats & Storage
- **Chat logs:** Stored as JSONL (one message per line) for efficient append and retrieval.
- **Tool schemas:** Defined in code or as JSON/YAML files, injected into the LLM prompt.

---

## 8. References
- See `packages/core/chat/` and `packages/cli/commands/chat.ts` for implementation details.
- For tool schemas and agent permissions, see `packages/core/tools/` and `packages/core/types/`.

---

*This document is maintained as of February 2026 and reflects the latest architecture and best practices for Copilot chat and tool invocation.*
