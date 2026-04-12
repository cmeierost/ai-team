export enum RoleType {
  EXECUTIVE = 'executive',
  LEADERSHIP = 'leadership',
  TEAM_LEAD = 'team-lead',
  INDIVIDUAL_CONTRIBUTOR = 'individual-contributor',
  QUALITY_GATE = 'quality-gate',
  CROSS_CONCERN = 'cross-concern',
  PRODUCT = 'product',
}

export enum ContextLevel {
  TASK = 'task',
  MODULE = 'module',
  FEATURE = 'feature',
  REPOSITORY = 'repository',
  ORGANIZATION = 'organization',
}

export enum AgentStatus {
  AVAILABLE = 'available',
  BUSY = 'busy',
  IN_MEETING = 'in-meeting',
  OFFLINE = 'offline',
}

export enum EdgeType {
  REPORTS_TO = 'reports-to',
  REPORTS_TO_UNRESOLVED = 'reports-to-unresolved',
  MANAGES = 'manages',
  OWNS_FEATURE = 'owns-feature',
  CONTRIBUTES_TO = 'contributes-to',
  CONSULTS_ON = 'consults-on',
  SHARES_CONTEXT = 'shares-context',
}

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';
