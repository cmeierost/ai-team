import type { Agent, Skill } from '@ai-team/core';
import { parseMarkdownSections, replaceOrAppendMarkdownSection } from '@ai-team/core';
import {
  type SearchSkillsOptions,
  type SearchSkillsResponse,
  type UpdateAgentSkillOptions,
  type UpdateAgentSkillResponse,
} from '../contracts.js';
import { createContainer, TOKENS } from '../container/index.js';
import { resolveAgentForOperation } from '../utils/agent-resolution.js';

const SKILLS_LINE_RE = /^\*\*Skills:\*\*.*$/gm;

/**
 * Sync the `**Skills:** id · id` line inside the "Scope of Responsibility"
 * markdown section to match the given skill list.
 * When `skills` is empty the line is removed entirely.
 */
function syncSkillsLineInMarkdown(markdown: string, skills: string[]): string {
  const sections = parseMarkdownSections(markdown);
  const scopeIdx = sections.findIndex(s => s.heading === 'Scope of Responsibility');
  if (scopeIdx < 0 && skills.length === 0) return markdown;

  const currentContent = scopeIdx >= 0 ? sections[scopeIdx].content : '';
  const stripped = currentContent.replaceAll(SKILLS_LINE_RE, '').replaceAll(/\n{3,}/g, '\n\n').trimEnd();

  const newContent = skills.length > 0
    ? `${stripped}\n\n**Skills:** ${skills.join(' · ')}`
    : stripped;

  return replaceOrAppendMarkdownSection(markdown, 'Scope of Responsibility', newContent);
}

function toSkillEntry(skill: Skill) {
  return {
    name: skill.name,
    description: skill.description,
    type: skill.type,
    contextLevel: skill.contextLevel,
    tools: skill.tools ?? [],
  };
}

function filterSkills(skills: Skill[], query?: string): Skill[] {
  if (!query?.trim()) {
    return skills;
  }

  const q = query.trim().toLowerCase();
  return skills.filter(skill => {
    const haystack = [
      skill.name,
      skill.description,
      ...(skill.responsibilities ?? []),
      ...(skill.tools ?? []),
    ].join(' ').toLowerCase();

    return haystack.includes(q);
  });
}

function sortSkillsByName(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveFullAgent(workspaceRoot: string, query: string, operation: string): Promise<Agent> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();
  const resolved = resolveAgentForOperation(agentManager, query, operation);
  const agent = agentManager.getAgent(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }
  return agent;
}

async function resolveSkillByName(workspaceRoot: string, query: string): Promise<Skill> {
  const container = createContainer({ workspaceRoot });
  const skillManager = container.resolve(TOKENS.SkillManager);
  await skillManager.initialize();

  const skills = skillManager.getAllSkills();
  const normalized = query.trim().toLowerCase();
  const exact = skills.find(skill => skill.name.toLowerCase() === normalized);
  if (exact) return exact;

  const partials = skills.filter(skill => skill.name.toLowerCase().includes(normalized));
  if (partials.length === 1) return partials[0];
  if (partials.length > 1) {
    throw new Error(`Ambiguous skill "${query}" — matched: ${partials.map(s => s.name).join(', ')}`);
  }

  throw new Error(`Skill not found: ${query}`);
}

export async function searchSkillsCommand(
  workspaceRoot: string,
  options: SearchSkillsOptions = {},
): Promise<SearchSkillsResponse> {
  const container = createContainer({ workspaceRoot });
  const skillManager = container.resolve(TOKENS.SkillManager);
  await skillManager.initialize();

  const all = skillManager.getAllSkills();
  const filtered = sortSkillsByName(filterSkills(all, options.query));

  if (!options.agent) {
    return {
      entries: filtered.map(toSkillEntry),
      timestamp: new Date().toISOString(),
    };
  }

  const agent = await resolveFullAgent(workspaceRoot, options.agent, 'search skills for agent');
  const assigned = new Set((agent.specializations ?? []).map(s => s.toLowerCase()));

  return {
    entries: filtered.map(skill => ({
      ...toSkillEntry(skill),
      assignedToAgent: assigned.has(skill.name.toLowerCase()),
    })),
    timestamp: new Date().toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
  };
}

export async function addSkillCommand(
  workspaceRoot: string,
  options: UpdateAgentSkillOptions,
): Promise<UpdateAgentSkillResponse> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();

  const resolved = resolveAgentForOperation(agentManager, options.agent, 'add skill');
  const agent = agentManager.getAgent(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  const skill = await resolveSkillByName(workspaceRoot, options.skill);

  const current = agent.specializations ?? [];
  const currentNormalized = new Set(current.map(s => s.toLowerCase()));
  const changed = !currentNormalized.has(skill.name.toLowerCase());

  const nextSkills = changed
    ? [...current, skill.name].sort((a, b) => a.localeCompare(b))
    : [...current];

  const updated = changed
    ? await agentManager.updateAgent(agent.id, {
        specializations: nextSkills,
        markdown: syncSkillsLineInMarkdown(agent.markdown ?? '', nextSkills),
      })
    : agent;

  return {
    agent: { id: updated.id, name: updated.name, role: updated.role },
    skill: skill.name,
    skills: updated.specializations ?? nextSkills,
    changed,
  };
}

export async function removeSkillCommand(
  workspaceRoot: string,
  options: UpdateAgentSkillOptions,
): Promise<UpdateAgentSkillResponse> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();

  const resolved = resolveAgentForOperation(agentManager, options.agent, 'remove skill');
  const agent = agentManager.getAgent(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  const skill = await resolveSkillByName(workspaceRoot, options.skill);

  const current = agent.specializations ?? [];
  const nextSkills = current.filter(s => s.toLowerCase() !== skill.name.toLowerCase());
  const changed = nextSkills.length !== current.length;

  const updated = changed
    ? await agentManager.updateAgent(agent.id, {
        specializations: nextSkills,
        markdown: syncSkillsLineInMarkdown(agent.markdown ?? '', nextSkills),
      })
    : agent;

  return {
    agent: { id: updated.id, name: updated.name, role: updated.role },
    skill: skill.name,
    skills: updated.specializations ?? nextSkills,
    changed,
  };
}
