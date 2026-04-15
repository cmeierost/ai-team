import { describe, expect, it } from 'vitest';
import { pickVoice } from './agentVoice';
import type { Agent } from '../types';

function createVoice(name: string, lang = 'en-US'): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService: true,
    name,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

function createAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    name: 'Default Agent',
    role: 'Engineer',
    ...overrides,
  };
}

describe('pickVoice', () => {
  it('prefers explicit ttsVoice exact match', () => {
    const agent = createAgent({ ttsVoice: 'Microsoft Zira Desktop' });
    const voices = [createVoice('Microsoft David Desktop'), createVoice('Microsoft Zira Desktop')];

    const picked = pickVoice(agent, voices);

    expect(picked?.name).toBe('Microsoft Zira Desktop');
  });

  it('prefers explicit ttsVoice partial match when exact is unavailable', () => {
    const agent = createAgent({ ttsVoice: 'Zira' });
    const voices = [createVoice('Microsoft David Desktop'), createVoice('Microsoft Zira Desktop')];

    const picked = pickVoice(agent, voices);

    expect(picked?.name).toBe('Microsoft Zira Desktop');
  });

  it('prefers female-marked voices for she/her agents', () => {
    const agent = createAgent({ id: 'female-agent', name: 'Emily Stone', pronouns: 'she/her' });
    const voices = [
      createVoice('Microsoft David Desktop'),
      createVoice('Microsoft Zira Desktop'),
      createVoice('Microsoft Aria Online (Natural)'),
    ];

    const picked = pickVoice(agent, voices);

    expect(['Microsoft Zira Desktop', 'Microsoft Aria Online (Natural)']).toContain(picked?.name);
  });

  it('prefers male-marked voices for he/him agents', () => {
    const agent = createAgent({ id: 'male-agent', name: 'David Stone', pronouns: 'he/him' });
    const voices = [
      createVoice('Microsoft Zira Desktop'),
      createVoice('Microsoft Aria Online (Natural)'),
      createVoice('Microsoft David Desktop'),
    ];

    const picked = pickVoice(agent, voices);

    expect(['Microsoft David Desktop']).toContain(picked?.name);
  });

  it('falls back to deterministic full-list selection when style markers are unavailable', () => {
    const agent = createAgent({ id: 'neutral-agent', name: 'Alex Rivera' });
    const voices = [createVoice('Voice One'), createVoice('Voice Two'), createVoice('Voice Three')];

    const firstPick = pickVoice(agent, voices);
    const secondPick = pickVoice(agent, voices);

    expect(firstPick?.name).toBe(secondPick?.name);
  });
});
