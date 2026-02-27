import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createHttpAiTeamClient, type AiTeamHttpClient } from '@ai-team/api-client-http';
import { Agent, GraphData } from '../types';

// Use window.location.origin in production, or default to localhost in dev
const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:3002'
  : window.location.origin;
const client = createHttpAiTeamClient({ baseUrl: API_BASE });

// Export API_BASE for use in other components
export { API_BASE };

interface TeamContextValue {
  agents: Agent[];
  graphData: GraphData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  client: AiTeamHttpClient;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function useTeam() {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within TeamProvider');
  }
  return context;
}

interface TeamProviderProps {
  children: ReactNode;
}

export function TeamProvider({ children }: TeamProviderProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load team graph with resolved role references
      const loadedGraphData = await client.getTeamGraph('hierarchy');
      setGraphData(loadedGraphData);
      
      // Derive agents array from graph nodes for backward compatibility
      const agentNodes = loadedGraphData.nodes
        .filter(node => node.type === 'agent' && node.data.agent)
        .map(node => node.data.agent!);
      setAgents(agentNodes);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load team data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <TeamContext.Provider
      value={{
        agents,
        graphData,
        loading,
        error,
        refresh,
        client,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}
