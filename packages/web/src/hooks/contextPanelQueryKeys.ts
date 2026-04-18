export const contextPanelQueryKeys = {
  all: ['context-panel'] as const,
  sessionsRoot: ['context-panel', 'sessions'] as const,
  recentSessions: (limit: number) => ['context-panel', 'sessions', 'recent', limit] as const,
  artifacts: () => ['context-panel', 'artifacts'] as const,
  sessions: (agentId: string) => ['context-panel', 'sessions', agentId] as const,
  notes: (sessionId: string) => ['context-panel', 'notes', sessionId] as const,
  threadNotes: (sessionId: string) => ['context-panel', 'thread-notes', sessionId] as const,
  tasks: (agentId: string) => ['context-panel', 'tasks', agentId] as const,
  skills: (agentId: string) => ['context-panel', 'skills', agentId] as const,
  permissionAnalysis: () => ['context-panel', 'permissions-analysis'] as const,
  agentOverlap: (agentId: string) =>
    ['context-panel', 'permissions-analysis', 'agent', agentId] as const,
  contextEstimate: (agentId: string, sessionId?: string) =>
    ['meta', 'context-estimate', agentId, sessionId] as const,
  planningIntake: (status?: string) => ['planning', 'intake', status] as const,
  planningPlans: (status?: string) => ['planning', 'plans', status] as const,
  planningPlan: (planId: string) => ['planning', 'plan', planId] as const,
  workflowDefinition: (workflowId: string) => ['workflow', 'definition', workflowId] as const,
};
