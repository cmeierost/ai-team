# Handoff System

The handoff system lets agents (or the developer) transfer a conversation to another agent. Every handoff is fully traceable in the database and exposed via the REST API so a client can reconstruct a session graph showing the complete information flow.

---

## Design Principles

- **Everything is natural language.** The developer never types a command or special syntax to trigger a handoff. Any natural expression of intent is sufficient — "let me talk to her", "get me connected to Sarah", "I'd rather ask Alex about this" all work without the developer knowing how handoffs work.
- **Agents suggest handoffs conversationally.** When an agent decides to forward the developer, it says so in plain conversation ("I think Sarah would be better placed to help with this — want me to connect you?"). Structured directives (`HANDOFF:`, `FORWARD_TO:`) are internal implementation signals; they are never shown to the developer.
- **Pronouns and implicit references work.** If an agent was mentioned by name during the conversation ("Sarah could handle that"), then "let me talk to her" must resolve correctly. Recent conversation context is always used when resolving indirect references.
- **The transition feels seamless.** The developer should experience handoffs as a natural continuation of the conversation, not as a routing or command mechanism.

---

## Concepts

| Term | Description |
|---|---|
| **Session** | A single conversation thread between a developer and one agent. |
| **Thread** | A set of sessions connected by handoffs. A thread contains **at most one session per agent** — if a handoff targets an agent that already has a session in the thread, that session is resumed rather than a new one being created. Independent threads share no sessions. |
| **Session spine** | The linear chain of sessions linked by `previousSessionId`, from the thread root (`previousSessionId = null`) to the newest session. Used to determine whether a target agent already has a session in the current thread. |
| **Session graph** | All sessions in a thread plus the directed handoff edges between them (from `handoffs[]`). Unlike the spine, the graph is not a tree — handoff edges can point back to earlier sessions (return handoffs), so the graph is a directed graph that may contain cycles. |
| **Handoff** | The act of one agent forwarding the developer to another agent. **Always writes briefing messages to both the FROM and TO sessions** regardless of whether the TO session is new or pre-existing. |
| **Handoff session** | A session reached via a handoff. May be newly created (first time reaching this agent in the thread) or pre-existing (returning to an agent already in the thread). |
| **Handoff ID** | A UUID generated fresh for each handoff event. Shared by every DB message written during that event, across both the FROM and the TO session. A return handoff generates a new UUID even though the TO session already exists — it is a new event. |

---

## Database Schema

### `sessions` table

```sql
sessions (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  developer_id        TEXT NOT NULL,
  title               TEXT,
  started_at          TEXT NOT NULL,
  last_activity_at    TEXT NOT NULL,
  previous_session_id TEXT          -- FK → sessions.id (nullable)
)
```

- `previous_session_id` is `null` for the root session of a thread.
- `previous_session_id` is set to the current session's ID when a handoff creates a new child session.
- For return handoffs (resuming an existing session), `previous_session_id` on the target session is unchanged — it already points to wherever it was when the session was first created.
- Following the chain of `previous_session_id` values back to `NULL` gives the full session spine.

---

## Session Resolution

Before executing a handoff, the target session must be resolved. The rule is: **one session per agent per thread**.

**Algorithm (`resolveHandoffSession`):**

1. Walk the `previousSessionId` spine from the current session back to the thread root, collecting all sessions.
2. Search those sessions for one where `agent_id` matches the target agent.
3. **If found** → that is the TO session. Resume it. No new session is created.
4. **If not found** → call `createHandoffSession(targetAgentId, developerId, currentSessionId)`. This creates a new session with `previousSessionId = currentSessionId`, extending the spine.

In both cases — new or resumed — the full handoff briefing sequence runs: a fresh `handoffId` UUID is generated and briefing messages are written to both the FROM and TO sessions with all handoff columns stamped.

**Starting a new independent thread** is only triggered by explicit user action (e.g. the `--new` flag or an explicit "new session" command). This creates a root session with `previousSessionId = null`, unconnected to any other thread.

### `messages` table (handoff-relevant columns)

```sql
messages (
  id                       INTEGER PRIMARY KEY,
  session_id               TEXT NOT NULL,   -- which session this message lives in
  from_id                  TEXT NOT NULL,   -- sender agent ID or developer ID
  to_id                    TEXT,            -- recipient agent ID or developer ID
  is_human                 INTEGER,
  content                  TEXT NOT NULL,
  handoff_type             TEXT,            -- 'agent-briefing' | NULL
  handoff_from_session_id  TEXT,            -- session the handoff originated FROM
  handoff_to_session_id    TEXT,            -- session the handoff was directed TO
  handoff_id               TEXT             -- UUID shared across both sides of a handoff
)
```

**Index:** `idx_messages_handoff_id ON messages(handoff_id) WHERE handoff_id IS NOT NULL`

