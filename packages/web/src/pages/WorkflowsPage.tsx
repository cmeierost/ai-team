import { WorkflowDefinitionViewer } from '../components/WorkflowDefinitionViewer';
import './WorkflowsPage.css';

export function WorkflowsPage() {
  return (
    <div className="workflows-page">
      <div className="workflows-page-header">
        <h1>Workflows</h1>
        <p className="workflows-page-subtitle">
          Inspect runtime workflow definitions as an interactive graph.
        </p>
      </div>

      <WorkflowDefinitionViewer />
    </div>
  );
}
