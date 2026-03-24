import type { Right } from './rights.js';

// ── Shell command descriptors ──────────────────────────────────────

/**
 * How to extract a file path from a shell command's arguments.
 */
export type ArgExtractor =
  | { kind: 'positional'; index: number }
  | { kind: 'flag'; flag: string }
  | { kind: 'rest'; startIndex: number }
  | { kind: 'custom'; extract: (args: string[]) => string[] };

/**
 * One file-path argument of a shell command and the right it requires.
 */
export interface CommandPathArg {
  right: Right;
  extractor: ArgExtractor;
}

/**
 * Descriptor for a registered shell command.
 */
export interface CommandDescriptor {
  /** Command name or names (e.g. `['cat']`, `['cp', 'copy']`). */
  names: string[];

  /** File-path arguments and their required rights. */
  pathArgs: CommandPathArg[];

  /** Optional: short description for diagnostics. */
  description?: string;
}

// ── Tool call descriptors ──────────────────────────────────────────

/**
 * One parameter of a tool that represents a file path.
 */
export interface ToolPathParam {
  /** Name of the parameter in the tool's args object. */
  paramName: string;

  /** The right this parameter requires. */
  right: Right;
}

/**
 * Descriptor for a registered tool.
 */
export interface ToolDescriptor {
  /** Tool name (e.g. `readFile`, `writeFile`, `run_in_terminal`). */
  name: string;

  /** Parameters that carry file paths and their required rights. */
  pathParams: ToolPathParam[];

  /**
   * If this tool wraps a shell command (like `run_in_terminal`),
   * name the parameter that contains the shell command string.
   * The engine will parse that parameter using the shell-command registry.
   */
  shellParam?: string;

  /** Optional: short description for diagnostics. */
  description?: string;
}

// ── Registries ─────────────────────────────────────────────────────

export class CommandRegistry {
  private readonly descriptors = new Map<string, CommandDescriptor>();

  register(desc: CommandDescriptor): void {
    for (const name of desc.names) {
      this.descriptors.set(name, desc);
    }
  }

  get(commandName: string): CommandDescriptor | undefined {
    return this.descriptors.get(commandName);
  }

  has(commandName: string): boolean {
    return this.descriptors.has(commandName);
  }

  all(): CommandDescriptor[] {
    return [...new Set(this.descriptors.values())];
  }
}

export class ToolRegistry {
  private readonly descriptors = new Map<string, ToolDescriptor>();

  register(desc: ToolDescriptor): void {
    this.descriptors.set(desc.name, desc);
  }

  get(toolName: string): ToolDescriptor | undefined {
    return this.descriptors.get(toolName);
  }

  has(toolName: string): boolean {
    return this.descriptors.has(toolName);
  }

  all(): ToolDescriptor[] {
    return [...this.descriptors.values()];
  }
}

// ── Shell command parsing ──────────────────────────────────────────

/**
 * Minimal shell command tokenizer.
 * Splits on whitespace, respects double and single quotes.
 * Does not handle pipes, redirections, or escapes beyond quotes.
 */
export function tokenizeCommand(commandString: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of commandString) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Extract file paths from a tokenized command using a descriptor.
 */
export function extractPaths(
  descriptor: CommandDescriptor,
  tokens: string[],
): { path: string; right: Right }[] {
  const args = tokens.slice(1); // skip command name
  const results: { path: string; right: Right }[] = [];

  for (const pa of descriptor.pathArgs) {
    const ext = pa.extractor;
    switch (ext.kind) {
      case 'positional': {
        // Skip flags to find the nth positional arg
        let posIndex = 0;
        for (const arg of args) {
          if (arg.startsWith('-')) continue;
          if (posIndex === ext.index) {
            results.push({ path: arg, right: pa.right });
            break;
          }
          posIndex++;
        }
        break;
      }
      case 'flag': {
        const flagIdx = args.indexOf(ext.flag);
        if (flagIdx >= 0 && flagIdx + 1 < args.length) {
          results.push({ path: args[flagIdx + 1], right: pa.right });
        }
        break;
      }
      case 'rest': {
        let posIndex = 0;
        for (const arg of args) {
          if (arg.startsWith('-')) continue;
          if (posIndex >= ext.startIndex) {
            results.push({ path: arg, right: pa.right });
          }
          posIndex++;
        }
        break;
      }
      case 'custom': {
        for (const p of ext.extract(args)) {
          results.push({ path: p, right: pa.right });
        }
        break;
      }
    }
  }

  return results;
}
