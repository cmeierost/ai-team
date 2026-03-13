import { describe, expect, it } from 'vitest';
import { generateIntroduction } from './introduction.js';

describe('generateIntroduction', () => {
  it('uses Greeting section template with developer placeholder', async () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: [
        '## Greeting',
        'Hi {{developerName}}, I am {{agentName}} ({{agentRole}}). What should we focus on first?',
      ].join('\n\n'),
    } as any;

    const text = await generateIntroduction(
      {} as any,
      {} as any,
      agent,
      undefined,
      'Clemens',
    );

    expect(text).toBe('Hi Clemens, I am Michael Brown (ceo). What should we focus on first?');
  });

  it('falls back to default greeting when markdown has no Greeting section', async () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: '## Introduction\n\nI am Michael Brown.',
    } as any;

    const text = await generateIntroduction(
      {} as any,
      {} as any,
      agent,
      undefined,
      'Clemens',
    );

    expect(text).toContain('Hi Clemens');
    expect(text).toContain('Michael Brown');
    expect(text).toContain('(ceo)');
  });

  it('renders fallback developer name when placeholder is present but developer is unknown', async () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: '## Greeting\n\nHello {{developerName}}.',
    } as any;

    const text = await generateIntroduction(
      {} as any,
      {} as any,
      agent,
      undefined,
      undefined,
    );

    expect(text).toBe('Hello there.');
  });
});
