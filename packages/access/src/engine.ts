import type { Right, AccessRule } from './rights.js';
import type {
  AccessContext,
  AccessVerdict,
  PathVerdict,
  AlternativeContext,
  PathAnnotation,
  ContextRanking,
  GapAnalysis,
  WorkAssignment,
} from './types.js';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { ContextRegistry } from './registry.js';
import { matchesIgnorePatterns } from './policy.js';
import { resolveAndNormalize } from './paths.js';
import { parseAccessFile, parseIgnoreStylePatterns, scopePatternToBaseDir } from './access-file.js';
import {
  CommandRegistry,
  ToolRegistry,
  tokenizeCommand,
  extractPaths,
} from './operations.js';
import type { CommandDescriptor, ToolDescriptor } from './operations.js';

export interface AccessEngineOptions {
  /** Workspace root (absolute path). All paths are normalized relative to this. */
  workspaceRoot: string;

  /** Policy for unregistered shell commands: 'deny' (default) or 'allow'. */
  defaultCommandPolicy?: 'deny' | 'allow';

  /** Policy for unregistered tool calls: 'deny' (default) or 'allow'. */
  defaultToolPolicy?: 'deny' | 'allow';

  /** Automatically discover and load workspace convention files (default: true). */
  autoLoadWorkspaceConventions?: boolean;
}

interface DiscoveredConventions {
  contextRules: Map<string, AccessRule[]>;
  ignorePatterns: string[];
}

const IGNORE_CONVENTION_FILE_NAMES = new Set([
  '.gitignore',
  '.copilot-ignore',
  '.copilotignore',
  'copilotignore',
  '.claudeignore',
  '.cursorignore',
  '.aiderignore',
]);

const CONTEXT_CONVENTION_RE = /^\.?(.+)\.access$/;

/**
 * The main access-rights engine.
 *
 * Holds contexts, operation registries, ignore patterns,
 * and provides all check/filter/introspect/delegate APIs.
 */
export class AccessEngine {
  readonly workspaceRoot: string;
  readonly contexts: ContextRegistry;
  readonly commands: CommandRegistry;
  readonly tools: ToolRegistry;

  private readonly defaultCommandPolicy: 'deny' | 'allow';
  private readonly defaultToolPolicy: 'deny' | 'allow';
  private readonly autoLoadWorkspaceConventions: boolean;

  /** Global ignore patterns (from ignore files, applied to all contexts). */
  private ignorePatterns: string[] = [];
  private discoveredIgnorePatterns: string[] = [];
  private discoveredContextRules = new Map<string, AccessRule[]>();
  private readonly explicitContextRules = new Map<string, AccessRule[]>();
  private conventionWatcher: FSWatcher | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(options: AccessEngineOptions) {
    this.workspaceRoot = options.workspaceRoot.replaceAll('\\', '/');
    this.contexts = new ContextRegistry();
    this.commands = new CommandRegistry();
    this.tools = new ToolRegistry();
    this.defaultCommandPolicy = options.defaultCommandPolicy ?? 'deny';
    this.defaultToolPolicy = options.defaultToolPolicy ?? 'deny';
    this.autoLoadWorkspaceConventions = options.autoLoadWorkspaceConventions ?? true;

    if (this.autoLoadWorkspaceConventions) {
      this.loadWorkspaceConventions();
    }
  }

  // ── Context management ─────────────────────────────────────────

  registerContext(ctx: AccessContext): void {
    this.explicitContextRules.set(ctx.id, [...ctx.rules]);
    this.contexts.register(ctx);
    this.applyDiscoveredRulesToContext(ctx.id);
  }

  updateContext(id: string, patch: Partial<Omit<AccessContext, 'id'>>): void {
    if (patch.rules) {
      this.explicitContextRules.set(id, [...patch.rules]);
      const discovered = this.discoveredContextRules.get(id) ?? [];
      this.contexts.update(id, {
        ...patch,
        rules: [...patch.rules, ...discovered],
      });
      return;
    }

    this.contexts.update(id, patch);
  }

  removeContext(id: string): boolean {
    this.explicitContextRules.delete(id);
    return this.contexts.remove(id);
  }

  getContext(id: string): AccessContext | undefined {
    return this.contexts.get(id);
  }

  setGlobalContext(id: string): void {
    this.contexts.setGlobal(id);
  }

  setActiveContext(id: string): void {
    this.contexts.setActive(id);
  }

