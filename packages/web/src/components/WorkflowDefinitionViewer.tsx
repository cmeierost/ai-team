import { useMemo, useState } from 'react';
import { WorkflowGraphView } from './workflow-graph/WorkflowGraphView';
import {
  buildWorkflowCallFlowMermaid,
  computeWorkflowCallFlow,
  isErrorCallFlowEntry,
} from './workflow-graph/workflowCallGraphFlow';
import { WorkflowMermaidView } from './WorkflowMermaidView';
import { useWorkflowDefinition } from '../hooks/useWorkflowDefinition';
import './WorkflowDefinitionViewer.css';

const DEFAULT_WORKFLOW_ID = 'chat-full-loop';
const KNOWN_WORKFLOW_IDS = ['chat-full-loop', 'chat-send-turn'] as const;
type WorkflowViewerTab = 'yaml' | 'graph' | 'mermaid';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Failed to load workflow definition.';
}

function formatBranches(branches: Array<{ event: string; count: number }>): string {
  if (branches.length === 0) {
    return '—';
  }

  return branches.map((branch) => `${branch.event} (${branch.count})`).join(', ');
}

export function WorkflowDefinitionViewer() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(DEFAULT_WORKFLOW_ID);
  const [activeTab, setActiveTab] = useState<WorkflowViewerTab>('yaml');

  const { workflowDefinition, workflowDefinitionLoading, workflowDefinitionError } =
    useWorkflowDefinition(selectedWorkflowId);

  const transitionCount = useMemo(() => {
    if (!workflowDefinition) {
      return 0;
    }

    return Object.values(workflowDefinition.definitionJson.states).reduce(
      (total, state) => total + state.transitions.length,
      0
    );
  }, [workflowDefinition]);

  const allCallFlowEntries = useMemo(() => {
    if (!workflowDefinition) {
      return [];
    }

    return computeWorkflowCallFlow(workflowDefinition.definitionJson);
  }, [workflowDefinition]);

  const callFlowEntries = useMemo(
    () => allCallFlowEntries.filter((entry) => !isErrorCallFlowEntry(entry)),
    [allCallFlowEntries]
  );

  const mermaidDefinition = useMemo(() => {
    if (!workflowDefinition) {
      return '';
    }

    return buildWorkflowCallFlowMermaid(workflowDefinition.definitionJson, {
      includeErrorPaths: false,
    });
  }, [workflowDefinition]);

  const formatFailureSummary = (failureEvents: Array<{ event: string; count: number }>) => {
    return failureEvents.length > 0 ? 'hidden (error handler exists)' : '—';
  };

  const handleCopyYaml = async () => {
    if (!workflowDefinition?.definitionYaml) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(workflowDefinition.definitionYaml);
      }
    } catch {
      // no-op; YAML is still visible even if clipboard fails
    }
  };

  const handleCopyMermaid = async () => {
    if (!mermaidDefinition) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mermaidDefinition);
      }
    } catch {
      // no-op; Mermaid source remains visible
    }
  };

  return (
    <div className="workflow-definition-viewer">
      <div className="workflow-definition-form">
        <label className="workflow-definition-field" htmlFor="workflow-definition-id">
          Workflow ID
        </label>
        <div className="workflow-definition-field-row">
          <select
            id="workflow-definition-id"
            className="workflow-definition-input workflow-definition-select"
            aria-label="Workflow ID"
            value={selectedWorkflowId}
            onChange={(event) => setSelectedWorkflowId(event.target.value)}
          >
            {KNOWN_WORKFLOW_IDS.map((workflowId) => (
              <option key={workflowId} value={workflowId}>
                {workflowId}
              </option>
            ))}
          </select>
        </div>
      </div>

      {workflowDefinitionError ? (
        <div className="workflow-definition-error">
          {extractErrorMessage(workflowDefinitionError)}
        </div>
      ) : null}

      {workflowDefinitionLoading ? (
        <div className="workflow-definition-loading">Loading workflow definition…</div>
      ) : null}

      {workflowDefinition ? (
        <>
          <div className="workflow-definition-summary" role="status" aria-live="polite">
            <span>
              Workflow: <code>{workflowDefinition.workflowId}</code>
            </span>
            <span>{Object.keys(workflowDefinition.definitionJson.states).length} states</span>
            <span>{transitionCount} transitions</span>
          </div>

          <div
            className="workflow-definition-tabs"
            role="tablist"
            aria-label="Workflow viewer tabs"
          >
            <button
              role="tab"
              type="button"
              aria-selected={activeTab === 'yaml'}
              className={`workflow-definition-tab ${activeTab === 'yaml' ? 'workflow-definition-tab-active' : ''}`}
              onClick={() => setActiveTab('yaml')}
            >
              YAML
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={activeTab === 'graph'}
              className={`workflow-definition-tab ${activeTab === 'graph' ? 'workflow-definition-tab-active' : ''}`}
              onClick={() => setActiveTab('graph')}
            >
              Graph
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={activeTab === 'mermaid'}
              className={`workflow-definition-tab ${activeTab === 'mermaid' ? 'workflow-definition-tab-active' : ''}`}
              onClick={() => setActiveTab('mermaid')}
            >
              Mermaid
            </button>
          </div>

          {activeTab === 'yaml' ? (
            <section
              className="workflow-definition-yaml-section"
              aria-label="Workflow YAML definition"
            >
              <div className="workflow-definition-yaml-header">
                <h2 className="workflow-definition-yaml-title">YAML</h2>
                <button
                  className="workflow-definition-button workflow-definition-button-secondary"
                  type="button"
                  onClick={() => {
                    void handleCopyYaml();
                  }}
                >
                  Copy YAML
                </button>
              </div>
              <pre className="workflow-definition-yaml-block">
                <code>{workflowDefinition.definitionYaml}</code>
              </pre>
            </section>
          ) : null}

          {activeTab === 'graph' ? (
            <>
              <section className="workflow-definition-calls" aria-label="Workflow calls overview">
                <h2 className="workflow-definition-calls-title">Call flow only</h2>
                <p className="workflow-definition-calls-description">
                  Showing only invoked states. Error paths are hidden for a cleaner primary flow.
                </p>

                {callFlowEntries.length === 0 ? (
                  <p className="workflow-definition-calls-empty">
                    No invoked steps found in this workflow.
                  </p>
                ) : (
                  <ol className="workflow-definition-order-list">
                    {callFlowEntries.map((entry) => (
                      <li
                        key={`call-order-${entry.stateId}`}
                        className="workflow-definition-order-item"
                      >
                        <span className="workflow-definition-order-index">{entry.order}</span>
                        <span className="workflow-definition-order-state">{entry.stateId}</span>
                        <span className="workflow-definition-calls-arrow">→</span>
                        <code className="workflow-definition-calls-src">{entry.invokeSrc}</code>
                        <div className="workflow-definition-calls-detail-lines">
                          <span className="workflow-definition-calls-detail-line">
                            <strong>before:</strong> {formatBranches(entry.beforeEvents)}
                          </span>
                          <span className="workflow-definition-calls-detail-line">
                            <strong>after:</strong> {formatBranches(entry.afterEvents)}
                          </span>
                          <span className="workflow-definition-calls-detail-line">
                            <strong>failure:</strong> {formatFailureSummary(entry.failureEvents)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                <h3 className="workflow-definition-calls-subtitle">Execution order</h3>
                <ul className="workflow-definition-calls-list">
                  {callFlowEntries.map((entry) => (
                    <li
                      key={`${entry.stateId}-${entry.invokeSrc}`}
                      className="workflow-definition-calls-item"
                    >
                      <span className="workflow-definition-order-index">{entry.order}</span>
                      <span className="workflow-definition-calls-state">{entry.stateId}</span>
                      <span className="workflow-definition-calls-arrow">→</span>
                      <code className="workflow-definition-calls-src">{entry.invokeSrc}</code>
                    </li>
                  ))}
                </ul>
              </section>

              <WorkflowGraphView
                definition={workflowDefinition.definitionJson}
                className="workflow-definition-graph"
                includeErrorPaths={false}
              />
            </>
          ) : null}

          {activeTab === 'mermaid' ? (
            <section
              className="workflow-definition-mermaid-section"
              aria-label="Workflow Mermaid definition"
            >
              <div className="workflow-definition-mermaid-header">
                <h2 className="workflow-definition-mermaid-title">Mermaid (call-flow only)</h2>
                <button
                  className="workflow-definition-button workflow-definition-button-secondary"
                  type="button"
                  onClick={() => {
                    void handleCopyMermaid();
                  }}
                >
                  Copy Mermaid
                </button>
              </div>
              <p className="workflow-definition-mermaid-description">
                Deterministic fallback for cleaner directional diagrams and less crossing noise.
                Error paths are hidden for readability.
              </p>
              <WorkflowMermaidView definition={mermaidDefinition} />
              <pre className="workflow-definition-mermaid-block">
                <code>{mermaidDefinition}</code>
              </pre>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
