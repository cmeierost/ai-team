# Command Dispatch and Parameter Resolution

This document is the implementation contract for commands shared by CLI, chat
slash commands, workflows, and LLM tool calls.

The central rule is:

> Commands receive one validated parameter object. Surface-specific syntax is
> normalized, runtime-owned values are derived, and missing human-supplied
> values are completed before `ICommand.execute()` is called.

Command implementations should not parse slash-command strings or rediscover
session, agent, or workflow values themselves.

## Main implementation points

- Command metadata and runtime types:
  `packages/core/src/types/command-types.ts`
- Registry and canonical tool names:
  `packages/service/src/command-dispatcher/command-registry.ts`
- Shared dispatch pipeline:
  `packages/service/src/command-dispatcher/command-dispatcher.ts`
- String parsing and runtime argument resolution:
  `packages/service/src/command-dispatcher/command-adapters.ts`
- Missing-parameter questions:
  `packages/service/src/command-dispatcher/command-parameter-completion-service.ts`
- Slash invocation extraction:
  `packages/service/src/command-dispatcher/slash-invocation.ts`
- Agent tool execution:
  `packages/service/src/tooling/manager/tool-manager.ts`

## One command, multiple surfaces

`ICommandDescriptor.availableIn` declares the supported surfaces:

- `cli`: normal CLI subcommand
- `chat`: chat slash command
- `cliChat`: CLI-chat-only slash command
- `tool`: LLM-callable tool

The descriptor's Zod `parameters` schema is the canonical input shape. A
surface may supply that shape directly as an object or may supply text that the
dispatcher maps to the same object.

Tool-exposed commands require a non-empty `group`. Their model-facing name is
derived as `group_key` in snake case. For example, the `run` tool has
`group: "cli"` and is exposed as `cli_run`. Slash persistence uses the separate
presentation identity `slash:<invoked-token>`, such as `slash:run`.

## Public command names

Built-in chat commands use a two-token public identity: `/group key`. For
example, use `/system help` or `/chat run git status`. The registry dispatch
key remains `group-key` and is not a public slash spelling.

Only explicitly declared aliases may be invoked as one token. The core aliases
are `/help`, `/new`, `/back`, and `/switch`; `/ho` and `/shell` remain aliases.
Other bare built-in keys are rejected. Dynamic skill, prompt, and workflow
commands remain one-token commands because their key is their public interface.

Direct CLI commands are unaffected: `ait help` and `ait group key` use the
same descriptor metadata but render and accept CLI syntax, and only commands
with `availableIn.cli: true` are directly callable from the CLI.

## Parameter pipeline

For slash and CLI-style dispatch, parameters pass through these stages:

```text
raw invocation
  -> parse JSON or command-line tokens
  -> apply same-name top-level ExecutionContext values
  -> apply declared contextParameters
  -> apply workflowInputBindings
  -> ask for still-missing required human values
  -> enforce requiredAtRuntime
  -> Zod parse/default/coercion
  -> authorize
  -> ICommand.execute(validatedObject, context)
```

An explicitly supplied value wins. Context and workflow bindings only fill
paths that are absent or `undefined`.

Agent tool calls use the same runtime binding, validation, authorization, and
execution path, but do not ask interactive questions. A model must supply every
required parameter that cannot be derived from context or workflow state.

## Accepted human invocation forms

### JSON object

Structured commands accept their schema-shaped JSON object:

```text
/chat run {"command":"git","args":["status","--short"]}
```

Malformed input beginning with `{` or `[` is reported as invalid JSON rather
than being reinterpreted as positional text.

### Positional arguments

Quoted tokens, empty quoted strings, numbers, and booleans are normalized:

```text
/example report "folder with spaces" true 3
```

For ordinary structured commands, positional values map to unassigned schema
properties in required-first, then optional order. Named arguments support
both forms:

```text
--path value
--path=value
```

The final string target may receive remaining positional text joined with
spaces. Commands that need an unbounded argument list should declare a
variadic parameter instead of relying on this fallback.

Unterminated single or double quotes fail before command execution.

### Raw tail

Commands with `input.mode: "raw-tail"` receive the argument tail unchanged.
Schema-less commands also retain their own raw grammar. Prefer structured
input for new commands unless preserving the exact tail is the command's
purpose.

## Variadic parameters

Set `input.variadicParameter` to the schema property that receives all
remaining positional tokens:

```ts
const parameters = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const metadata = {
  key: 'run',
  group: 'chat',
  availableIn: { chat: true },
  parameters,
  input: {
    mode: 'structured',
    variadicParameter: 'args',
    jsonSignature: true,
  },
};
```

With that metadata, these invocations normalize to the same object:

```text
/chat run git status --short "folder with spaces" ""
/chat run {"command":"git","args":["status","--short","folder with spaces",""]}
```

```json
{
  "command": "git",
  "args": ["status", "--short", "folder with spaces", ""]
}
```

Tokens after the variadic boundary remain values even when they begin with
`--`. This is essential for commands such as `/chat run`, where `--short` belongs to
`git`, not to the AI Team command parser.

Properties before the variadic property consume positional tokens in schema
property order. The variadic property must exist in an object schema.

## Runtime-derived parameters

### Conventional context values

Before prompting or final validation, the dispatcher fills top-level schema
properties from same-named `ExecutionContext` fields. This covers conventional
values such as:

- `agentId`
- `sessionId`
- `workflowId`
- `workflowInstanceId`
- `stepId`

The caller does not need to repeat these when the active runtime already knows
them.

### Declared context paths

