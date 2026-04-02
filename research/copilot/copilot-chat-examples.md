# Copilot Chat: Technical Examples & Architecture

This document provides concrete technical examples of prompts, tool call requests/responses, and a breakdown of what happens on the GitHub Copilot server versus the VS Code client. It also clarifies which tools are part of VS Code and which are specific to Copilot.

---

## 1. Example: System Prompt (Injected to LLM)

```
You are Copilot, an AI coding assistant. You can answer questions and call tools to help the user. Available tools:

- semantic_search: Search codebase semantically. Parameters: { query: string }
- read_file: Read file contents. Parameters: { filePath: string, startLine?: number, endLine?: number }
- get_errors: Get linter/compiler errors. Parameters: { filePaths?: string[] }

To call a tool, emit a JSON object like:
{"tool_call": {"tool": "read_file", "parameters": {"filePath": "src/index.ts", "startLine": 1, "endLine": 20}}}

Respond with explanations or code as appropriate. If you need more information, ask the user.
```

---

## 2. Example: User Message

```
User: Show me all errors in src/index.ts
```

---

## 3. Example: LLM Response (Tool Call)

```
{"tool_call": {"tool": "get_errors", "parameters": {"filePaths": ["src/index.ts"]}}}
```

---

## 4. Example: Tool Result (Appended to Chat)

```
{"role": "tool", "tool": "get_errors", "result": [{"file": "src/index.ts", "line": 12, "message": "Unexpected token"}]}
```

---

## 5. Example: LLM Follow-up (User-facing)

```
There is an error in src/index.ts at line 12: "Unexpected token".
```

---

## 6. Architecture: Server vs. Client Responsibilities

### 6.1. VS Code Client
- Captures user input and displays chat UI.
- Maintains local context (open files, recent edits).
- Sends chat history, system prompt, and tool schemas to the Copilot server.
- Receives LLM responses and tool call requests.
- Executes tool calls that are implemented locally (e.g., file search, read file, run terminal command).
- Appends tool results to chat and sends them back to the LLM if needed.

### 6.2. GitHub Copilot Server
- Hosts the LLM (e.g., GPT-4, Codex).
- Receives chat history, system prompt, and tool schemas from the client.
- Generates responses, including tool call requests in structured format.
- May perform some server-side tool calls (e.g., semantic search if codebase is indexed in the cloud).
- Returns responses to the client for further action.

---

## 7. Tool Integration: VS Code vs. Copilot

### 7.1. Tools Integrated in VS Code
- File system access (read/write files)
- Terminal commands
- Linter/compiler error retrieval
- Git status and operations
- These tools are exposed to Copilot and other extensions via VS Code APIs.
- Can be used by other extensions, not just Copilot.

### 7.2. Copilot-Specific Logic
- LLM prompt construction and context narrowing
- Tool call schema definition and injection
- Chat orchestration (parsing tool calls, chaining, error handling)
- Agent/subagent management
- Only Copilot (or compatible AI extensions) use the full tool orchestration and agent system as described.

---

## 8. Request/Response Flow Example

1. **User types:** "Find all TODO comments in utils/"
2. **VS Code client:**
   - Sends chat history, system prompt, and tool schemas to Copilot server.
3. **Copilot server (LLM):**
   - Receives prompt, emits a tool call:
     `{ "tool_call": { "tool": "semantic_search", "parameters": { "query": "TODO", "path": "utils/" } } }`
4. **VS Code client:**
   - Executes semantic search locally (or via extension API).
   - Appends result to chat as a tool message.
   - Sends updated chat to Copilot server for follow-up.
5. **Copilot server (LLM):**
   - Receives tool result, generates user-facing summary or next tool call.

---

## 9. Summary Table: What Runs Where

| Feature                | VS Code Client | Copilot Server |
|------------------------|:--------------:|:--------------:|
| Chat UI                |      ✔️        |                |
| LLM Inference          |                |      ✔️        |
| Tool Call Execution    |      ✔️        |   (sometimes)  |
| File/Terminal Access   |      ✔️        |                |
| Prompt Construction    |      ✔️        |      ✔️        |
| Agent/Skill Logic      |      ✔️        |      ✔️        |

---

*This document is maintained as of February 2026 and provides technical clarity on Copilot chat, tool calls, and the division of responsibilities between VS Code and the Copilot server.*
