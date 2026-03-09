import { useEffect, useState } from 'react';
import { useTeam } from '../context/TeamContext';
import { SessionThread } from '../types';
import { SessionGraphView } from './session-graph/SessionGraphView';
import './SessionGraph.css';

interface SessionGraphProps {
  thread: SessionThread;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void;
}

export function SessionGraph({ thread, activeSessionId, onSelectSession }: Readonly<SessionGraphProps>) {
  const { agents } = useTeam();

  return <SessionGraphView thread={thread} agents={agents} activeSessionId={activeSessionId} onSelectSession={onSelectSession} />;
}

// --- SessionGraphLoader ---

interface SessionGraphLoaderProps {
  sessionId: string;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void;
}

export function SessionGraphLoader({ sessionId, activeSessionId, onSelectSession }: Readonly<SessionGraphLoaderProps>) {
  const { client } = useTeam();
  const [thread, setThread] = useState<SessionThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingThread(true);
    setThreadError(null);
    client
      .getSessionThread(sessionId)
      .then((data) => { if (!cancelled) setThread(data); })
      .catch((err: Error) => { if (!cancelled) setThreadError(err.message); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    return () => { cancelled = true; };
  }, [sessionId, client]);

  if (loadingThread) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text">Loading session thread&hellip;</div>
      </div>
    );
  }
  if (threadError || !thread) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text session-graph-state-error">
          Failed to load session thread{threadError ? `: ${threadError}` : ''}
        </div>
      </div>
    );
  }
  if (thread.sessions.length === 0) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text">No sessions found in this thread.</div>
      </div>
    );
  }
  return (
    <SessionGraph
      thread={thread}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
    />
  );
}
