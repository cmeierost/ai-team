/**
 * File event emitter — lightweight typed pub/sub for file-level events.
 *
 * Two channels:
 *  - `file.edited`  — emitted by our write tools after a successful write.
 *                      Subscribers (e.g. the format subsystem) react to these.
 *  - `file.changed` — emitted by the chokidar watcher for external FS changes.
 *                      Subscribers (e.g. cache invalidation) react to these.
 *
 * This module is intentionally dependency-free so it can live at the bottom
 * of the package graph without pulling in zod, chokidar, etc.
 */

// ─── Event types ──────────────────────────────────────────────────────────────

export interface FileEditedEvent {
  /** Absolute path of the file that was written. */
  filePath: string;
  /** Whether this was a newly created file vs. an overwrite of an existing file. */
  created: boolean;
}

export type FileWatcherChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileWatcherEvent {
  /** Absolute path of the changed entry. */
  filePath: string;
  /** Kind of change that occurred. */
  kind: FileWatcherChangeKind;
}

// ─── Listener signatures ─────────────────────────────────────────────────────

export type FileEditedListener = (event: FileEditedEvent) => void;
export type FileWatcherListener = (event: FileWatcherEvent) => void;

// ─── Internal state ───────────────────────────────────────────────────────────

const editedListeners = new Set<FileEditedListener>();
const watcherListeners = new Set<FileWatcherListener>();

// ─── Publish ──────────────────────────────────────────────────────────────────

/** Emit a `file.edited` event (called by write tools after a successful write). */
export function emitFileEdited(filePath: string): void {
  const event: FileEditedEvent = { filePath, created: false };
  for (const listener of editedListeners) {
    try { listener(event); } catch { /* listeners must not throw into callers */ }
  }
}

/** Emit a `file.edited` event with `created: true` (called after creating a new file). */
export function emitFileCreated(filePath: string): void {
  const event: FileEditedEvent = { filePath, created: true };
  for (const listener of editedListeners) {
    try { listener(event); } catch { /* listeners must not throw into callers */ }
  }
}

/** Emit a `file.changed` event (called by the chokidar watcher on external changes). */
export function emitFileWatcherEvent(filePath: string, kind: FileWatcherChangeKind): void {
  const event: FileWatcherEvent = { filePath, kind };
  for (const listener of watcherListeners) {
    try { listener(event); } catch { /* listeners must not throw into callers */ }
  }
}

// ─── Subscribe ────────────────────────────────────────────────────────────────

/** Subscribe to `file.edited` events. Returns an unsubscribe function. */
export function onFileEdited(listener: FileEditedListener): () => void {
  editedListeners.add(listener);
  return () => { editedListeners.delete(listener); };
}

/** Subscribe to `file.changed` events. Returns an unsubscribe function. */
export function onFileChanged(listener: FileWatcherListener): () => void {
  watcherListeners.add(listener);
  return () => { watcherListeners.delete(listener); };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/** Remove all listeners from both channels. Useful for testing and shutdown. */
export function removeAllFileEventListeners(): void {
  editedListeners.clear();
  watcherListeners.clear();
}
