export const contextPanelQueryKeys = {
  all: ['context-panel'] as const,
  sessionsRoot: ['context-panel', 'sessions'] as const,
  artifacts: () => ['context-panel', 'artifacts'] as const,
  sessions: (agentId: string) => ['context-panel', 'sessions', agentId] as const,
  tasks: (agentId: string) => ['context-panel', 'tasks', agentId] as const,
  skills: (agentId: string) => ['context-panel', 'skills', agentId] as const,
};