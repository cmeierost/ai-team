/**
 * Re-export barrel — implementation lives in the orchestrator layer so that
 * NL forward detection is available to all callers (CLI, VS Code, API server).
 *
 * @see ../../orchestrator/forward-detection.ts
 */
export { detectForwardRequestWithFallback, REFERENCE_PRONOUNS } from '../../orchestrator/forward-detection.js';
