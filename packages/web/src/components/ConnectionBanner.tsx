import { useQueryClient } from '@tanstack/react-query';
import { useBackendConnectionStore } from '../stores/backendConnectionStore';
import { useTeam } from '../context/TeamContext';
import './ConnectionBanner.css';

export function ConnectionBanner() {
  const isReachable = useBackendConnectionStore((state) => state.isReachable);
  const queryClient = useQueryClient();
  const { refresh } = useTeam();

  if (isReachable) return null;

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span className="connection-banner__message">
        <strong>Server Unreachable:</strong> Unable to connect to the backend server.
      </span>
      <button
        onClick={() => {
          queryClient.refetchQueries();
          refresh();
        }}
        className="connection-banner__retry"
      >
        Retry Connection
      </button>
    </div>
  );
}
