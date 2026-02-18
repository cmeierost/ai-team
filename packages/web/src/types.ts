// Browser-safe types (subset of @ai-team/core types)
// DO NOT import @ai-team/core - it uses Node.js APIs

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';

export interface Agent {
  id: string;
  name: string;
  role: string;
  reportsTo?: string;
  features?: string[];
  specializations?: string[];
  status?: 'available' | 'busy' | 'in-meeting' | 'offline';
  markdown?: string;  // Portfolio/bio content
}

export interface ChatMessage {
  from: string; // 'human' or agent ID
  content: string;
  timestamp: string;
}
