## Plan: File-access rights library

Create a standalone package `@ai-team/access` at `packages/access` that answers one question: **is this operation allowed on these files in this context?**

The library does not touch the filesystem. It is a policy engine for file-path access rights. Callers register shell commands and tool definitions with descriptors that say which file-access rights each command/tool needs and how to extract the target file paths from its arguments. The library then evaluates any incoming command or tool call against the active layered access context, resolves relative paths against the working directory, and returns a structured verdict that includes not just allowed/denied but also **who is allowed** — enabling delegation and context switching.

AI Team uses this to gate every file-touching operation — whether it comes from a shell command, an MCP tool, or a direct file API call — through a single, auditable access check.

A second package for file read/write abstraction will follow later.

**Steps**

1. **Package boundary.** Create `packages/access` with `package.json` (`@ai-team/access`), `tsconfig.json`, `src/index.ts`, and README. Zero dependencies on AI Team agent/session concepts. Only generic path and access abstractions. This phase blocks all others.

2. **Domain contracts — rights and rules.** Define rights: `read`, `write`, `create`, `delete`, `list`. A rule binds a right to a path pattern (glob, workspace-relative) and an optional file-name pattern (e.g. `*.md`), with an `allow` or `deny` effect. Rules are composable: a context carries an ordered list. Model resources as normalized workspace-relative paths with explicit kind (`file` | `directory`). Cross-platform: normalize Windows backslashes and drive letters to POSIX-style workspace-relative form. Depends on step 1.

3. **Layered access model.** Two layers: **global context** (baseline) and **active context** (per-agent, per-session, or any caller-chosen scope). Each layer has an ID, allow rules, deny rules, optional ignore-file sources, and metadata. Effective policy: merge global + active, apply deny-before-allow precedence. The active context may both widen and narrow the global baseline. Depends on step 2.

4. **Context registry and switching.** The library instance holds registered contexts. APIs: `registerContext`, `updateContext`, `removeContext`, `getContext`, `setActiveContext(id)`. Runtime rights changes must invalidate compiled matchers and caches. Switching context must be instant — no I/O. Depends on step 3.

5. **Operation registry — shell commands.** Register shell commands with descriptors:
   - command name or pattern (e.g. `cat`, `rm`, `cp`, `mkdir`, `grep`)
   - for each relevant argument position or flag: which right it requires and how to extract the file path (positional index, flag name, rest-of-args, stdin-source, etc.)
   - some commands have multiple paths with different rights (e.g. `cp`: source=read, destination=write)
   - some commands imply directory creation (`mkdir` → create on directory)
   - default right for unrecognized commands (configurable: deny-by-default or allow-by-default)
   Depends on steps 2–4.

6. **Operation registry — tool calls.** Register tool definitions with descriptors:
   - tool name (e.g. `readFile`, `writeFile`, `createDirectory`, `run_in_terminal`)
   - for each parameter that represents a file path: parameter name + required right
   - compound tools (like `run_in_terminal`) may carry an embedded shell command — the descriptor can declare "parse the `command` parameter as a shell command and apply the shell-command registry"
   Depends on steps 2–5.

7. **Access check API.** The core check surface:
   - `checkCommand(commandString, cwd, contextId?) → AccessVerdict`
   - `checkToolCall(toolName, args, cwd, contextId?) → AccessVerdict`
   - `checkPath(path, right, cwd, contextId?) → AccessVerdict`
   Each resolves relative paths against `cwd`, normalizes to workspace-relative, evaluates against the layered policy, and returns:
   ```
   AccessVerdict {
     allowed: boolean
     resolvedPaths: { path, right, allowed, matchedRule?, deniedBy? }[]
     alternativeContexts: { contextId, allowed: true }[]   // who CAN do this
     explanation: string   // human-readable summary
   }
   ```
   The `alternativeContexts` field is the key to delegation: on denial, the caller immediately knows who to ask.

   Batch operations on the same surface:
   - `filterPaths(paths, right, contextId?) → paths[]` — keep only paths the context may access for that right
   - `annotatePaths(paths) → Map<path, { contextId → rights[] }>` — for every path, show every context's rights
   - `checkPaths(paths, right, contextId?) → AccessVerdict[]` — bulk check, one verdict per path

   These are the everyday bread-and-butter calls: "here are 200 files from a search — which ones can I read?" Depends on steps 3–6.

8. **Ignore-pattern support.** Support gitignore-style glob patterns as a policy input in either layer. Dynamic loading/reloading of ignore files at runtime. Ignored paths are treated as globally denied for all rights (invisible). Sources: `.gitignore`, `.copilotignore`, custom ignore files. Keep "hidden because ignored" separate from "denied because policy says no" in diagnostics. Depends on steps 2–5.

9. **Introspection and query APIs.** Beyond single-operation checks:
   - `whoCanAccess(path, right) → contextId[]` — which contexts allow this path+right
   - `whatCanContextDo(contextId, paths) → per-path rights map` — annotate a file list
   - `rankContexts(paths, right) → sorted { contextId, coverageCount }[]` — delegation ranking
   - `findGaps(paths, contextId) → { denied: path[], alternatives: { path, contextIds[] }[] }` — what's blocked and who can help
   - `distributeWork(paths, right) → { contextId, paths[] }[]` — given files + right, compute an optimal assignment across contexts so every path is handled by a context that has access, preferring contexts with the broadest coverage. This is the "agent B takes these files, agent C takes those, you handle the rest" API.
   - `listRules(contextId?) → rules with patterns` — cross-context pattern introspection for delegation discovery
   These are the building blocks for AI Team's delegation logic: "who should handle this?", "split this work", and "who do I ask for help?" Depends on steps 5–8.

