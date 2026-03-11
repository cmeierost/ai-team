import { minimatch } from 'minimatch';
import type { AccessRule, Right } from './rights.js';
import { fileName } from './paths.js';

/**
 * Compiled form of an AccessRule for fast repeated matching.
 */
interface CompiledRule {
  rule: AccessRule;
  matchPath: (wsRelPath: string) => boolean;
  matchFile: ((name: string) => boolean) | null;
}

/**
 * Compile a single rule into fast matchers.
 */
function compileRule(rule: AccessRule): CompiledRule {
  const matchPath = minimatch.filter(rule.pathPattern, { dot: true });
  const matchFile = rule.filePattern
    ? minimatch.filter(rule.filePattern, { dot: true })
    : null;

  return { rule, matchPath, matchFile };
}

/**
 * A compiled rule set for fast evaluation.
 * Internally separates deny and allow rules.
 */
export class CompiledRuleSet {
  private readonly deny: CompiledRule[];
  private readonly allow: CompiledRule[];

  constructor(rules: AccessRule[]) {
    this.deny = [];
    this.allow = [];
    for (const r of rules) {
      const compiled = compileRule(r);
      if (r.effect === 'deny') {
        this.deny.push(compiled);
      } else {
        this.allow.push(compiled);
      }
    }
  }

  /**
   * Evaluate deny-before-allow for a single path + right.
   *
   * Returns:
   * - `{ allowed: false, rule }` if a deny rule matches
   * - `{ allowed: true, rule }` if an allow rule matches and no deny blocks it
   * - `{ allowed: false, rule: undefined }` if nothing matches (implicit deny)
   */
  evaluate(
    wsRelPath: string,
    right: Right,
  ): { allowed: boolean; rule?: AccessRule } {
    const name = fileName(wsRelPath);

    // Check deny rules first
    for (const c of this.deny) {
      if (c.rule.right !== right) continue;
      if (!c.matchPath(wsRelPath)) continue;
      if (c.matchFile && !c.matchFile(name)) continue;
      return { allowed: false, rule: c.rule };
    }

    // Check allow rules
    for (const c of this.allow) {
      if (c.rule.right !== right) continue;
      if (!c.matchPath(wsRelPath)) continue;
      if (c.matchFile && !c.matchFile(name)) continue;
      return { allowed: true, rule: c.rule };
    }

    // No rule matched → implicit deny
    return { allowed: false };
  }
}

/**
 * Evaluate an ordered list of ignore patterns (gitignore-style).
 * Returns true if the path should be invisible.
 */
export function matchesIgnorePatterns(
  wsRelPath: string,
  patterns: string[],
): boolean {
  let ignored = false;

  for (const rawPattern of patterns) {
    const trimmed = rawPattern.trim();
    if (!trimmed) continue;

    const negate = trimmed.startsWith('!');
    let pattern = negate ? trimmed.slice(1).trim() : trimmed;
    if (!pattern) continue;

    // Directory-like ignore entries should affect all descendants.
    if (pattern.endsWith('/')) {
      pattern = `${pattern}**`;
    }

    if (minimatch(wsRelPath, pattern, { dot: true })) {
      ignored = !negate;
    }
  }

  return ignored;
}
