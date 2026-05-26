import fs from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  parseAccessFile,
  permissionRulesToPatternSet,
  explicitListPatternsFromRules,
  serializePatternSetToAccessFile,
} from './access-file.js';
import type { AccessPatternSet } from './access-file.js';
import { ContextRuntime } from './context-runtime.js';
import { WorkspaceFs } from '../workspace-fs.js';
import { normalizePath } from '../paths.js';

const EMPTY_PATTERNS: AccessPatternSet = { list: [], read: [], write: [] };

/**
 * Registry for agent `.perm` files under `.ai-team/agents/`.
 * Handles read, write, and optional file watching of permission files.
 *
 * Also owns a ContextRuntime instance and can produce WorkspaceFs accessors.
 * Call `initAsync(getFilesAsync)` once at session start to load all agents
 * into the runtime, then use `createAgentFs(agentId)` per-agent.
 */
export class PermFileRegistry {
  private readonly workspaceRoot: string;
  private readonly agentsDir: string;
  private readonly runtime = new ContextRuntime();
  private getFilesAsync: (() => Promise<string[]>) | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.agentsDir = path.join(this.workspaceRoot, '.ai-team', 'agents');
  }

  // ─── Runtime ownership ──────────────────────────────────────────────────────

  /**
   * Load all agent `.perm` files and register them into the shared ContextRuntime.
   * Must be called once at session start before using `createAgentFs`.
   *
   * @param getFilesAsync  Supplier that returns the current list of workspace files
   *                       (workspace-relative POSIX paths). Called once now, and on
   *                       each `.perm` file change when watching.
   */
  async initAsync(getFilesAsync: () => Promise<string[]>): Promise<void> {
    this.getFilesAsync = getFilesAsync;
    const allFiles = await getFilesAsync();
    const agentIds = await this.listAgentIdsAsync();
    await Promise.all(agentIds.map((id) => this.refreshAgentInRuntimeAsync(id, allFiles)));
  }

  /** The underlying runtime — usable directly when you need multi-agent queries. */
  getRuntime(): ContextRuntime {
    return this.runtime;
  }

  /**
   * Create a `WorkspaceFs` scoped to a specific agent.
   * `initAsync` must have been called first.
   */
  createAgentFs(agentId: string): WorkspaceFs {
    return new WorkspaceFs(this.workspaceRoot, agentId, this.runtime);
  }

  /**
   * Start watching `.perm` files and auto-refresh the runtime on changes.
   * Returns a dispose function.
   * `initAsync` must have been called first.
   */
  watchRuntime(debounceMs = 75): () => void {
    return this.watch(async (agentId) => {
      const getFiles = this.getFilesAsync;
      if (!getFiles) return;
      const allFiles = await getFiles();
      await this.refreshAgentInRuntimeAsync(agentId, allFiles);
    }, debounceMs);
  }

  private async refreshAgentInRuntimeAsync(agentId: string, allFiles: string[]): Promise<void> {
    const patterns = await this.loadAsync(agentId);
    const normalizedFiles = allFiles.map((f) => normalizePath(f, this.workspaceRoot));
    this.runtime.registerFromPatterns(agentId, patterns, normalizedFiles);
  }

  private async listAgentIdsAsync(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.agentsDir);
      return entries
        .filter((e: string) => e.endsWith('.perm'))
        .map((e: string) => e.replace(/^\./, '').replace(/\.perm$/, ''));
    } catch {
      return [];
    }
  }

  // ─── Per-file load / save ───────────────────────────────────────────────────

  getPermFilePath(agentId: string): string {
    return path.join(this.agentsDir, `${agentId}.perm`);
  }

  private getLegacyPermFilePath(agentId: string): string {
    return path.join(this.agentsDir, `.${agentId}.perm`);
  }

  async loadAsync(agentId: string): Promise<AccessPatternSet> {
    const primary = this.getPermFilePath(agentId);
    const legacy = this.getLegacyPermFilePath(agentId);

    for (const filePath of [primary, legacy]) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const rules = parseAccessFile(content);
        const parsed = permissionRulesToPatternSet(rules);
        return {
          list: explicitListPatternsFromRules(rules),
          read: parsed.read,
          write: parsed.write,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    return { ...EMPTY_PATTERNS };
  }

  async saveAsync(agentId: string, patterns: AccessPatternSet): Promise<void> {
    const primary = this.getPermFilePath(agentId);
    const legacy = this.getLegacyPermFilePath(agentId);
    const content = serializePatternSetToAccessFile(patterns);

    if (!content.trim()) {
      for (const filePath of [primary, legacy]) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return;
    }

    await fs.mkdir(path.dirname(primary), { recursive: true });
    await fs.writeFile(primary, content, 'utf-8');

    // Clean up legacy dot-prefix file if it exists
    try {
      await fs.unlink(legacy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /**
   * Watch for `.perm` file changes under the agents directory.
   * The callback receives the agentId derived from the changed file name.
   * Returns a dispose function that closes the watcher.
   */
  watch(onChange: (agentId: string) => void, debounceMs = 75): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    let watcher: FSWatcher | null = null;

    const flush = () => {
      timer = null;
      for (const agentId of pending) {
        onChange(agentId);
      }
      pending.clear();
    };

    const handleEvent = (filePath: string) => {
      const base = path.basename(filePath);
      // Strip leading dot (legacy) and .perm extension
      const agentId = base.replace(/^\./, '').replace(/\.perm$/, '');
      pending.add(agentId);
      if (!timer) {
        timer = setTimeout(flush, debounceMs);
      }
    };

    watcher = watch(path.join(this.agentsDir, '*.perm'), {
      ignoreInitial: true,
      persistent: false,
    });

    watcher.on('add', handleEvent).on('change', handleEvent).on('unlink', handleEvent);

    return () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      watcher?.close();
    };
  }
}
