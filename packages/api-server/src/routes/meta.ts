import express, { type Router } from 'express';
import type { Agent, InstructionFile, Skill } from '@ai-team/core';
import { AgentManager, SkillManager, loadAllInstructionFiles } from '@ai-team/core';

export interface ContextSegment {
  label: string;
  key: string;
  chars: number;
}

export interface ContextEstimateResponse {
  agentId: string;
  segments: ContextSegment[];
  totalChars: number;
}

// These helpers mirror buildSystemPrompt() in @ai-team/core to produce per-segment
// character counts without running the full LLM pipeline.

type CommunicationStyle = 'collaborative' | 'direct' | 'supportive' | 'analytical' | 'strategic';

const STYLE_RULES: Partial<Record<CommunicationStyle, string[]>> = {
  supportive: [
    '- Be warm, friendly, and people-focused. Encourage and reassure.',
    '- Ask clarifying questions with empathy before deciding.',
  ],
  direct: [
    '- Be concise, decisive, and action-oriented.',
    '- Avoid filler and long introductions.',
  ],
  analytical: [
    '- Be structured and evidence-driven.',
    '- Use clear trade-offs, assumptions, and rationale.',
  ],
  strategic: [
    '- Focus on outcomes, priorities, and long-term implications.',
    '- Connect short-term actions to strategic goals.',
  ],
  collaborative: [
    '- Be cooperative, practical, and team-oriented.',
    '- Offer options and involve relevant teammates where useful.',
  ],
};

function buildManagerLine(agent: Agent, allAgents: Agent[]): string[] {
  if (!agent.reportsTo) {
    return [];
  }
  const manager = allAgents.find(a => a.id === agent.reportsTo);
  if (manager) {
    return [`You report to ${manager.name} (${manager.role}).`];
  }
  return [`You report to ${agent.reportsTo}.`];
}

function buildPersonalityLines(agent: Agent): string[] {
  const p = agent.personality;
  if (!p) {
    return [];
  }

  const metadata = [
    ...(p.communication_style ? [`Communication style: ${p.communication_style}`] : []),
    ...(p.expertise_level ? [`Expertise level: ${p.expertise_level}`] : []),
    ...(typeof p.mentoring === 'boolean' ? [`Mentoring posture: ${p.mentoring ? 'enabled' : 'disabled'}`] : []),
  ];

  const styleRules = p.communication_style ? (STYLE_RULES[p.communication_style] ?? []) : [];
  const seniorRules = (p.expertise_level === 'executive' || p.expertise_level === 'senior')
    ? ['- Show high competence and confidence. Be proactive and solution-driven.']
    : [];
  const mentoringRules = p.mentoring
    ? ['- Explain decisions clearly and coach through next steps when helpful.']
    : [];

  const behaviorRules = [...styleRules, ...seniorRules, ...mentoringRules];
  if (behaviorRules.length === 0) {
    return metadata;
  }

  return [...metadata, 'Personality behavior rules:', ...behaviorRules];
}

function buildIdentityText(agent: Agent, allAgents: Agent[]): string {
  return [
    `You are ${agent.name}, a virtual AI team member.`,
    `Your role: ${agent.role}`,
    ...buildManagerLine(agent, allAgents),
    ...buildPersonalityLines(agent),
  ].join('\n');
}

function buildSkillsText(skills: Skill[]): string {
  const withInstructions = skills.filter(s => s.instructions);
  if (withInstructions.length === 0) return '';
  const parts = ['', '## Role Instructions'];
  for (const skill of withInstructions) parts.push(skill.instructions);
  return parts.join('\n');
}

function buildBioText(agent: Agent): string {
  if (!agent.markdown?.trim()) return '';
  return ['', '## About You', agent.markdown.trim()].join('\n');
}

function buildInstructionsText(instructions: InstructionFile[]): string {
  const parts: string[] = ['', '## Workspace Instructions'];
  let hasContent = false;
  for (const inst of instructions) {
    if (inst.instructions.trim()) {
      parts.push('', inst.instructions);
      hasContent = true;
    }
  }
  return hasContent ? parts.join('\n') : '';
}

