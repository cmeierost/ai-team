import type { WorkflowDefinitionDocument } from '@ai-team/api-contracts';

export interface WorkflowDefinitionResolver {
  format: 'workflow/v1';
  getJson: () => WorkflowDefinitionDocument;
  getYaml: () => string;
}

// Legacy send-turn-machine workflow removed - use ChatRuntime with XState-based WorkflowRunner
const _primaryResolvers: Record<string, never> = {};

export function getWorkflowDefinitionResolvers(): Record<string, WorkflowDefinitionResolver> {
  return {};
}

export function listWorkflowDefinitionIds(): string[] {
  return [];
}