---

## Handoff Event — Message Pattern

A single handoff event writes messages to **two sessions**, both stamped with the same `handoff_id` UUID. This applies whether the TO session is newly created or pre-existing (return handoff). A return handoff appends the briefing messages to the existing session — it does not resume silently.

### FROM session (where the handoff originated)

| Message | `from_id` | `to_id` | `handoff_type` | `handoff_to_session_id` | `handoff_id` |
|---|---|---|---|---|---|
| Developer's trigger message (`isHuman=true`) | developer | from-agent | — | new session ID | UUID |
| Agent's `parentNote` | from-agent | to-agent | `agent-briefing` | new session ID | UUID |

> Path 1 (agent directive) and path 4 (HANDOFF: in agent response) save only a `parentNote`. Path 3 (natural-language forward) also saves the developer's trigger message with `handoff_to_session_id` set.

### TO session (new handoff session)

| Message | `from_id` | `to_id` | `handoff_type` | `handoff_from_session_id` | `handoff_id` |
|---|---|---|---|---|---|
| LLM briefing (from from-agent) | from-agent | to-agent | `agent-briefing` | old session ID | UUID |
| Agent acknowledgement response | to-agent | developer | `agent-briefing` | — | UUID |

---

## The Four Handoff Paths

All paths follow the same sequence:

