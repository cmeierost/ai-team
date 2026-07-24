# Bare Chat Resume Selection

`ait chat` without an agent or session is a resume operation. It must reopen the
session containing the most recent real conversation activity for the current
developer.

## Selection rule

1. Scope sessions to the current developer.
2. Inspect non-archived messages in every scoped session.
3. Ignore mirrored handoff messages (`handoffId` or `handoffType`) because the
   same transition is persisted in more than one session.
4. Treat either non-empty message content or a persisted tool call as activity.
5. Rank activity by the latest of:
   - message timestamp;
   - tool request timestamp;
   - tool completion timestamp.
6. When timestamps are equal, use the persisted message/tool row ID as the
   deterministic ordering key.
7. Open the exact session that owns the winning activity and load that session's
   history. Do not replace it with another member's thread cursor.
8. If no scoped session has activity, start a new conversation with the
   workspace CEO.

Explicit invocations intentionally differ:

- `ait chat <session-id>` follows that thread's persisted active cursor.
- `ait chat <agent>` starts a new root conversation with that agent.
- `ait chat --new <agent>` explicitly starts a new conversation.

## Regression coverage

- `packages/service/src/sessions/thread-manager.test.ts` verifies message,
  tool-completion, mirrored-handoff, and equal-timestamp ordering.
- `packages/service/src/commands/chat/chat-startup-target-resolver.test.ts`
  verifies that bare startup selects the activity winner.
- `packages/service/src/commands/chat/chat-startup.command.test.ts` verifies
  that startup loads and announces the selected session.
- `packages/cli/src/chat-invocation-target.test.ts` verifies that bare
  `ait chat` reaches service-side resume selection without forcing a new
  session.
