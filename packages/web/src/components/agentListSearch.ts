import type { Agent } from '../types';

interface RankedAgent {
  agent: Agent;
  score: number;
}

function isNonEmptyString(value: string | undefined | null): value is string {
  return Boolean(value?.trim());
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreField(fieldValue: string, query: string, queryTokens: string[], exactScore: number, prefixScore: number, containsScore: number): number {
  if (!fieldValue) {
    return 0;
  }

  if (fieldValue === query) {
    return exactScore;
  }

  const fieldTokens = tokenize(fieldValue);
  if (fieldTokens.includes(query)) {
    return Math.max(exactScore - 20, containsScore);
  }

  if (fieldValue.startsWith(query)) {
    return prefixScore;
  }

  if (fieldTokens.some((token) => token.startsWith(query))) {
    return Math.max(prefixScore - 20, containsScore);
  }

  if (fieldValue.includes(query)) {
    return containsScore;
  }

  if (queryTokens.length > 1 && queryTokens.every((token) => fieldValue.includes(token))) {
    return Math.max(containsScore - 10, 1);
  }

  return 0;
}

function scoreCollection(values: string[], query: string, queryTokens: string[], exactScore: number, prefixScore: number, containsScore: number): number {
  return values.reduce((bestScore, value) => {
    return Math.max(bestScore, scoreField(normalizeText(value), query, queryTokens, exactScore, prefixScore, containsScore));
  }, 0);
}

function buildSearchCollections(agent: Agent, reportsToName?: string) {
  const primary = [agent.name, agent.id];
  const secondary = [
    agent.role,
    agent.type,
    agent.contextLevel,
    ...(agent.specializations ?? []),
    ...(agent.features ?? []),
    ...(agent.availableFor ?? []),
    ...(agent.tools ?? []),
    ...(agent.cliTools ?? []),
    ...(agent.skills ?? []).flatMap((skill) => [skill.name, skill.description ?? '', ...(skill.tags ?? []), ...(skill.examples ?? [])]),
  ];
  const tertiary = [
    reportsToName ? `reports to ${reportsToName}` : '',
    agent.reportsTo ?? '',
    ...(agent.delegatesTo ?? []),
    agent.goal ?? '',
    agent.backstory ?? '',
    agent.markdown ?? '',
    agent.status ?? '',
    agent.pronouns ?? '',
    agent.workHours ?? '',
    agent.personality?.communication_style ?? '',
    agent.personality?.expertise_level ?? '',
    agent.llm?.provider ?? '',
    agent.llm?.model ?? '',
    agent.llm?.modelKey ?? '',
  ];

  return {
    primary: primary.filter(isNonEmptyString),
    secondary: secondary.filter(isNonEmptyString),
    tertiary: tertiary.filter(isNonEmptyString),
  };
}

export function rankAgentsBySearch(agents: Agent[], searchTerm: string): Agent[] {
  const query = normalizeText(searchTerm);
  if (!query) {
    return agents;
  }

  const queryTokens = tokenize(query);
  const agentNamesById = new Map(agents.map((agent) => [agent.id, agent.name]));

  const rankedAgents: RankedAgent[] = agents
    .map((agent) => {
      const collections = buildSearchCollections(agent, agent.reportsTo ? agentNamesById.get(agent.reportsTo) : undefined);
      const primaryScore = scoreCollection(collections.primary, query, queryTokens, 1000, 850, 700);
      const secondaryScore = scoreCollection(collections.secondary, query, queryTokens, 560, 470, 340);
      const tertiaryScore = scoreCollection(collections.tertiary, query, queryTokens, 180, 120, 70);
      const matchedTokens = queryTokens.filter((token) =>
        [...collections.primary, ...collections.secondary, ...collections.tertiary].some((value) => normalizeText(value).includes(token)),
      ).length;
      const coverageBonus = matchedTokens * 12;
      const score = primaryScore + secondaryScore + tertiaryScore + coverageBonus;

      return {
        agent,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.agent.name.localeCompare(right.agent.name);
    });

  return rankedAgents.map((entry) => entry.agent);
}