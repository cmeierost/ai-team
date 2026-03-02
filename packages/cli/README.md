# @ai-team/cli

Command-line interface for AI Team management. Entry point: `ait` / `ai-team`.

---

## Architecture Contract — Read Before Editing

**The CLI is a thin adapter. Keep it that way.**

This package is responsible for exactly two things:

1. **Parsing user input** — command arguments, flags, prompts (via `commander`, `inquirer`, etc.)
2. **Formatting output** — `console.log`, `chalk`, tables, progress indicators

Everything else belongs in `@ai-team/service` or `@ai-team/core`.

---

## What Goes Where

| Concern | Package |
|---|---|
| Argument parsing, option flags | `@ai-team/cli` |
| Console output, chalk formatting | `@ai-team/cli` |
| Business logic, data transformation | `@ai-team/service` |
| File system operations (read/write) | `@ai-team/service` or `@ai-team/core` |
| Config loading and saving | `@ai-team/service` or `@ai-team/core` |
| Agent management, LLM calls | `@ai-team/core` |
| Validation, domain errors | `@ai-team/service` or `@ai-team/core` |

---

## Rules for CLI Command Files (`src/commands/*.ts`)

- **Import only from `@ai-team/service`** for business logic. Do not import directly from `@ai-team/core` except for types.
- **No file I/O** in CLI commands. If you need to read or write a file, add or call a function in `@ai-team/service`.
- **No config access** in CLI commands. Config loading/saving belongs in service commands.
- **No domain logic** in CLI commands. Filtering, sorting, computing — move it to service.
- Each CLI command function should be ≤ 50 lines. If it grows larger, the logic belongs in service.

### Good pattern

```typescript
// cli/src/commands/files.ts
export async function filesAllowCommand(filePath: string): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();          // service utility
  const next = await allowPathCommand(workspaceRoot, filePath); // service logic
  console.log(chalk.green(`✔ ${filePath} is in the allow list`)); // CLI output only
}
```

### Bad pattern

```typescript
// ❌ Business logic in CLI — do not do this
export async function filesAllowCommand(filePath: string): Promise<void> {
  const configPath = path.join(process.cwd(), '.ai-team', 'config.json');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  raw.fileTree ??= {};
  raw.fileTree.allowPaths ??= [];
  raw.fileTree.allowPaths.push(filePath);
  await fs.writeFile(configPath, JSON.stringify(raw, null, 2));
  console.log(chalk.green(`✔ Allowed: ${filePath}`));
}
```

---

## Adding a New Command

1. Create the business logic in `packages/service/src/commands/<name>.ts`.
2. Export it from `packages/service/src/index.ts`.
3. Create a thin adapter in `packages/cli/src/commands/<name>.ts` that calls the service function and formats the output.
4. Wire it up in `packages/cli/src/cli.ts` using `commander`.

---

## Project Structure

```
src/
  cli.ts          # Commander wiring — command registration only
  index.ts        # Package entry point
  commands/       # One file per command group — UI adapters only
  utils/          # CLI-only utilities (prompts, formatters)
```
