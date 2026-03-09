---
name: workspace-file-system-abstraction
description: 'Use when working on file trees, workspace scanning, glob matching, gitignore-aware behavior, path permissions, file watchers, or cache invalidation in the backend runtime.'
---

# Workspace file system abstraction

Use this skill when the task touches how the backend understands, filters, watches, or authorizes access to workspace files.

Typical triggers:

- file tree output is wrong
- gitignore handling behaves strangely
- path permissions need adjustment
- workspace scanning is too slow or too broad
- file watchers or cache invalidation are stale
- Windows path normalization bugs appear

## Focus areas

- `packages/core/src/storage/file-tree.ts`
- `packages/core/src/storage/file-tree-cache.ts`
- `packages/core/src/context/index.ts`
- `packages/core/src/tools/index.ts`

## Workflow

1. Confirm whether the problem is discovery, filtering, permission matching, or watch invalidation.
2. Normalize and compare paths carefully across platforms before changing matching logic.
3. Keep file access policy separate from higher-level agent behavior.
4. Validate with realistic workspace paths, hidden files, ignored files, and nested directories.

## Guardrails

- do not bypass permission checks for convenience
- do not hardcode platform-specific path assumptions
- keep glob and minimatch behavior explicit
- prefer targeted invalidation over clearing everything unless correctness requires it

## Successful outcome

- workspace file operations become predictable and cross-platform safe
- gitignore and allow-path behavior stay understandable
- file tree and cache behavior are correct without overcomplication
