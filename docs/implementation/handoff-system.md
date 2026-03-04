# Handoff System

The handoff system lets agents (or the developer) transfer a conversation to another agent. Every handoff is fully traceable in the database and exposed via the REST API so a client can reconstruct a session graph showing the complete information flow.

---

## Concepts

| Term | Description |
|---|---|
| **Session** | A single conversation thread between a developer and one agent. |
| **Handoff** | The act of one agent forwarding the developer to another agent. Creates a new child session. |
| **Handoff session** | A new session created during a handoff. Its `previousSessionId` points to the parent session. |
| **Session chain / thread** | The ordered list of sessions from root to the current leaf, linked via `previousSessionId`. |
| **Handoff ID** | A UUID shared by every DB message that belongs to the same handoff event, across both the FROM and the TO session. |

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

- `previous_session_id` is set when the session was created by a handoff (`createHandoffSession`).
- Following the chain of `previous_session_id` values back to `NULL` gives the full session thread.

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

A single handoff event writes messages to **two sessions** that all share the same `handoff_id` UUID.

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
2. **Create the handoff session** (sets `previousSessionId`)
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
3. LLM fallback — sends roster of agent names, asks model to identify the one being referenced (`maxTokens: 20`)

If all phases fail but the message looks like a forward request, `looksLikeForward=true` triggers a user-facing warning.

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

Write 2-4 sentences in first person as {fromAgent.name}: summarise what you and {developerName}
discussed, what {developerName}'s goal is, and why you are forwarding them to {targetAgentName}.
Do not repeat the request word-for-word. Do not add a subject line or greeting.
```

`maxTokens: 250`. Falls back to the raw trigger message if the LLM is unavailable.

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
2. **Nodes** = `sessions[]` — one node per session, label with `agentNames` + `developerId`, annotate with `messageCount` and timestamps.
3. **Edges** = `handoffs[]` — one directed edge per entry, `fromSessionId → toSessionId`, label with `handoffId` (truncated) or agent names.
4. **Deep-link a message** — a handoff edge points to messages where `message.handoffId === edge.handoffId`. Messages with `handoffToSessionId` are on the FROM side; messages with `handoffFromSessionId` are on the TO side.
5. **Deleted sessions** — `fromSessionId` or `toSessionId` in `handoffs` may be `null` if the linked session was deleted. Render as a dangling edge or ghost node.

### Identifying handoff message pairs

```
FROM side:  session[n].messages where handoffId == X  AND handoffToSessionId != null
TO side:    session[n+1].messages where handoffId == X AND handoffFromSessionId != null
```

The LLM acknowledgement in the TO session also carries `handoffId == X` but has neither `handoffFromSessionId` nor `handoffToSessionId` — it is the receiving agent's opening response.

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
| `packages/service/src/storage/sqlite/migrations.ts` | v3: adds `handoff_from_session_id`, `handoff_to_session_id`; v4: adds `handoff_id` + index |
| `packages/core/src/types/index.ts` | Added `handoffFromSessionId`, `handoffToSessionId`, `handoffId` to `ChatMessage` |
| `packages/service/src/storage/sqlite/sqlite-storage.ts` | `insertMessage` + `rowToMessage` + `deleteSession` updated |
| `packages/service/src/commands/chat.ts` | `appendHandoffNote` rewrote to LLM briefing; `acknowledgeHandoff` gets `handoffId`; all 4 paths generate UUID and stamp messages; `detectForwardRequestWithFallback` with 3-phase resolution |
| `packages/service/src/session-manager.ts` | Added `getSessionChain()` |
| `packages/api-server/src/routes/sessions.ts` | Added `GET /api/sessions/:id/thread` |
