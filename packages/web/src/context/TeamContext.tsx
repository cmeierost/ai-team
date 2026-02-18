import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Agent } from '../types';

const API_BASE = 'http://localhost:3002/api';

interface TeamContextValue {
  agents: Agent[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/agents`);
      if (!response.ok) {
        throw new Error(`Failed to load agents: ${response.statusText}`);
      }
      const loadedAgents = await response.json();
      setAgents(loadedAgents);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load agents'));
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
        loading,
        error,
        refresh,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}
