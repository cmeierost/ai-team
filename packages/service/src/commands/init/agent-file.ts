import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAgentMarkdown, loadAgent, saveAgent } from '@ai-team/infrastructure';
import type { Agent, ContextLevel, RoleType } from '@ai-team/infrastructure';

export interface AgentSeed {
  name: string;
  role: string;
  type: string;
  contextLevel: string;
  reportsTo?: string;
  personality?: { communication_style?: string; expertise_level?: string; mentoring?: boolean };
  specializations?: string[];
  tools?: string[];
  introduction: string;
  personalityProfile: string[];
}

function normalizeRoleId(role: string): string {
  return role.trim().toLowerCase();
}

function shouldGrantManageAgentsByDefault(seed: AgentSeed): boolean {
  if (seed.type !== 'executive') {
    return false;
  }

  const role = normalizeRoleId(seed.role);
  return role === 'ceo' || role === 'hr-director';
}

export async function createAgentFile(workspaceRoot: string, seed: AgentSeed): Promise<Agent> {
  const id = seed.name.toLowerCase().replaceAll(/\s+/g, '-');
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  const filePath = path.join(aiTeamDir, 'agents', `${id}.agent.md`);

  const permissions = seed.type === 'executive'
    ? {
        read: ['**/*'],
        write: ['.ai-team/**/*', 'docs/**/*'],
        create: [],
        delete: [],
        ...(shouldGrantManageAgentsByDefault(seed) ? { manage_agents: true } : {}),
      }
    : { read: ['.ai-team/**/*'], write: ['.ai-team/**/*'], create: [], delete: [] };

  const markdown = buildAgentMarkdown({
    introduction: seed.introduction,
    personalityProfile: seed.personalityProfile,
  });

  const agent: Agent = {
    id,
    filePath,
    skillPath: path.join(workspaceRoot, '.ai-team', 'roles', `${seed.role}.md`),
    createdAt: new Date().toISOString(),
    name: seed.name,
    role: seed.role,
    type: seed.type as RoleType,
    contextLevel: seed.contextLevel as ContextLevel,
    ...(seed.reportsTo ? { reportsTo: seed.reportsTo } : {}),
    ...(seed.specializations ? { specializations: seed.specializations } : {}),
    permissions,
    personality: seed.personality as Agent['personality'],
    avatar: {
      type: 'ai-generated' as const,
      style: 'professional-headshot',
      seed: id,
    },
    markdown,
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await saveAgent(agent);

  return loadAgent(filePath);
}
