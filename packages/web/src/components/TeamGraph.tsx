import { useNavigate } from 'react-router-dom';
import '@xyflow/react/dist/style.css';
import { useTeam } from '../context/TeamContext';
import { TeamGraphView } from './team-graph/TeamGraphView';
import './TeamGraph.css';

export function TeamGraph() {
  const navigate = useNavigate();
  const { graphData, loading, error } = useTeam();

  if (loading) {
    return <div className="loading">Loading organization...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>No employees found.</p>
        <p>Run <code>ai-team init</code> to set up your team.</p>
      </div>
    );
  }

  return (
    <TeamGraphView graphData={graphData} onNodeSelect={(nodeId) => navigate(`/portfolio/${nodeId}`)} />
  );
}
