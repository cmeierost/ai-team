# ChatGPT / OpenAI Models: Concepts Complementing Copilot Docs

This document fills gaps in the Copilot-focused notes by describing how ChatGPT and OpenAI chat models (e.g., GPT-5.1 in this workspace) work conceptually, with emphasis on:

- Chat message format and roles
- Tools / function calling in the OpenAI API
- Conversation vs. memory and summarization
- Streaming, rate limits, and costs
- How this maps onto your AI-Team context narrowing design
- Pointers to official public documentation

It is **not** an internal spec (OpenAI internals are proprietary); it reflects public APIs and typical usage patterns as of early 2026.

---

## 1. Chat Message Format & Roles (OpenAI API)

Your Copilot docs describe "system prompt" and messages; here is the more precise OpenAI structure:

- Requests to chat models use a `messages[]` array of objects:
  - `role`: one of `"system"`, `"user"`, `"assistant"`, `"tool"`.
  - `content`: text or structured parts (for some models, an array supporting text, images, etc.).
  - Optional `name` or `tool_call_id` fields for disambiguation.

Typical minimal call:

```jsonc
{
  "model": "gpt-5.1",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Explain context narrowing in ai-team." }
  ]
}
```

- **System messages** define high-level rules, persona, and safety instructions.
- **User messages** contain human questions and commands.
- **Assistant messages** contain model replies and, when using tools, tool call specifications.
- **Tool messages** represent tool outputs that are fed back into the model.

This is the same conceptual structure you already use in your `copilot-chat.md`, but these role names and their constraints are specific to the OpenAI API.

---

## 2. Tools / Function Calling (OpenAI-style)

Your docs describe tools conceptually; here is the concrete OpenAI API pattern often called "function calling" or just "tools":

- You pass a `tools` array describing each callable tool:

```jsonc
"tools": [
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "Read a file from the workspace.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "start_line": { "type": "integer", "minimum": 1 },
          "end_line": { "type": "integer", "minimum": 1 }
        },
        "required": ["path"]
      }
    }
  }
]
```

- The model can decide to call a tool by emitting a special assistant message with `tool_calls`:

```jsonc
{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{ \"path\": \"src/index.ts\", \"start_line\": 1, \"end_line\": 40 }"
      }
    }
  ]
}
```

- Your host (VS Code extension, CLI, or server) executes the tool, then adds a `tool` role message:

```jsonc
{
  "role": "tool",
  "tool_call_id": "call_1",
  "name": "read_file",
  "content": "// contents of src/index.ts ..."
}
```

- You then call the model again with the updated `messages` array so it can continue reasoning.

This is precisely the mechanism you conceptually describe in `copilot-chat.md`; here it is grounded in the actual OpenAI API fields.

---

## 3. Conversation vs Memory (ChatGPT Product)

Your context-narrowing summary says "Conversation ≠ Memory"; that aligns with how ChatGPT and the OpenAI API behave:

- **Session context**: For a given chat session, previous messages are resent (or summarized and resent) with each API call. The model itself is stateless across calls.
- **Long-term memory**:
  - By default, the base API has **no persistent memory** between sessions. Any persistence (e.g., project summaries, user preferences) must be implemented by your own storage and summarization layer.
  - ChatGPT the product may offer UI features like "Memories" or "Custom Instructions"; these are implemented as additional context injected into `system` or `assistant` messages by OpenAI’s service layer.

Your `WORKING_MEMORY.md` pattern and rolling Task Summary mimic this: you explicitly store and compress state outside the model, instead of assuming the model remembers everything.

---

## 4. Streaming, Rate Limits, and Cost

These aspects are not yet captured in your Copilot docs but matter for architecture:

- **Streaming responses**:
  - The OpenAI API allows you to set `"stream": true` and receive a server-sent event (SSE) or chunked HTTP response. Each chunk contains deltas for the assistant’s reply.
  - This is what enables "typing" effects in ChatGPT and low-latency partial responses in IDEs.

- **Rate limits** (per org / per key):
  - Limits are usually in terms of **requests per minute** and **tokens per minute**.
  - Your context narrowing and hard budgets are essential to staying within token-per-minute limits at scale.

- **Cost model**:
  - Billing is typically based on input tokens + output tokens per model, with different prices per 1K tokens.
  - Your "Hard Budgets" and token breakdown logging map directly to managing this cost.

For your AI-Team design, you might want a `metrics/` or `logs/` subsystem that tracks:

- Tokens per call by section (system, tools, retrieved context, user).
- Aggregate tokens per task / per employee.
- Rate-limit headroom.

---

## 5. Retrieval & RAG Patterns (ChatGPT + API)

Your Copilot server doc covers retrieval; ChatGPT and OpenAI’s ecosystem introduce two additional dimensions:

1. **Retrieval-Augmented Generation (RAG)** via custom backends
   - You can build your own vector store and pass retrieved chunks as extra messages (same as your `ContextPack`).
   - OpenAI’s newer assistants/retrieval APIs provide higher-level orchestration, but under the hood it is still: retrieve → pack → call model.

2. **Custom GPTs (ChatGPT product)**
   - Let you define instructions, knowledge (uploaded files), and tools; OpenAI’s service layer then performs retrieval + tool routing before calling the base model.
   - Conceptually this is similar to your "employee portfolios" + skills + tools.

Your design already captures most of this under "Retrieval > Preloading" and "Employee Index"; the missing piece in your docs was explicitly noting that ChatGPT’s own long-context / custom GPT features are **service-layer RAG**, not magical built-in model memory.

---

## 6. Safety / Moderation Layer

Another concept not yet called out explicitly in your Copilot docs but important for ChatGPT-style systems:

- OpenAI places a **moderation / safety layer** around models:
  - Inputs and/or outputs may be run through a moderation model.  
  - If content violates policy, the request can be blocked or the response replaced.

- For an AI-Team-like system, you would model this as:
  - A pre-call guard (validate prompts, redact secrets) and post-call guard (filter responses) around your orchestrator.
  - This can be implemented as separate tools or as middleware on your LLM client.

---

## 7. How This Complements Your AI-Team Context Narrowing Summary

Relative to the summary you pasted, the main **extra details about ChatGPT / OpenAI** are:

- Concrete `messages[]` and `tools` schema (roles, tool_calls, tool messages).
- Streaming behavior and why it matters for UX and latency.
- Explicit rate limits and token-per-minute constraints.
- The fact that base models are stateless; any "memory" or "custom instructions" are implemented as additional context by the hosting service.
- Moderation/safety as a distinct layer around the model.

Your design already anticipates most of this; these notes just anchor it in the OpenAI/ChatGPT API reality.

---

## 8. Public Documentation Links

These official resources explain the concepts above in more depth:

- OpenAI Platform Overview  
  https://platform.openai.com/docs/overview

- Chat Completions / Text Generation Guide  
  https://platform.openai.com/docs/guides/text-generation

- Tools / Function Calling (how tools are described and invoked)  
  https://platform.openai.com/docs/guides/function-calling  
  https://platform.openai.com/docs/guides/tools

- Prompting & Conversation Design  
  https://platform.openai.com/docs/guides/prompting

- Rate Limits  
  https://platform.openai.com/docs/guides/rate-limits

- Safety & Moderation  
  https://platform.openai.com/docs/guides/safety-best-practices

- ChatGPT Product Help Center (for UI-level behaviors like custom GPTs, memories)  
  https://help.openai.com

---

*This document complements `copilot-overview.md`, `copilot-chat.md`, and `copilot-server.md` by grounding them in the concrete ChatGPT/OpenAI API behavior as of early 2026.*
