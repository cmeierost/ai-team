/**
 * Re-export barrel — implementation lives in src/utils/agent-selection.ts so
 * any service caller (orchestrator, CLI, VS Code, API) can use it.
 *
 * @see ../../utils/agent-selection.ts
 */
export { selectDefaultTopAgent, formatUserPrompt, resolveDeveloperName } from '../../utils/agent-selection.js';
