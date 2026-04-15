/**
 * Shared session and chat types.
 * These are browser-safe (no Node.js-specific imports) and are used by
 * both the contract router and the HTTP client.
 */

export interface ChatSummary {
  id: string;
  title: string;
  content: string;
  sourceMessages: {
    agentId: string;
    messageIndices: number[];
  };
  timestamp: string;
  tags?: string[];
}

export interface ChatMessage {
  from: string;
  to?: string;
  isHuman?: boolean;
  content: string;
  timestamp: string;
  archived?: boolean;
  handoffType?: 'user-acknowledgment' | 'agent-briefing';
  targetAgentId?: string;
  handoffId?: string;
  handoffFromSessionId?: string;
  handoffToSessionId?: string;
}

export interface SessionToolDenial {
  kind: 'user-denied' | 'policy-denied' | 'execution-failed';
  reasonCode: string;
  message: string;
  blockedPaths?: string[];
  alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
  handoffRecommendation?: {
    possible: boolean;
    requiresUserApproval: true;
    contexts: Array<{ contextId: string; allowedPaths: string[] }>;
  };
}

export interface SessionToolResult {
  toolName: string;
  outcome: 'result' | 'error' | 'denied';
  request?: unknown;
  result?: unknown;
  resultLlm?: unknown;
  denial?: SessionToolDenial;
}

export interface SessionActivatedTool {
  toolName: string;
  toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
  message?: string;
  toolResult?: SessionToolResult;
  toolDenial?: SessionToolDenial;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  agentId: string;
  agentIds?: string[];
  developerId: string;
  title?: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  artifacts: string[];
  allowedFiles: string[];
  notes?: string;
  activatedTools?: SessionActivatedTool[];
  previousSessionId?: string;
  mergedFromSessionIds?: string[] | null;
  messages?: ChatMessage[];
}

export interface HandoffEdge {
  handoffId: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  fromAgentIds: string[];
  toAgentIds: string[];
}

export interface SessionNode {
  sessionId: string;
  agentIds: string[];
  agentNames: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

export interface SessionThread {
  rootSessionId: string;
  currentSessionId: string;
  depth: number;
  handoffs: HandoffEdge[];
  sessions: SessionNode[];
}

export interface MessageStats {
  total: number;
  archived: number;
  active: number;
  byAgent: Record<string, number>;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}
