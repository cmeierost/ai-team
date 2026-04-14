import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';

export interface ContextSegment {
  label: string;
  key: string;
  chars: number;
}

export interface ContextInstructionFile {
  path: string;
  label: string;
  chars: number;
}

export interface ContextMessage {
  role: 'user' | 'assistant';
  preview: string;
  chars: number;
  toolCallCount: number;
  toolChars: number;
  archived: boolean;
}

export interface ContextSessionSkill {
  name: string;
  skillPath: string;
  chars: number;
  paused: boolean;
  isSessionSkill: boolean;
}

export interface ContextEstimateResponse {
  agentId: string;
  sessionId?: string;
  segments: ContextSegment[];
  totalChars: number;
  instructionFiles: ContextInstructionFile[];
  messages: ContextMessage[];
  sessionSkills: ContextSessionSkill[];
}

export function useContextEstimate(agentId: string | undefined, sessionId?: string) {
  const { client } = useTeam();
  return useQuery<ContextEstimateResponse>({
    queryKey: ['meta', 'context-estimate', agentId, sessionId],
    queryFn: () =>
      client.context.getContextEstimate(
        agentId!,
        sessionId ? { sessionId } : undefined
      ) as Promise<ContextEstimateResponse>,
    enabled: !!agentId,
    staleTime: 15_000,
  });
}
