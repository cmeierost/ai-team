import { describe, it, expect, beforeEach } from 'vitest';
import {
  emitFileEdited,
  emitFileCreated,
  emitFileWatcherEvent,
  onFileEdited,
  onFileChanged,
  removeAllFileEventListeners,
} from './file-events.js';

beforeEach(() => {
  removeAllFileEventListeners();
});

describe('file.edited channel', () => {
  it('delivers events to subscribers', () => {
    const received: Array<{ filePath: string; created: boolean }> = [];
    onFileEdited((e) => received.push(e));
    emitFileEdited('/a.ts');
    expect(received).toEqual([{ filePath: '/a.ts', created: false }]);
  });

  it('delivers created events with created: true', () => {
    const received: Array<{ filePath: string; created: boolean }> = [];
    onFileEdited((e) => received.push(e));
    emitFileCreated('/b.ts');
    expect(received).toEqual([{ filePath: '/b.ts', created: true }]);
  });

  it('supports multiple listeners', () => {
    let count = 0;
    onFileEdited(() => count++);
    onFileEdited(() => count++);
    emitFileEdited('/c.ts');
    expect(count).toBe(2);
  });

  it('unsubscribe stops delivery', () => {
    let count = 0;
    const unsub = onFileEdited(() => count++);
    emitFileEdited('/d.ts');
    expect(count).toBe(1);
    unsub();
    emitFileEdited('/e.ts');
    expect(count).toBe(1);
  });

  it('does not deliver to file.changed listeners', () => {
    let watcherHit = false;
    onFileChanged(() => { watcherHit = true; });
    emitFileEdited('/f.ts');
    expect(watcherHit).toBe(false);
  });

  it('swallows listener errors without affecting other listeners', () => {
    const received: string[] = [];
    onFileEdited(() => { throw new Error('boom'); });
    onFileEdited((e) => received.push(e.filePath));
    emitFileEdited('/g.ts');
    expect(received).toEqual(['/g.ts']);
  });
});

describe('file.changed channel', () => {
  it('delivers watcher events', () => {
    const received: Array<{ filePath: string; kind: string }> = [];
    onFileChanged((e) => received.push(e));
    emitFileWatcherEvent('/x.ts', 'change');
    expect(received).toEqual([{ filePath: '/x.ts', kind: 'change' }]);
  });

  it('does not deliver to file.edited listeners', () => {
    let editedHit = false;
    onFileEdited(() => { editedHit = true; });
    emitFileWatcherEvent('/y.ts', 'add');
    expect(editedHit).toBe(false);
  });
});

describe('removeAllFileEventListeners', () => {
  it('clears both channels', () => {
    let editedCount = 0;
    let watcherCount = 0;
    onFileEdited(() => editedCount++);
    onFileChanged(() => watcherCount++);
    removeAllFileEventListeners();
    emitFileEdited('/z.ts');
    emitFileWatcherEvent('/z.ts', 'change');
    expect(editedCount).toBe(0);
    expect(watcherCount).toBe(0);
  });
});