10. **Map existing AI Team code onto the library.** Replace `ContextManager`'s permission logic with an adapter that converts AI Team agent/config data into `@ai-team/access` contexts and registered operations. Keep AI Team-specific concepts (`ContextLevel`, agent defaults, team config) in `@ai-team/core` or `@ai-team/service`. Wire tool execution and shell-command gating through `checkToolCall` / `checkCommand`. Depends on steps 1–9.

11. **Tests.** Unit tests in `packages/access`: rule precedence, layered evaluation, deny-before-allow, path normalization (Windows backslash input), context switching, command parsing + path extraction, tool-call extraction, cwd resolution, ignore-file loading, introspection queries, delegation ranking, compound command handling (e.g. `run_in_terminal` wrapping `cat`). Integration tests: denied operation returns alternative contexts, switching context changes results immediately, unrecognized command respects default policy. Depends on all implementation steps.

12. **Documentation.** Document `@ai-team/access` as the canonical operation-level access control library. Update architecture docs, explain the operation registry concept, show examples of registering shell commands and tools, and document the migration path from the old `ContextManager`. Depends on final design outcome.

**Relevant files**
- `packages/access/package.json` — new standalone package manifest.
- `packages/access/tsconfig.json` — TypeScript build config.
- `packages/access/src/index.ts` — public barrel.
- `packages/access/src/rights.ts` — right types, rule types, effect types.
- `packages/access/src/context/` — access-context contracts, registry, layering, switching.
- `packages/access/src/policy/` — deny/allow evaluation, matcher compilation, structured verdicts.
- `packages/access/src/operations/` — operation descriptors, shell-command registry, tool-call registry, path extraction.
- `packages/access/src/introspection/` — whoCanAccess, rankContexts, findGaps, whatCanContextDo, listRules.
- `packages/access/src/ignore/` — gitignore-style pattern loading and policy input.
- `packages/access/src/paths.ts` — path normalization, cwd resolution, workspace-relative conversion.
- `packages/core/src/context/index.ts` — current `ContextManager`; shrinks to adapter over `@ai-team/access`.
- `packages/core/src/tools/index.ts` — permission checks that should call `checkToolCall`.
- `packages/core/src/types/index.ts` — AI Team permission types to slim after extraction.
- `packages/service/src/commands/file-tree.ts` — becomes a library consumer instead of policy owner.
- `ARCHITECTURE.md` — update package responsibilities and dependency direction.
- `COPILOT-CONTEXT.md` — update implementation hotspots.

**Verification**
1. Build `packages/access` and affected dependents; verify clean compilation.
2. Unit tests for rule precedence, layered deny/allow, context switching, path normalization on Windows.
3. Unit tests for shell-command path extraction: `cat file.txt`, `cp src dest`, `mkdir -p foo/bar`, `grep -r pattern dir/`, piped commands.
4. Unit tests for tool-call path extraction: simple tool params, compound tools (`run_in_terminal` wrapping shell commands).
5. Unit tests for cwd-relative resolution: command run in a subdirectory should resolve paths correctly before checking.
6. Integration tests: denied → alternative contexts returned; context switch → different result; unrecognized command → default policy; ignore-file reload → updated results.
7. Introspection tests: rankContexts returns correct order; findGaps identifies blocked paths and alternatives; whoCanAccess lists correct context IDs; distributeWork assigns each path to exactly one context with access; batch filterPaths/annotatePaths return correct results for mixed-access file sets.

**Decisions**
- Package: `packages/access`, name `@ai-team/access`.
- Library-first: no AI Team agent/session/config dependencies.
- Does not touch the filesystem. Does not wrap `node:fs`. Does not execute commands. It only answers "is this allowed?" and "who can?".
- Layered contexts: global + active, deny-before-allow, runtime switching by ID.
- Operation registry is the core new concept: callers register shell commands and tools with descriptors explaining which rights they need and how to extract file paths from arguments.
- Working-directory-aware: all path extraction resolves relative paths against a provided `cwd` before policy evaluation.
- Structured verdicts: every check returns allowed/denied + matched rules + alternative contexts that could allow the operation.
- Default policy for unregistered commands/tools is configurable (deny-by-default recommended).

**Excluded scope**
- Filesystem operations — this library does not read, write, or execute anything.
- File read/write abstraction — that is a separate second package.
- Search — external, always global.
- Tree-sitter, AST analysis, RAG, code intelligence.
- Persistent on-disk storage for contexts — runtime-held, host controls persistence.

**Further Considerations**
1. Shell-command parsing can be simple initially: split on whitespace, match first token to a registered command name. Support for pipes, redirections, and quoted paths as iterative improvements.
2. `create` rules support file-name patterns (e.g. `*.md` in `docs/`). All rules support patterns but `create` file-name patterns matter most for delegation gating.
3. Cross-context pattern introspection enables delegation discovery: "which contexts have a `write` rule covering `src/*.ts`?" — without leaking file content.
4. Context-ranking (`rankContexts`) finds the best single context. Work distribution (`distributeWork`) splits a file set across multiple contexts optimally — the primary delegation mechanism when no single context covers everything.
5. Compound operations: a tool like `run_in_terminal` that accepts a shell command string should recurse into the shell-command registry. The tool descriptor declares which parameter to parse.
6. Some commands affect multiple paths with different rights (`cp`, `mv`). The descriptor model must support per-argument right assignment.
7. During migration, keep a temporary adapter in `@ai-team/core` so upstream packages switch incrementally.
