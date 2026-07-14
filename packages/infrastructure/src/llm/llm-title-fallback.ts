import type { ChatMessage } from '@ai-team/core';

export class LlmTitleFallbackService {
  private readonly titleStopwords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'can',
    'could',
    'for',
    'from',
    'how',
    'i',
    'in',
    'is',
    'it',
    'let',
    'lets',
    'my',
    'of',
    'on',
    'or',
    'please',
    'say',
    'should',
    'that',
    'the',
    'this',
    'to',
    'want',
    'we',
    'what',
    'when',
    'where',
    'why',
    'would',
    'with',
    'you',
    'future',
  ]);

  private readonly titleActionVerbMap: Record<string, string> = {
    fix: 'Fix',
    improve: 'Improve',
    add: 'Add',
    update: 'Update',
    refactor: 'Refactor',
    debug: 'Debug',
    implement: 'Implement',
    test: 'Test',
    create: 'Create',
    plan: 'Plan',
    retire: 'Retire',
    retiring: 'Retire',
    retirement: 'Plan',
    archive: 'Archive',
    offboard: 'Offboard',
    offboarding: 'Offboard',
    decommission: 'Decommission',
    sunset: 'Sunset',
    consolidate: 'Consolidate',
  };

  private readonly titleActionWords = new Set(Object.keys(this.titleActionVerbMap));

  deriveFallbackTitle(messages: ChatMessage[]): string {
    const source = messages
      .filter((m) => m.isHuman)
      .slice(0, 2)
      .map((m) => m.content ?? '')
      .join(' ')
      .toLowerCase();

    const words = source
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    if (words.length === 0) return 'Plan Request';

    const actionWord = words.find((w) => this.titleActionVerbMap[w]);
    const action = actionWord ? this.titleActionVerbMap[actionWord] : 'Plan';

    const hasAgentToken = words.some((w) => w === 'agent' || w === 'agents');
    const hasRetirementToken = words.some((w) =>
      [
        'retire',
        'retiring',
        'retirement',
        'offboard',
        'offboarding',
        'decommission',
        'sunset',
      ].includes(w)
    );

    if (hasAgentToken && hasRetirementToken) {
      return 'Plan Agent Retirement';
    }

    const orderedUnique: string[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      if (this.titleStopwords.has(word) || this.titleActionWords.has(word)) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      orderedUnique.push(word);
      if (orderedUnique.length >= 3) break;
    }

    if (orderedUnique.length === 0) return `${action} Request`;

    const top = orderedUnique.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    return `${action} ${top.join(' ')}`.trim() || `${action} Request`;
  }

  isWeakGeneratedTitle(title: string): boolean {
    const normalized = title
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();

    if (!normalized) return true;

    const weakTitles = new Set([
      'new conversation',
      'conversation',
      'general request',
      'task request',
      'title request',
      'help request',
    ]);

    if (weakTitles.has(normalized)) return true;

    const words = normalized.split(' ').filter(Boolean);
    if (words.length < 2) return true;
    if (words[0] === 'let' || words[0] === 'lets') return true;

    const noisyWords = new Set([
      'let',
      'lets',
      'future',
      'want',
      'thing',
      'things',
      'stuff',
      'something',
      'anything',
    ]);
    const contentWords = words.filter(
      (w) => !this.titleStopwords.has(w) && !this.titleActionWords.has(w)
    );
    if (contentWords.length === 0) return true;
    if (contentWords.every((w) => noisyWords.has(w))) return true;
    if (normalized === 'let plan future want') return true;

    return false;
  }
}
