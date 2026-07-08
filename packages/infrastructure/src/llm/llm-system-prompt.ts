import type { Agent, InstructionFile, Skill } from '@ai-team/core';

export class LlmSystemPromptBuilder {
  build(
    agent: Agent,
    skills?: Skill[],
    teamRoster?: Agent[],
    instructions?: InstructionFile[]
  ): string {
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, a virtual AI team member.`);
    parts.push(`Your role: ${agent.role}`);
    if (agent.reportsTo) {
      const manager = teamRoster?.find((a) => a.id === agent.reportsTo);
      if (manager) parts.push(`You report to ${manager.name} (${manager.role}).`);
      else parts.push(`You report to ${agent.reportsTo}.`);
    }

    if (agent.personality) {
      const p = agent.personality;
      if (p.communication_style) parts.push(`Communication style: ${p.communication_style}`);
      if (p.expertise_level) parts.push(`Expertise level: ${p.expertise_level}`);
      if (typeof p.mentoring === 'boolean')
        parts.push(`Mentoring posture: ${p.mentoring ? 'enabled' : 'disabled'}`);

      parts.push('Personality behavior rules:');
      if (p.communication_style === 'supportive') {
        parts.push('- Be warm, friendly, and people-focused. Encourage and reassure.');
        parts.push('- Ask clarifying questions with empathy before deciding.');
      }
      if (p.communication_style === 'direct') {
        parts.push('- Be concise, decisive, and action-oriented.');
        parts.push('- Avoid filler and long introductions.');
      }
      if (p.communication_style === 'analytical') {
        parts.push('- Be structured and evidence-driven.');
        parts.push('- Use clear trade-offs, assumptions, and rationale.');
      }
      if (p.communication_style === 'strategic') {
        parts.push('- Focus on outcomes, priorities, and long-term implications.');
        parts.push('- Connect short-term actions to strategic goals.');
      }
      if (p.communication_style === 'collaborative') {
        parts.push('- Be cooperative, practical, and team-oriented.');
        parts.push('- Offer options and involve relevant teammates where useful.');
      }
      if (p.expertise_level === 'executive' || p.expertise_level === 'senior') {
        parts.push('- Show high competence and confidence. Be proactive and solution-driven.');
      }
      if (p.mentoring)
        parts.push('- Explain decisions clearly and coach through next steps when helpful.');
    }

    const skillsWithInstructions = skills?.filter((s) => s.instructions) ?? [];
    if (skillsWithInstructions.length > 0) {
      parts.push('');
      parts.push('## Role Instructions');
      for (const skill of skillsWithInstructions) parts.push(skill.instructions);
    }

    if (agent.markdown?.trim()) {
      parts.push('');
      parts.push('## About You');
      parts.push(agent.markdown.trim());
    }

    if (instructions && instructions.length > 0) {
      parts.push('');
      parts.push('## Workspace Instructions');
      for (const inst of instructions) {
        if (inst.instructions.trim()) {
          parts.push('');
          parts.push(inst.instructions);
        }
      }
    }

    if (teamRoster && teamRoster.length > 0) {
      const others = teamRoster.filter((a) => a.id !== agent.id);
      if (others.length > 0) {
        parts.push('');
        parts.push('## Your Team');
        parts.push(
          'These are the other members of your organization. You can suggest the user talk to them when appropriate:'
        );
        for (const a of others) {
          const reportsInfo = a.reportsTo ? ` (reports to ${a.reportsTo})` : '';
          parts.push(`- ${a.name} — ${a.role}${reportsInfo}`);
        }
      }
    }

    if (agent.role === 'hr-director') {
      parts.push('');
      parts.push('## Hiring Protocol');
      parts.push(
        'When you decide to hire a new person, include exactly one machine-readable line:'
      );
      parts.push('HIRE: Full Name | role-kebab-case');
      parts.push('Example: HIRE: Alex Morgan | backend-engineer');
    }

    parts.push('');
    parts.push('## Tool Usage');
    parts.push(
      'You have tools available. Use them aggressively — do not guess or rely on memory when a tool can give you the answer.'
    );
    parts.push('Rules:');
    parts.push(
      '- When a task requires inspecting files, code, or the workspace, call the relevant tool immediately. Do not describe what you would do — do it.'
    );
    parts.push(
      '- When you need information that a tool can retrieve (file contents, directory listing, symbol search, etc.), call the tool before responding.'
    );
    parts.push(
      '- Prefer tool evidence over recalled knowledge. If you are unsure whether something is current, call a tool to verify.'
    );
    parts.push(
      '- Chain tool calls when needed: run multiple tools in sequence to gather the full picture before composing your answer.'
    );
    parts.push(
      '- Only fall back to answering from memory when no tool can provide the needed evidence.'
    );

    parts.push('');
    parts.push('## CLI Commands Available To The User');
    parts.push('The developer can run these in-chat commands:');
    parts.push('- chat <name|role>');
    parts.push('- list');
    parts.push('- hire');
    parts.push('- history [count]');
    parts.push('- portfolio (or bio)');
    parts.push('- graph');
    parts.push('- overview');
    parts.push('- run <command> (shell command; output is shared with you)');
    parts.push('- help');
    parts.push('- exit');
    parts.push(
      'Top-level CLI commands include: ait info <agent>, ait fire <agent>, ait init, ait list, ait chat.'
    );
    parts.push(
      'When the developer shares tool output (overview snapshots, run <command>, etc.), treat it as fresh context and reference it in your reasoning.'
    );
    parts.push(
      'Treat tool output as direct evidence with provenance. Distinguish verified tool evidence from your inference.'
    );
    parts.push(
      'If tool outputs conflict, explicitly acknowledge the conflict and prioritize the strongest directly available evidence.'
    );
    parts.push(
      'If one tool call fails but other tool evidence is usable, say which call failed and proceed using the verified evidence.'
    );
    parts.push('Prefer fresh tool evidence over memory for factual claims.');
    parts.push(
      'If a person is not found, tell the user to run `chat <name>` so fuzzy search can resolve the employee.'
    );
    parts.push(
      'To hand off with a message, include exactly one line: HANDOFF: <name-or-role> | <message for that teammate>.'
    );
    parts.push(
      'Example: HANDOFF: hr-director | Please hire a chief architect and start requirement engineering staffing.'
    );

    parts.push('');
    parts.push('Stay in character. Respond as this team member would.');
    parts.push('Be concise and helpful. Use your expertise to assist the developer.');
    parts.push(
      'Be curious and proactive: ask concise clarifying questions when requirements, constraints, or success criteria are ambiguous.'
    );
    parts.push(
      'Stop asking questions once you have enough information to act; do not ask repetitive or low-value questions.'
    );
    parts.push(
      'Ask at most one high-impact clarification at a time unless the developer explicitly requests a questionnaire.'
    );
    parts.push(
      'When the user asks to be forwarded or connected to another team member, acknowledge the handoff gracefully.'
    );
    parts.push('Only hand off to people listed in "Your Team". Do not invent names or roles.');
    parts.push('Do not claim someone was hired unless they already exist in "Your Team".');
    parts.push(
      'If a requested person is not in "Your Team", tell the user to run the `hire` command first.'
    );

    return parts.join('\n');
  }
}
