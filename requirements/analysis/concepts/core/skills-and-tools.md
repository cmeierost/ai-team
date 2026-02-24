# Skills and Tools

**Tools** are concrete functions (APIs, scripts, file operations) that an agent can call. **Skills** are bundles of related tools and prompts that define a capability area.

## 1. Tools

A tool has:

- A **name** (e.g., `read_file`, `run_tests`).
- A **description** for LLMs (when to use it, what it does).
- A **parameter schema** (types, required fields, constraints).
- A **result shape** (structured return value).

In ai-team, tools are implemented in `@ai-team/core` and are always called through a **tool gateway** that:

- Checks agent permissions and path allowlists.
- Validates parameters.
- Executes deterministic logic (no hidden side effects).
- Returns structured success or typed errors.

## 2. Skills

A skill groups one or more tools plus usage guidance. For example:

- `git-operations` skill: `get_git_status`, `commit`, `diff`.
- `testing` skill: `run_tests`, `inspect_failures`.

Skills are defined in `.ai-team/skills/<name>.md` with:

- YAML frontmatter listing included tools and any special rules.
- Markdown body explaining domain knowledge and best practices.

Agents reference skills instead of raw tools. This keeps agent configs short and allows reusing the same skill across multiple agents.

## 3. Design Rules

- Keep tools **small, composable, and predictable**.
- Prefer **read-only** tools by default; mutating tools should be explicitly allowed.
- Errors should be **LLM-friendly** (short, structured, with clear causes).
- Document skills so humans understand when to assign them to agents.

## Further Reading

- OpenAI – Tools (formerly functions): https://platform.openai.com/docs/guides/tools
- Anthropic – Tool use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Microsoft – Agent tools and actions: https://learn.microsoft.com/azure/ai-services/openai/concepts/tools