function buildRosterText(agent: Agent, allAgents: Agent[]): string {
  const others = allAgents.filter(a => a.id !== agent.id);
  if (others.length === 0) return '';
  const parts = [
    '',
    '## Your Team',
    'These are the other members of your organization. You can suggest the user talk to them when appropriate:',
  ];
  for (const a of others) {
    const reportsInfo = a.reportsTo ? ` (reports to ${a.reportsTo})` : '';
    parts.push(`- ${a.name} — ${a.role}${reportsInfo}`);
  }
  return parts.join('\n');
}

function buildCliGuardrailsText(agent: Agent): string {
  const hiringProtocol = agent.role === 'hr-director'
    ? [
      '',
      '## Hiring Protocol',
      'When you decide to hire a new person, include exactly one machine-readable line:',
      'HIRE: Full Name | role-kebab-case',
      'Example: HIRE: Alex Morgan | backend-engineer',
    ]
    : [];

  const cliAndGuardrails = [
    '', '## CLI Commands Available To The User',
    'The developer can run these in-chat commands:',
    '- chat <name|role>', '- list', '- hire', '- history [count]',
    '- portfolio (or bio)', '- graph', '- overview',
    '- run <command> (shell command; output is shared with you)',
    '- help', '- exit',
    'Top-level CLI commands include: ait info <agent>, ait fire <agent>, ait init, ait list, ait chat.',
    'When the developer shares tool output (overview snapshots, run <command>, etc.), treat it as fresh context and reference it in your reasoning.',
    'If a person is not found, tell the user to run `chat <name>` so fuzzy search can resolve the employee.',
    'To hand off with a message, include exactly one line: HANDOFF: <name-or-role> | <message for that teammate>.',
    'Example: HANDOFF: hr-director | Please hire a chief architect and start requirement engineering staffing.',
    '', 'Stay in character. Respond as this team member would.',
    'Be concise and helpful. Use your expertise to assist the developer.',
    'Be curious and proactive: ask concise clarifying questions when requirements, constraints, or success criteria are ambiguous.',
    'Stop asking questions once you have enough information to act; do not ask repetitive or low-value questions.',
    'Ask at most one high-impact clarification at a time unless the developer explicitly requests a questionnaire.',
    'When the user asks to be forwarded or connected to another team member, acknowledge the handoff gracefully.',
    'Only hand off to people listed in "Your Team". Do not invent names or roles.',
    'Do not claim someone was hired unless they already exist in "Your Team".',
    'If a requested person is not in "Your Team", tell the user to run the `hire` command first.',
  ];

  return [...hiringProtocol, ...cliAndGuardrails].join('\n');
}

export function createMetaRouter(workspaceRoot: string, agentManager: AgentManager): Router {
  const router = express.Router();

  /**
   * @openapi
   * /api/meta/context-estimate/{agentId}:
   *   get:
   *     tags: [Meta]
   *     summary: Context window usage estimate for a given agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Per-segment character and token count breakdown
   *       404:
   *         description: Agent not found
   */
  router.get('/context-estimate/:agentId', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params as { agentId: string };
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }

      const allAgents = agentManager.getAllAgents();
      const instructions = await loadAllInstructionFiles(workspaceRoot);

      const skillManager = new SkillManager(workspaceRoot);
      await skillManager.initialize();
      const resolved = skillManager.resolveSkillsForAgent(agent);

      const rawSegments = [
        { key: 'identity',     label: 'Identity & personality',  text: buildIdentityText(agent, allAgents) },
        { key: 'skills',       label: 'Role skills',             text: buildSkillsText(resolved.skills) },
        { key: 'bio',          label: 'Agent bio',               text: buildBioText(agent) },
        { key: 'instructions', label: 'Workspace instructions',  text: buildInstructionsText(instructions) },
        { key: 'roster',       label: 'Team roster',             text: buildRosterText(agent, allAgents) },
        { key: 'cli',          label: 'CLI & guardrails',        text: buildCliGuardrailsText(agent) },
      ];

      const segments: ContextSegment[] = rawSegments
        .map(s => ({ key: s.key, label: s.label, chars: s.text.length }))
        .filter(s => s.chars > 0);

      const totalChars = segments.reduce((sum, s) => sum + s.chars, 0);
      return res.json({ agentId, segments, totalChars } satisfies ContextEstimateResponse);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
