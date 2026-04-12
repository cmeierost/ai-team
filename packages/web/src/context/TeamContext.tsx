import { createContext, useContext, useMemo, useState, useEffect, ReactNode } from 'react';
import { createAiTeamClient, type AiTeamHttpClient } from '@ai-team/api-client';
import { Agent, GraphData, Developer } from '../types';

// Use window.location.origin in production, or default to localhost in dev
export const API_BASE =
  window.location.hostname === 'localhost' ? 'http://localhost:3002' : window.location.origin;

interface TeamContextValue {
  agents: Agent[];
  graphData: GraphData | null;
  developer: Developer | null;
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
  initialAgents?: Agent[];
  initialLoading?: boolean;
  initialError?: Error | null;
}

export function TeamProvider({
  children,
  initialAgents,
  initialLoading = false,
  initialError = null,
}: TeamProviderProps) {
  const client = useMemo(() => createAiTeamClient({ baseUrl: API_BASE }), []);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [agents, setAgents] = useState<Agent[]>(initialAgents || []);
  const [developer, setDeveloper] = useState<Developer | null>(null);
  const [loading, setLoading] = useState(initialLoading || initialAgents === undefined);
  const [error, setError] = useState<Error | null>(initialError);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load team graph with resolved role references
      const loadedGraphData = (await client.team.getTeamGraph('hierarchy')) as GraphData;
      setGraphData(loadedGraphData);

      // Load agents from dedicated endpoint (includes resolvedLlm)
      try {
        const agentsData = (await client.agents.list()) as Agent[];
        setAgents(agentsData);
      } catch {
        // Fallback: derive from graph nodes
        const agentNodes = loadedGraphData.nodes
          .filter((node) => node.type === 'agent' && node.data.agent)
          .map((node) => node.data.agent!);
        setAgents(agentNodes);
      }

      // Load developer profile
      try {
        const response = (await client.developer.getMe()) as Developer;
        setDeveloper(response);
      } catch (err) {
        console.warn('Failed to load developer profile:', err);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load team data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialAgents) {
      refresh();
    }
  }, [initialAgents]);

  return (
    <TeamContext.Provider
      value={{
        agents,
        graphData,
        developer,
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
