/**
 * Core type definitions for AI Team system
 * Barrel export for concern-oriented type modules.
 */

export type { Right, Effect, PermissionRule } from './rights.js';
export { ALL_RIGHTS } from './rights.js';

export type { PermissionDescriptor } from './tool-types.js';
export * from './tool-results.js';
export * from './command-types.js';
export * from './command-registry.js';
export * from './access.js';

export * from './taxonomy.js';
export * from './schemas.js';
export * from './agent-models.js';
export * from './communication.js';
export * from './tasks.js';
export * from './planning.js';
export * from './graph.js';
export * from './runtime-contracts.js';
export * from './interaction-services.js';
export * from './platform-services.js';
export * from './logging.js';
export * from './errors.js';
export * from './ide.js';
export * from './tool-tokens.js';
export * from './core-service-tokens.js';
export * from './cli.js';
