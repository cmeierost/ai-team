import { watch, type FSWatcher } from 'chokidar';

export interface WatcherOptions {
  debounceMs?: number;
}

export class FileContextWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPermChanges = new Set<string>();
  private pendingFileChanges = new Set<string>();
  private debounceMs: number;
  private onPermChange: (paths: string[]) => void;
  private onFileChange: (paths: string[]) => void;

  constructor(
    onPermChange: (paths: string[]) => void,
    onFileChange: (paths: string[]) => void,
    options?: WatcherOptions
  ) {
    this.onPermChange = onPermChange;
    this.onFileChange = onFileChange;
    this.debounceMs = options?.debounceMs ?? 75;
  }

  start(watchPaths: string[], permFilePatterns: string[] = ['**/*.perm']): void {
    if (this.watcher) return;

    const permPatternSet = new Set(permFilePatterns);

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
    });

    const handleEvent = (filePath: string) => {
      const posixPath = filePath.replaceAll('\\', '/');
      const isPerm = permPatternSet.has(posixPath) || posixPath.endsWith('.perm');

      if (isPerm) {
        this.pendingPermChanges.add(posixPath);
      } else {
        this.pendingFileChanges.add(posixPath);
      }

      this.scheduleFlush();
    };

    this.watcher.on('add', handleEvent).on('change', handleEvent).on('unlink', handleEvent);
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    this.debounceTimer = null;

    if (this.pendingPermChanges.size > 0) {
      const paths = [...this.pendingPermChanges];
      this.pendingPermChanges.clear();
      this.onPermChange(paths);
    }

    if (this.pendingFileChanges.size > 0) {
      const paths = [...this.pendingFileChanges];
      this.pendingFileChanges.clear();
      this.onFileChange(paths);
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.pendingPermChanges.clear();
    this.pendingFileChanges.clear();
  }
}
