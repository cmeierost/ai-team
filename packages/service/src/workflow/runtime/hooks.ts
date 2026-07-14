import type { WorkflowFrame } from '@ai-team/api-contracts';

/**
 * Workflow-specific callbacks for runtime events.
 *
 * Only contains callbacks for workflow frame events. All other concerns
 * (questions, services) are handled via DI container.
 */
export interface WorkflowCallbacks {
  /** Callback for workflow frame events */
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}
