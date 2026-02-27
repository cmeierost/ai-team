// Browser-safe types (subset of @ai-team/core types)
// DO NOT import @ai-team/core - it uses Node.js APIs

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';

export interface AvatarConfig {
  type?: 'url' | 'ai-generated' | 'initials';
  url?: string;
  style?: 'professional-headshot' | 'avatar' | 'illustrated';
  seed?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  reportsTo?: string;
  features?: string[];
  specializations?: string[];
  status?: 'available' | 'busy' | 'in-meeting' | 'offline';
  markdown?: string;  // Portfolio/bio content
  avatar?: AvatarConfig;
}

export type EdgeType =
  | 'reports-to'
  | 'reports-to-unresolved'
  | 'manages'
  | 'owns-feature'
  | 'contributes-to'
  | 'consults-on'
  | 'shares-context';

export interface GraphNode {
  id: string;
  type: 'agent' | 'feature';
  data: {
    label: string;
    agent?: Agent;
    feature?: any;
    role?: string;
    status?: Agent['status'];
  };
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  error?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ChatMessage {
  from: string; // Agent ID or developer ID (e.g., 'clemens-meier')
  to?: string; // Target agent ID (used for handoff messages)
  isHuman?: boolean; // True if message is from human developer
  content: string;
  timestamp: string;
  archived?: boolean;
}

export interface ChatSession {
  id: string;  // e.g., 'session-2026-02-27-abc123'
  agentId: string;
  developerId: string;  // e.g., 'clemens-meier'
  startedAt: string;  // ISO timestamp
  lastActivityAt: string;  // ISO timestamp
  messageCount: number;
  artifacts: string[];  // Artifact IDs or paths in context
  allowedFiles: string[];  // Files agent can access in this session
}

export interface Artifact {
  id: string;  // e.g., 'brief-user-auth-design'
  type: 'brief' | 'summary' | 'record' | 'document';
  title: string;
  content: string;  // Markdown content
  createdAt: string;
  createdBy: string;  // developer ID
  sourceSessionId: string;  // Session where it was created
  fromMessageIndex: number;  // Start of summarized range
  toMessageIndex: number;  // End of summarized range
  filepath: string;  // .ai-team/artifacts/briefs/{filename}.md
  tags?: string[];
}
