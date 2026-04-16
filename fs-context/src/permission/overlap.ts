import type { ContextOverlap, ResolvedContext } from './types.js';

export function analyzeContextOverlap(
  a: ResolvedContext,
  b: ResolvedContext,
): ContextOverlap {
  const sharedList = new Set<string>();
  const sharedRead = new Set<string>();
  const sharedWrite = new Set<string>();

  for (const f of a.list) {
    if (b.list.has(f)) sharedList.add(f);
  }
  for (const f of a.read) {
    if (b.read.has(f)) sharedRead.add(f);
  }
  for (const f of a.write) {
    if (b.write.has(f)) sharedWrite.add(f);
  }

  const listOnly = new Set<string>();
  for (const f of sharedList) {
    if (!sharedRead.has(f)) listOnly.add(f);
  }

  const readOnly = new Set<string>();
  for (const f of sharedRead) {
    if (!sharedWrite.has(f)) readOnly.add(f);
  }

  return {
    listOnly,
    readOnly,
    shared: {
      list: sharedList,
      read: sharedRead,
      write: sharedWrite,
    },
  };
}