1. Generate `handoffId = randomUUID()`
2. **Resolve the TO session** via `resolveHandoffSession` — resumes the existing session for this agent in the current thread, or creates a new one if this is the first handoff to that agent (see [Session Resolution](#session-resolution))
3. Save the trigger/parentNote to the FROM session with `handoffToSessionId`
4. Call `appendHandoffNote` → generates LLM briefing → saves to TO session with `handoffFromSessionId`
5. Emit a `handoff` runtime event (drives the CLI banner)
6. Call `acknowledgeHandoff` → LLM generates response → saved to TO session with `handoffId`

### Path 1 — Agent directive in LLM response
The agent's response contains a structured `HANDOFF:` / `FORWARD_TO:` directive. Detected by `parseHandoffDirective`.

### Path 2 — Agent stream contains `FORWARD_TO:` inline
Same as path 1 but detected mid-stream.

### Path 3 — Developer's natural-language forward request
The developer types something like *"forward me to Alex"* or *"send me to the CSS specialist"*.

Resolution is three-phase (`detectForwardRequestWithFallback`):
1. Exact/fuzzy match from `extractForwardTargetName` + `agentManager.resolveAgent`
2. Progressive word-prefix slices (handles *"alex i want to talk about handoffs"*)
3. LLM fallback — sends the roster of agent names **plus recent conversation history as context**, asks the model to identify which agent the developer means (`maxTokens: 20`). Recent context is always included because it is the only way to resolve pronouns and implicit references correctly.

If all phases fail but the message looks like a forward request, `looksLikeForward=true` triggers a user-facing warning.

> **Constraint:** Pronoun and implicit reference resolution ("her", "him", "that person", "the one you mentioned") is a first-class requirement. If an agent was mentioned by name earlier in the conversation, "let me talk to her" must resolve to that agent. Phase 3 must always pass recent history to the LLM — without it, pronoun resolution is impossible.

### Path 4 — Inline `HANDOFF:` directive from a non-streaming response
Same intent as path 1, handled in the non-streaming branch.

---

## LLM Briefing Prompt

`appendHandoffNote` generates the briefing the forwarding agent writes to the receiving agent. Prompt structure:

```
You are {fromAgent.name} ({fromAgent.role}). Write a handoff briefing for {targetAgentName}.
{developerName} said: "{triggerMessage}"

Recent conversation:
{last 12 turns, formatted as "Name: content"}

Write 2-10 sentences in first person as {fromAgent.name}. Make the developer's objective,
the receiving agent's responsibility, its expected first action, relevant decisions or constraints,
and any requested return or follow-up path explicit. Tell the receiving agent to continue with the
developer rather than replying to you. Do not invent missing decisions or a return path, repeat the
request word-for-word, or add a subject line or greeting.
```

Forward briefings use `maxTokens: 800`. A normal forward falls back to the raw trigger message if
the LLM is unavailable.

### `/return` briefings

`/session return` is the generic shortcut for the active workflow's configured
return command. Without a custom command it returns the last completed tool
response. The chat workflow declares `session-handoff-return`; that
command resolves the persisted parent frame and executes `com_handoff` with
`navigationIntent: back`. `/return` itself does not generate summaries or mutate
chat/thread state.

The return capability is exposed to an agent only when the runtime has a known
parent for a custom return, or a completed tool response for the default
return. The agent may invoke it after the developer clearly asks to
return/report back, or confirms that the delegated work is complete and they
want to continue with the parent. Completing an answer, reaching an
agent-selected stopping point, or merely having a return path is not
sufficient. When the developer's intent is ambiguous, the agent stays in the
current workflow and asks one concise question.

Agent tool calls must also provide `developerSignal`, quoting the latest visible
developer message that authorized the return. The command verifies that
provenance before executing. Direct human `/return` invocations do not require
this field.

For chat, returning is semantic, not just navigation. Before switching
sessions, the current agent must write a return briefing that answers the
original incoming handoff and the questions or requests that caused it. The
summary prompt:

- retains the original incoming `agent-briefing`, even when it is outside the recent-history window;
- includes the later delegated conversation and conclusions;
- does not present the `/return` navigation string as something the developer said;
- tells the model not to mention navigation or ask the delegating agent what was discovered; and
- uses a 1600-token budget so reasoning-capable models still have room to emit visible content.

If the model emits no visible summary or the call fails, the runtime uses the current agent's latest
substantive response from the delegated session. That fallback is replayed through handoff `delta`
events before the `complete` event, so reasoning-only or failed summary calls still render
incrementally. It never persists “Returning to the delegating agent via /return” as the return
briefing. If there is no substantive response, it explicitly reports that no result is available and
preserves the original request for context.

## Receiving-Agent Prompt Contract

The mirrored `agent-briefing` is converted into a `user`-role message so the receiving model has a
reply-prompting final turn. It is wrapped in a recognizable internal envelope:

```text
[Internal handoff — {fromAgentName} → {toAgentName}]

The human developer is now your conversational counterpart. Respond to the developer,
not {fromAgentName}.

A return path to {fromAgentName} is available through session_return. Call it only
after the developer clearly asks to return/report back or confirms this delegated
work is finished. Do not return merely because you produced an answer.

Use this colleague briefing as context and continue from it. Do not ask the developer
to repeat information already included here.

{fromAgentName} wrote:

{briefing}
```

The conversation-participants system prompt defines this envelope as the sole exception to the
normal rule that `user` messages are authored by the developer. On receipt, the target agent must:

1. Address the developer directly, never the sending colleague.
2. Translate third-person briefing language such as “Clemens wants” into natural second-person
   language such as “you want.”
3. Use the briefing without quoting it or asking the developer to repeat known context.
4. Act on a clear next step; otherwise ask one focused question.
5. Treat “tell Emily,” “report back,” “return,” and equivalent language as authorization to call
   `session_return`, quoting that latest developer message in `developerSignal`.
6. Stay in the delegated workflow when the developer has not clearly indicated that they want to
   leave it; use `com_handoff` only for a new transfer to a different agent.

The receiving turn stays on the normal streaming tool-loop path.
OpenAI-compatible providers may send interim reasoning as either
`delta.reasoning_content` or `delta.reasoning`; both forms are translated into
thinking events immediately. Visible `delta.content` streams into the receiving
agent response before the tool loop finishes, so a long reasoning or
tool-capable turn does not look like a blocked application.

---

## Session Deletion

When a session is deleted, all dangling cross-session references are NULLed out first (SQLite does not support `ON DELETE SET NULL` on columns added via `ALTER TABLE`):

```sql
UPDATE sessions SET previous_session_id       = NULL WHERE previous_session_id       = :id;
UPDATE messages SET handoff_from_session_id   = NULL WHERE handoff_from_session_id   = :id;
UPDATE messages SET handoff_to_session_id     = NULL WHERE handoff_to_session_id     = :id;
DELETE FROM sessions WHERE id = :id;  -- cascades to that session's own messages
```

The `handoff_id` UUID is intentionally preserved — it still identifies which messages belonged to the same handoff event even when one side's session is gone.

---

## REST API

### `GET /api/sessions/:sessionId/thread`

Returns the full session chain from root to leaf, enriched with messages and a pre-computed handoff edge index. Any session in the thread can be provided as `:sessionId`.

**Response shape:**

```jsonc
{
  "rootSessionId": "sess-abc",
  "currentSessionId": "sess-xyz",   // the :sessionId you passed in
  "depth": 3,                        // number of sessions in the chain

  // Pre-computed edge index — use this to draw graph arrows
  "handoffs": [
    {
      "handoffId": "uuid-123",        // shared UUID across both sides
      "fromSessionId": "sess-abc",
      "toSessionId": "sess-def",
      "fromAgentIds": ["michael-brown"],
      "toAgentIds": ["sarah-morgan"]
    }
  ],

  // Ordered root → leaf
  "sessions": [
    {
      "sessionId": "sess-abc",
      "agentIds": ["michael-brown"],
      "agentNames": ["Michael Brown"],     // resolved from AgentManager
      "developerId": "clemens-meier",
      "title": null,
      "startedAt": "2026-03-03T10:00:00Z",
      "lastActivityAt": "2026-03-03T10:15:00Z",
      "previousSessionId": null,           // null = root session
      "mergedFromSessionIds": null,
      "messageCount": 5,
      "messages": [
        {
          "timestamp": "...",
          "from": "clemens-meier",
          "to": "michael-brown",
          "isHuman": true,
          "content": "forward me to sarah",
          "handoffId": "uuid-123",
          "handoffToSessionId": "sess-def",   // <-- link to next session
          "handoffFromSessionId": null
        },
        {
          "from": "michael-brown",
          "to": "sarah-morgan",
          "handoffType": "agent-briefing",
          "content": "Clemens wants to discuss the CSS design system...",
          "handoffId": "uuid-123",
          "handoffToSessionId": "sess-def"
        }
      ]
    },
    {
      "sessionId": "sess-def",
      "agentIds": ["sarah-morgan"],
      "agentNames": ["Sarah Morgan"],
      "previousSessionId": "sess-abc",     // <-- link to parent
      "messageCount": 3,
      "messages": [
        {
          "from": "michael-brown",
          "to": "sarah-morgan",
          "handoffType": "agent-briefing",
          "content": "Clemens asked me to talk to you about the CSS design system...",
          "handoffId": "uuid-123",            // same UUID → matches FROM side
          "handoffFromSessionId": "sess-abc"  // <-- link back to parent session
        },
        {
          "from": "sarah-morgan",
          "to": "clemens-meier",
          "handoffType": "agent-briefing",
          "content": "Hi Clemens, Michael briefed me...",
          "handoffId": "uuid-123"
        }
      ]
    }
  ]
}
```

### Other session endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session (add `?includeMessages=true` for messages) |
| `GET` | `/api/sessions/:id/messages` | Get all messages for a session |
| `GET` | `/api/sessions/:id/thread` | Full session chain with handoff graph |
| `POST` | `/api/sessions` | Create a new session |
| `DELETE` | `/api/sessions/:id` | Delete session (NULLs cross-session refs) |

---

## Client Graph Model

To render a session graph:

1. Call `GET /api/sessions/{anySessionId}/thread` for any session in the thread.
2. **Nodes** = `sessions[]` — one node per session, at most one per agent in a thread. Label with `agentNames` + `developerId`, annotate with `messageCount` and timestamps.
3. **Edges** = `handoffs[]` — one directed edge per entry, `fromSessionId → toSessionId`. **The graph is not a tree.** Return handoffs produce back-edges pointing to earlier nodes. Render as a directed graph; do not assume acyclicity.
4. **Deep-link a message** — a handoff edge points to messages where `message.handoffId === edge.handoffId`. Messages with `handoffToSessionId` are on the FROM side; messages with `handoffFromSessionId` are on the TO side.
5. **Deleted sessions** — `fromSessionId` or `toSessionId` in `handoffs` may be `null` if the linked session was deleted. Render as a dangling edge or ghost node.

### Identifying handoff message pairs

```
FROM side:  messages where handoffId == X  AND handoffToSessionId != null
TO side:    messages where handoffId == X  AND handoffFromSessionId != null
```

The LLM acknowledgement in the TO session also carries `handoffId == X` but has neither `handoffFromSessionId` nor `handoffToSessionId` — it is the receiving agent's opening response.

A session node may have **multiple incoming handoff edges** when agents return to it more than once. Each return handoff appends a fresh briefing pair (new UUID) to that session's message list.

---

## TypeScript Types (ChatMessage additions)

```typescript
interface ChatMessage {
  // ... existing fields ...
  handoffType?: 'user-acknowledgment' | 'agent-briefing';
  targetAgentId?: string;
  handoffFromSessionId?: string;  // session this briefing came FROM
  handoffToSessionId?: string;    // session this briefing is directed TO
  handoffId?: string;             // UUID shared by all messages in one handoff event
}
```

---

## Files Changed (session summary)

| File | Change |
|---|---|
| `packages/service/src/storage/sqlite/migrations.ts` | Baseline schema includes `handoff_from_session_id`, `handoff_to_session_id`, and `handoff_id` + index |
| `packages/core/src/types/index.ts` | Added `handoffFromSessionId`, `handoffToSessionId`, `handoffId` to `ChatMessage` |
| `packages/service/src/storage/sqlite/sqlite-storage.ts` | `insertMessage` + `rowToMessage` + `deleteSession` updated |
| `packages/service/src/commands/chat.ts` | `appendHandoffNote` rewrote to LLM briefing; `acknowledgeHandoff` gets `handoffId`; all 4 paths generate UUID and stamp messages; `detectForwardRequestWithFallback` with 3-phase resolution |
| `packages/service/src/session-manager.ts` | Added `getSessionChain()` |
| `packages/api-server/src/routes/sessions.ts` | Added `GET /api/sessions/:id/thread` |