Use `input.contextParameters` when a parameter is explicitly runtime-owned,
especially for nested paths:

```ts
input: {
  contextParameters: ['sessionId', 'target.id'],
}
```

Declared context parameters are also removed from the LLM-facing tool schema,
because the model should not invent values supplied by the runtime.

### Workflow bindings

`workflowInputBindings` fills target parameter paths from workflow state:

```ts
workflowInputBindings: {
  'target.id': { fromLastResult: 'actor.id' },
  targetAgentId: { fromWorkflowData: 'handoff.targetAgentId' },
}
```

- `fromLastResult` reads from `ExecutionContext.workflowLastResult`.
- `fromWorkflowData` reads from `ExecutionContext.workflowState`.

Workflow-bound parameters are hidden from the LLM tool schema and are resolved
before interactive completion and final validation.

### Runtime-required values

`input.requiredAtRuntime` is for values that may be optional in the public Zod
schema but must exist after context and workflow resolution:

```ts
input: {
  contextParameters: ['sessionId'],
  requiredAtRuntime: ['sessionId', 'target.id'],
}
```

If any listed path is still missing, dispatch fails before execution.

## Completing missing required parameters

For human CLI or slash invocations, the dispatcher inspects the JSON schema
after context and workflow derivation. If an attached `IQuestionService` is
available, it asks only for required fields that are still missing:

- boolean: confirm question
- enum: select question
- number/integer: input converted to a number when valid
- other scalar: validated text input
- nested required fields: asked by dotted path
- fields with schema defaults: not asked

Tool invocations never prompt. Non-interactive surfaces without a question
service proceed to validation and return a normal parameter error.

When a structured command starts with a required parameter followed by a
declared variadic parameter, the completion prompt accepts the complete
invocation. Its answer is passed through the normal command-line tokenizer and
mapped back to the schema object. For example, answering `git status` to an
empty `/chat run` prompt produces `{ "command": "git", "args": ["status"] }`,
exactly like entering `/chat run git status` directly. Human-facing examples come
from the command's `help.examples` metadata.

## LLM tool schemas

The model-facing schema starts from the command's Zod schema and removes:

- `input.contextParameters`
- all `workflowInputBindings` targets
- `llm.hiddenParameters`

This keeps tool definitions focused on values the model can and should
provide. `ToolManager` applies the hidden runtime values before Zod validation
and permission checks, so live execution matches the advertised schema.

## Slash-command lifecycle and rendering

The chat layer only extracts the slash token and preserves the raw argument
tail. `CommandDispatcher` owns parsing and validation.

Each slash invocation is persisted as:

- the original developer transcript line
- a distinct `slash:<token>` tool call
- invocation metadata in the tool request (`commandKey`, `commandToken`,
  `rawArgs`, `rawInput`, and `invokedBy`)
- the normalized `CommandResponse` and presentation result

The result is emitted as a tool lifecycle event. UI adapters render it as a
standalone transcript component; command implementations must not write
presentation output directly to the terminal.

`/chat run` and agent-invoked `cli_run` additionally emit correlated, non-persisted
tool `start` updates as stdout and stderr chunks arrive. The CLI's exact run
renderer appends those chunks to one mutable transcript component. Because
terminal-native scrollback cannot rewrite rows that have already left the
active frame, terminal completion is also append-only: it adds any missing
normalized suffix or failure detail without shrinking the live component. The
terminal tool event remains the only persisted result, so resumed history is
stable and does not replay individual chunks.

This is why `/chat run` returns its invocation, stdout/stderr, and context note in
its `CommandResponse`. It does not emit multiline `[INFO]` log messages.
Streaming is a live projection of execution; the completed `CommandResponse`
is authoritative for both the final live rendering and resumed history.

## `/chat run` authorization

`/chat run` and `cli_run` share execution behavior but have different callers:

- Human `/chat run` (or its `/shell` alias): executable must be present in global
  `.ai-team/config.json` `allowedCliTools`.
- Agent `cli_run`: the agent must be allowed to call `cli_run`, and the
  executable must be present in both the agent's `cliTools` and the global
  allowlist when a global list is configured.

The executable is passed to `execFile` separately from its argument array.
Paths and whitespace are rejected in the executable field, and an optional
working directory must remain inside the workspace root.

On Windows, allowed commands may resolve to package-manager `.cmd` shims
instead of native `.exe` files (`pnpm`, `npm`, and similar tools). `/chat run`
resolves those shims with `where.exe` and invokes them through the Windows
command processor using separately escaped arguments. It does not concatenate
unescaped user input into a shell command. Native executables continue to use
direct `execFile` execution.

A spawned process that exits non-zero still returns its captured stdout,
stderr, and numeric exit code. `/chat run` presents that output followed by
`Command exited with code N` instead of discarding useful help or diagnostics
inside Node's generic `execFile` exception. Failures to spawn the executable
remain execution errors.

## Adding or changing a command

1. Define one Zod parameter object.
2. Declare surface availability and a stable `group`/`key`.
3. Choose `structured`, `raw-tail`, or `hybrid` input.
4. Add `variadicParameter` only for a genuine unbounded tail.
5. Declare runtime-owned paths with `contextParameters` or
   `workflowInputBindings`.
6. Use `requiredAtRuntime` for values required only after runtime derivation.
7. Keep parsing, prompting, and terminal rendering out of `execute()`.
8. Return a typed `CommandResponse`.
9. Test positional and JSON forms against the same expected object.
10. Test missing values, context/workflow derivation, tool-schema hiding, and
    final validation.
