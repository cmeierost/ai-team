import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

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
  toolRawChars: number;
  toolSavedChars: number;
  compactedToolCallCount: number;
  archived: boolean;
}

export interface ContextSessionSkill {
  name: string;
  skillPath: string;
  chars: number;
  paused: boolean;
  isSessionSkill: boolean;
}

export interface ContextEstimateTool {
  name: string;
  description: string;
  chars: number;
}

export interface ContextEstimateNote {
  id: string;
  title: string;
  sessionId?: string;
  preview: string;
  chars: number;
  source: 'compacted' | 'content';
}

export interface ContextEstimatePlan {
  id: string;
  title: string;
  chars: number;
}

export interface ContextEstimateTask {
  id: string;
  title: string;
  chars: number;
  status?: string;
}

export interface ContextEstimateTodo {
  id: string;
  content: string;
  chars: number;
  done: boolean;
}

export interface ContextEstimateResponse {
  agentId: string;
  sessionId?: string;
  segments: ContextSegment[];
  totalChars: number;
  instructionFiles: ContextInstructionFile[];
  messages: ContextMessage[];
  notes: ContextEstimateNote[];
  plans: ContextEstimatePlan[];
  tasks: ContextEstimateTask[];
  todos: ContextEstimateTodo[];
  sessionSkills: ContextSessionSkill[];
  tools: ContextEstimateTool[];
}

export function useContextEstimate(agentId: string | undefined, sessionId?: string) {
  const { client } = useTeam();
  return useQuery<ContextEstimateResponse>({
    queryKey: contextPanelQueryKeys.contextEstimate(agentId!, sessionId),
    queryFn: () => {
      console.debug('[useContextEstimate] fetching', { agentId, sessionId });
      if (sessionId) {
        return client.context.getContextEstimateForSession(
          agentId!,
          sessionId
        ) as Promise<ContextEstimateResponse>;
      }

      return client.context.getContextEstimate(agentId!) as Promise<ContextEstimateResponse>;
    },
    enabled: !!agentId,
    staleTime: 15_000,
  });
}
