/**
 * @ai-team/core - Public API exports
 * 
 * This is the main entry point for the core library.
 * All types, classes, and functions are exported from here.
 */

// Type definitions and schemas
export * from './types/index.js';
export { withAbortSignal, isAbortError } from './utils/async.js';

// Core modules
export * from './agent/index.js';
export * from './skill/index.js';
export * from './team/index.js';
export * from './context/index.js';
export * from './context/access-adapter.js';
export * from './chat/index.js';
export * from './tools/index.js';
export {
	FS_TREE_PRE_LLM_PATTERNS,
	matchesFsTreePreLlmIntent,
} from './tools/fs-tools.js';
export * from './tools/tool-descriptors.js';
export * from './storage/index.js';
export * from './llm/index.js';
export * from './command-catalog/index.js';
export * from './code-analysis/index.js';
export * from './code-edit/index.js';

// Avatar module
export * from './avatar/index.js';

// Watcher module (to be implemented)
// export * from './watcher/index.js';