  // ── Operation registration ─────────────────────────────────────

  registerCommand(desc: CommandDescriptor): void {
    this.commands.register(desc);
  }

  registerTool(desc: ToolDescriptor): void {
    this.tools.register(desc);
  }

  // ── Ignore patterns ────────────────────────────────────────────

  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = [...patterns];
  }

  addIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns.push(...patterns);
  }

  getIgnorePatterns(): readonly string[] {
    return this.getEffectiveIgnorePatterns();
  }

  // ── Access-file registration ──────────────────────────────────

  /**
   * Load rules from an ignore-style access file and append them to a context.
   *
   * - Without sections, every pattern is treated as deny-all-rights.
   * - With sections, each section title defines effect/rights for its patterns.
   */
  async registerAccessFile(contextId: string, filePath: string, cwd?: string): Promise<void> {
    const effectiveCwd = cwd ?? this.workspaceRoot;
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(effectiveCwd, filePath);
    const content = await readFile(absolutePath, 'utf8');
    const parsedRules = parseAccessFile(content);

    if (parsedRules.length === 0) return;

    const ctx = this.contexts.get(contextId);
    if (!ctx) {
      throw new Error(`Context not found: ${contextId}`);
    }

    const explicit = this.explicitContextRules.get(contextId) ?? [...ctx.rules];
    const nextExplicit = [...explicit, ...parsedRules];
    this.explicitContextRules.set(contextId, nextExplicit);

    const discovered = this.discoveredContextRules.get(contextId) ?? [];
    this.contexts.update(contextId, {
      rules: [...nextExplicit, ...discovered],
    });
  }

  /**
   * Load an access file into the currently configured global context.
   */
  async registerGlobalAccessFile(filePath: string, cwd?: string): Promise<void> {
    const globalId = this.contexts.getGlobalId();
    if (!globalId) {
      throw new Error('Global context is not set. Register and set a global context first.');
    }
    await this.registerAccessFile(globalId, filePath, cwd);
  }

  /**
   * Discover and apply workspace convention files.
   *
   * Discovers:
   * - context access files: `.contextId.access` and `contextId.access`
   * - global ignore files: `.gitignore`, `.copilot-ignore`, `.copilotignore`, `copilotignore`,
   *   `.claudeignore`, `.cursorignore`, `.aiderignore`
   */
  loadWorkspaceConventions(): void {
    const discovered = this.discoverWorkspaceConventions();
    this.discoveredContextRules = discovered.contextRules;
    this.discoveredIgnorePatterns = discovered.ignorePatterns;

    for (const contextId of this.contexts.ids()) {
      this.applyDiscoveredRulesToContext(contextId);
    }
  }

  /** Start recursive workspace watcher for convention files. */
  startConventionWatcher(): void {
    if (this.conventionWatcher) return;

    this.conventionWatcher = chokidar.watch(this.workspaceRoot, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 75,
        pollInterval: 25,
      },
    });

    const onFileEvent = (watchPath: string) => {
      if (!this.isConventionFilePath(watchPath)) return;
      this.scheduleConventionRefresh();
    };

    const onDirEvent = () => {
      this.scheduleConventionRefresh();
    };

    this.conventionWatcher.on('add', onFileEvent);
    this.conventionWatcher.on('change', onFileEvent);
    this.conventionWatcher.on('unlink', onFileEvent);
    this.conventionWatcher.on('addDir', onDirEvent);
    this.conventionWatcher.on('unlinkDir', onDirEvent);
    this.conventionWatcher.on('error', onDirEvent);
  }

  /** Stop workspace convention watcher and pending refresh timer. */
  stopConventionWatcher(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (!this.conventionWatcher) return;
    this.conventionWatcher.close().catch(() => undefined);
    this.conventionWatcher = null;
  }

  // ── Core check: single path ────────────────────────────────────

  checkPath(
    filePath: string,
    right: Right,
    cwd: string,
    contextId?: string,
  ): AccessVerdict {
    const wsRel = resolveAndNormalize(filePath, cwd, this.workspaceRoot);
    const pv = this.evaluatePath(wsRel, right, contextId);
    const alternatives = pv.allowed ? [] : this.findAlternativesForPaths([wsRel], right);
    return this.buildVerdict([pv], alternatives);
  }

  // ── Core check: shell command ──────────────────────────────────

  checkCommand(
    commandString: string,
    cwd: string,
    contextId?: string,
  ): AccessVerdict {
    const tokens = tokenizeCommand(commandString);
    if (tokens.length === 0) {
      return { allowed: true, paths: [], alternativeContexts: [], explanation: 'Empty command.' };
    }

    const cmdName = tokens[0];
    const descriptor = this.commands.get(cmdName);

    if (!descriptor) {
      const allowed = this.defaultCommandPolicy === 'allow';
      return {
        allowed,
        paths: [],
        alternativeContexts: [],
        explanation: allowed
          ? `Unregistered command '${cmdName}': allowed by default policy.`
          : `Unregistered command '${cmdName}': denied by default policy.`,
      };
    }

    const extracted = extractPaths(descriptor, tokens);
    const pathVerdicts: PathVerdict[] = [];

    for (const { path: p, right } of extracted) {
      const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
      pathVerdicts.push(this.evaluatePath(wsRel, right, contextId));
    }

    const deniedPaths = pathVerdicts.filter((pv) => !pv.allowed).map((pv) => pv.path);
    const alternatives = deniedPaths.length > 0
      ? this.findAlternativesForPaths(deniedPaths, extracted[0]?.right ?? 'read')
      : [];

    return this.buildVerdict(pathVerdicts, alternatives);
  }

  // ── Core check: tool call ──────────────────────────────────────

  checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    cwd: string,
    contextId?: string,
  ): AccessVerdict {
    const descriptor = this.tools.get(toolName);

    if (!descriptor) {
      const allowed = this.defaultToolPolicy === 'allow';
      return {
        allowed,
        paths: [],
        alternativeContexts: [],
        explanation: allowed
          ? `Unregistered tool '${toolName}': allowed by default policy.`
          : `Unregistered tool '${toolName}': denied by default policy.`,
      };
    }

    const pathVerdicts: PathVerdict[] = [];

    // Direct path params
    for (const pp of descriptor.pathParams) {
      const val = args[pp.paramName];
      if (typeof val !== 'string') continue;
      const wsRel = resolveAndNormalize(val, cwd, this.workspaceRoot);
      pathVerdicts.push(this.evaluatePath(wsRel, pp.right, contextId));
    }

    // Compound: parse embedded shell command
    if (descriptor.shellParam) {
      const shellCmd = args[descriptor.shellParam];
      if (typeof shellCmd === 'string') {
        const innerVerdict = this.checkCommand(shellCmd, cwd, contextId);
        pathVerdicts.push(...innerVerdict.paths);
      }
    }

    const deniedPaths = pathVerdicts.filter((pv) => !pv.allowed).map((pv) => pv.path);
    const alternatives = deniedPaths.length > 0
      ? this.findAlternativesForPaths(deniedPaths, pathVerdicts[0]?.right ?? 'read')
      : [];

    return this.buildVerdict(pathVerdicts, alternatives);
  }

  // ── Batch operations ───────────────────────────────────────────

  /** Keep only paths the context may access for the given right. */
  filterPaths(
    paths: string[],
    right: Right,
    cwd: string,
    contextId?: string,
  ): string[] {
    return paths.filter((p) => {
      const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
      return this.evaluatePath(wsRel, right, contextId).allowed;
    });
  }

  /** Bulk check: one verdict per path. */
  checkPaths(
    paths: string[],
    right: Right,
    cwd: string,
    contextId?: string,
  ): AccessVerdict[] {
    return paths.map((p) => this.checkPath(p, right, cwd, contextId));
  }

  /** Annotate every path with each context's rights. */
  annotatePaths(paths: string[], cwd: string): PathAnnotation[] {
    const allIds = this.contexts.ids();

    return paths.map((p) => {
      const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
      const contextRights = new Map<string, Set<Right>>();

      for (const cid of allIds) {
        const rights = new Set<Right>();
        for (const r of (['read', 'write', 'create', 'delete', 'list'] as const)) {
          if (this.evaluatePath(wsRel, r, cid).allowed) {
            rights.add(r);
          }
        }
        if (rights.size > 0) {
          contextRights.set(cid, rights);
        }
      }

      return { path: wsRel, contextRights };
    });
  }

  // ── Introspection & delegation ─────────────────────────────────

  /** Which contexts allow this path + right. */
  whoCanAccess(path: string, right: Right, cwd: string): string[] {
    const wsRel = resolveAndNormalize(path, cwd, this.workspaceRoot);
    return this.contexts.ids().filter((cid) =>
      this.evaluatePath(wsRel, right, cid).allowed,
    );
  }

  /** Per-path rights map for a given context. */
  whatCanContextDo(
    contextId: string,
    paths: string[],
    cwd: string,
  ): Map<string, Set<Right>> {
    const result = new Map<string, Set<Right>>();
    for (const p of paths) {
      const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
      const rights = new Set<Right>();
      for (const r of (['read', 'write', 'create', 'delete', 'list'] as const)) {
        if (this.evaluatePath(wsRel, r, contextId).allowed) {
          rights.add(r);
        }
      }
      result.set(wsRel, rights);
    }
    return result;
  }

  /** Rank contexts by coverage count for a set of paths + right. */
  rankContexts(paths: string[], right: Right, cwd: string): ContextRanking[] {
    const allIds = this.contexts.ids();
    const rankings: ContextRanking[] = [];

    for (const cid of allIds) {
      const covered: string[] = [];
      for (const p of paths) {
        const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
        if (this.evaluatePath(wsRel, right, cid).allowed) {
          covered.push(wsRel);
        }
      }
      rankings.push({ contextId: cid, coverageCount: covered.length, coveredPaths: covered });
    }

    rankings.sort((a, b) => b.coverageCount - a.coverageCount);
    return rankings;
  }

  /** What's blocked for contextId and who can help. */
  findGaps(paths: string[], right: Right, contextId: string, cwd: string): GapAnalysis {
    const denied: string[] = [];
    const alternatives: { path: string; contextIds: string[] }[] = [];

    for (const p of paths) {
      const wsRel = resolveAndNormalize(p, cwd, this.workspaceRoot);
      if (!this.evaluatePath(wsRel, right, contextId).allowed) {
        denied.push(wsRel);
        const who = this.contexts.ids().filter(
          (cid) => cid !== contextId && this.evaluatePath(wsRel, right, cid).allowed,
        );
        alternatives.push({ path: wsRel, contextIds: who });
      }
    }

    return { denied, alternatives };
  }

  /**
   * Distribute a set of paths across contexts optimally.
   *
   * Greedy set-cover: repeatedly pick the context that covers the most
   * remaining uncovered paths, assign those paths to it, repeat.
   */
  distributeWork(paths: string[], right: Right, cwd: string): WorkAssignment[] {
    const wsRelPaths = paths.map((p) => resolveAndNormalize(p, cwd, this.workspaceRoot));
    const remaining = new Set(wsRelPaths);
    const assignments: WorkAssignment[] = [];
    const allIds = this.contexts.ids();

    while (remaining.size > 0) {
      const { bestId, bestCovered } = this.findBestCoverageContext(allIds, remaining, right);

      if (!bestId || bestCovered.length === 0) break; // remaining paths have no access

      assignments.push({ contextId: bestId, paths: bestCovered });
      for (const p of bestCovered) remaining.delete(p);
    }

    // Report unassignable paths
    if (remaining.size > 0) {
      assignments.push({ contextId: '__unassigned__', paths: [...remaining] });
    }

    return assignments;
  }

  /** List rules for a context (or all contexts). */
  listRules(contextId?: string): { contextId: string; rules: AccessContext['rules'] }[] {
    const ids = contextId ? [contextId] : this.contexts.ids();
    return ids
      .map((id) => {
        const ctx = this.contexts.get(id);
        return ctx ? { contextId: id, rules: ctx.rules } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  // ── Internal evaluation ────────────────────────────────────────

  /**
   * Evaluate a single workspace-relative path against the layered policy.
   * If contextId is omitted, uses the active context (if set).
   */
  private evaluatePath(wsRelPath: string, right: Right, contextId?: string): PathVerdict {
    const effectiveIgnorePatterns = this.getEffectiveIgnorePatterns();

    // Check ignore patterns first — ignored = invisible
    if (effectiveIgnorePatterns.length > 0 && matchesIgnorePatterns(wsRelPath, effectiveIgnorePatterns)) {
      return {
        path: wsRelPath,
        right,
        allowed: false,
        deniedByIgnore: true,
      };
    }

    const globalId = this.contexts.getGlobalId();
    const activeId = contextId ?? this.contexts.getActiveId();

    const deniedByGlobal = this.evaluateDeniedByContext(globalId, wsRelPath, right);
    if (deniedByGlobal) return deniedByGlobal;

    const deniedByActive = this.evaluateDeniedByContext(activeId, wsRelPath, right);
    if (deniedByActive) return deniedByActive;

    const allowedByActive = this.evaluateAllowedByContext(activeId, wsRelPath, right);
    if (allowedByActive) return allowedByActive;

    const allowedByGlobal = this.evaluateAllowedByContext(globalId, wsRelPath, right);
    if (allowedByGlobal) return allowedByGlobal;

    // 5. No rule matched → implicit deny
    return { path: wsRelPath, right, allowed: false };
  }

  /** Find contexts that can handle the given denied paths. */
  private findAlternativesForPaths(
    deniedWsRelPaths: string[],
    right: Right,
  ): AlternativeContext[] {
    const allIds = this.contexts.ids();
    const activeId = this.contexts.getActiveId();
    const alternatives: AlternativeContext[] = [];

    for (const cid of allIds) {
      if (cid === activeId) continue;

      const allowedPaths: string[] = [];
      for (const p of deniedWsRelPaths) {
        if (this.evaluatePath(p, right, cid).allowed) {
          allowedPaths.push(p);
        }
      }
      if (allowedPaths.length > 0) {
        alternatives.push({ contextId: cid, allowedPaths });
      }
    }

    // Sort by coverage (most paths first)
    alternatives.sort((a, b) => b.allowedPaths.length - a.allowedPaths.length);
    return alternatives;
  }

  /** Build an AccessVerdict from path verdicts and alternatives. */
  private buildVerdict(
    pathVerdicts: PathVerdict[],
    alternatives: AlternativeContext[],
  ): AccessVerdict {
    const allAllowed = pathVerdicts.every((pv) => pv.allowed);
    const denied = pathVerdicts.filter((pv) => !pv.allowed);
    const allowed = pathVerdicts.filter((pv) => pv.allowed);

    let explanation: string;
    if (allAllowed) {
      explanation = pathVerdicts.length === 0
        ? 'No paths to check.'
        : `All ${pathVerdicts.length} path(s) allowed.`;
    } else {
      const parts: string[] = [];
      if (allowed.length > 0) parts.push(`${allowed.length} allowed`);
      parts.push(`${denied.length} denied`);
      const altPart = alternatives.length > 0
        ? ` (${alternatives.length} alternative context(s) available)`
        : '';
      explanation = `${parts.join(', ')}${altPart}.`;
    }

    return {
      allowed: allAllowed,
      paths: pathVerdicts,
      alternativeContexts: alternatives,
      explanation,
    };
  }

  private getEffectiveIgnorePatterns(): string[] {
    return [...this.ignorePatterns, ...this.discoveredIgnorePatterns];
  }

  private applyDiscoveredRulesToContext(contextId: string): void {
    const existing = this.contexts.get(contextId);
    if (!existing) return;

    const explicit = this.explicitContextRules.get(contextId) ?? [...existing.rules];
    this.explicitContextRules.set(contextId, explicit);

    const discovered = this.discoveredContextRules.get(contextId) ?? [];
    this.contexts.update(contextId, {
      rules: [...explicit, ...discovered],
    });
  }

  private scheduleConventionRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.loadWorkspaceConventions();
    }, 75);
  }

  private discoverWorkspaceConventions(): DiscoveredConventions {
    const contextRules = new Map<string, AccessRule[]>();
    const ignorePatterns: string[] = [];

    const files = this.listFilesRecursively(this.workspaceRoot);
    for (const filePath of files) {
      const fileName = basename(filePath);

      if (!this.isConventionFileName(fileName)) {
        continue;
      }

      if (this.isContextConventionFileName(fileName)) {
        this.collectContextConventionRules(filePath, fileName, contextRules);
      }

      if (IGNORE_CONVENTION_FILE_NAMES.has(fileName)) {
        this.collectIgnoreConventionPatterns(filePath, ignorePatterns);
      }
    }

    return { contextRules, ignorePatterns };
  }

  private listFilesRecursively(rootDir: string): string[] {
    const files: string[] = [];
    const stack = [rootDir];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = this.readDirSafe(current);
      if (!entries) continue;

      for (const entry of entries) {
        this.processRecursiveEntry(current, entry, stack, files);
      }
    }

    return files;
  }

  private processRecursiveEntry(
    current: string,
    entry: string,
    stack: string[],
    files: string[],
  ): void {
    const fullPath = join(current, entry);

    const stats = this.statSafe(fullPath);
    if (!stats) return;

    if (stats.isDirectory()) {
      stack.push(fullPath);
      return;
    }

    if (stats.isFile()) {
      files.push(fullPath);
    }
  }

  private findBestCoverageContext(
    allIds: string[],
    remaining: Set<string>,
    right: Right,
  ): { bestId: string | null; bestCovered: string[] } {
    let bestId: string | null = null;
    let bestCovered: string[] = [];

    for (const cid of allIds) {
      const covered: string[] = [];
      for (const p of remaining) {
        if (this.evaluatePath(p, right, cid).allowed) {
          covered.push(p);
        }
      }
      if (covered.length > bestCovered.length) {
        bestId = cid;
        bestCovered = covered;
      }
    }

    return { bestId, bestCovered };
  }

  private evaluateDeniedByContext(
    contextId: string | null,
    wsRelPath: string,
    right: Right,
  ): PathVerdict | null {
    if (!contextId) return null;
    const result = this.contexts.getCompiled(contextId).evaluate(wsRelPath, right);
    if (!result.allowed && result.rule) {
      return {
        path: wsRelPath,
        right,
        allowed: false,
        deniedBy: result.rule,
      };
    }
    return null;
  }

  private evaluateAllowedByContext(
    contextId: string | null,
    wsRelPath: string,
    right: Right,
  ): PathVerdict | null {
    if (!contextId) return null;
    const result = this.contexts.getCompiled(contextId).evaluate(wsRelPath, right);
    if (result.allowed) {
      return {
        path: wsRelPath,
        right,
        allowed: true,
        matchedRule: result.rule,
      };
    }
    return null;
  }

  private collectContextConventionRules(
    filePath: string,
    fileName: string,
    contextRules: Map<string, AccessRule[]>,
  ): void {
    const contextId = this.getContextIdFromConventionFile(fileName);
    if (!contextId) return;

    const content = this.readTextFileSafe(filePath);
    if (content === null) return;

    const parsed = parseAccessFile(content);
    if (parsed.length === 0) return;

    const wsRelFile = this.toWorkspaceRelative(filePath);
    const wsRelDir = this.toWorkspaceRelative(dirname(filePath));
    const baseDir = wsRelFile.startsWith('.ai-team/') || wsRelFile === '.ai-team' ? '' : wsRelDir;

    const scopedRules = parsed.map((rule) => ({
      ...rule,
      pathPattern: scopePatternToBaseDir(rule.pathPattern, baseDir),
    }));

    const existing = contextRules.get(contextId) ?? [];
    contextRules.set(contextId, [...existing, ...scopedRules]);
  }

  private collectIgnoreConventionPatterns(filePath: string, ignorePatterns: string[]): void {
    const content = this.readTextFileSafe(filePath);
    if (content === null) return;

    const parsedPatterns = parseIgnoreStylePatterns(content);
    if (parsedPatterns.length === 0) return;

    const wsRelDir = this.toWorkspaceRelative(dirname(filePath));
    for (const pattern of parsedPatterns) {
      ignorePatterns.push(scopePatternToBaseDir(pattern, wsRelDir));
    }
  }

  private readDirSafe(dirPath: string): string[] | null {
    try {
      return readdirSync(dirPath);
    } catch {
      return null;
    }
  }

  private statSafe(filePath: string): ReturnType<typeof statSync> | null {
    try {
      return statSync(filePath);
    } catch {
      return null;
    }
  }

  private toWorkspaceRelative(filePath: string): string {
    const raw = relative(this.workspaceRoot, filePath).replaceAll('\\', '/');
    if (!raw || raw === '.') {
      return '';
    }
    return raw.replace(/^\/+/, '');
  }

  private isConventionFilePath(filePath: string): boolean {
    return this.isConventionFileName(basename(filePath));
  }

  private isConventionFileName(fileName: string): boolean {
    return this.isContextConventionFileName(fileName)
      || IGNORE_CONVENTION_FILE_NAMES.has(fileName);
  }

  private isContextConventionFileName(fileName: string): boolean {
    return CONTEXT_CONVENTION_RE.test(fileName);
  }

  private getContextIdFromConventionFile(fileName: string): string | null {
    const match = CONTEXT_CONVENTION_RE.exec(fileName);
    if (!match) {
      return null;
    }

    return match[1].trim() || null;
  }

  private readTextFileSafe(filePath: string): string | null {
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }
}
