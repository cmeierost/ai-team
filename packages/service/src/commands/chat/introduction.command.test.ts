import { describe, expect, it, vi } from 'vitest';
import { IntroductionCommand, IntroductionRenderer } from './introduction.command.js';

const markdownSectionService = {
  parseMarkdownSections: (markdown: string) => {
    const lines = markdown.split(/\r?\n/);
    const sections: Array<{ heading: string; content: string }> = [];
    let currentHeading = '';
    let buffer: string[] = [];

    const pushCurrent = () => {
      sections.push({ heading: currentHeading, content: buffer.join('\n').trim() });
      buffer = [];
    };

    const headingRegex = /^##\s+(.+)$/;
    for (const line of lines) {
      const match = headingRegex.exec(line);
      if (match) {
        pushCurrent();
        currentHeading = match[1].trim();
        continue;
      }
      buffer.push(line);
    }

    pushCurrent();
    return sections;
  },
} as any;

describe('IntroductionRenderer', () => {
  it('uses Greeting section template with developer placeholder', () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: [
        '## Greeting',
        'Hi {{developerName}}, I am {{agentName}} ({{agentRole}}). What should we focus on first?',
      ].join('\n\n'),
    } as any;

    const renderer = new IntroductionRenderer(markdownSectionService);
    const text = renderer.render(agent, 'Clemens');

    expect(text).toBe('Hi Clemens, I am Michael Brown (ceo). What should we focus on first?');
  });

  it('falls back to default greeting when markdown has no Greeting section', () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: '## Introduction\n\nI am Michael Brown.',
    } as any;

    const renderer = new IntroductionRenderer(markdownSectionService);
    const text = renderer.render(agent, 'Clemens');

    expect(text).toContain('Hi Clemens');
    expect(text).toContain('Michael Brown');
    expect(text).toContain('(ceo)');
  });

  it('renders fallback developer name when placeholder is present but developer is unknown', () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: '## Greeting\n\nHello {{developerName}}.',
    } as any;

    const renderer = new IntroductionRenderer(markdownSectionService);
    const text = renderer.render(agent, undefined);

    expect(text).toBe('Hello there.');
  });
});

describe('IntroductionCommand', () => {
  it('uses an explicit workflow introduction instead of the agent greeting', async () => {
    const appendMessage = vi.fn(async () => undefined);
    const command = new IntroductionCommand(
      { recordInteractionAsync: vi.fn(async () => undefined) },
      markdownSectionService,
      { appendMessage } as any,
      { emit: vi.fn() } as any
    );

    await command.execute({
      agent: {
        id: 'elena-rodriguez',
        name: 'Elena Rodriguez',
        role: 'ceo',
        markdown: '## Greeting\n\nThis generic greeting must not be used.',
      } as any,
      history: [],
      developerName: 'Clemens',
      sessionId: 'sess-workflow',
      text: "Hi Clemens, let's define the business.",
    });

    expect(appendMessage).toHaveBeenCalledWith(
      'sess-workflow',
      expect.objectContaining({
        content: "Hi Clemens, let's define the business.",
      })
    );
  });

  it('persists the introduction for the standard transcript renderer', async () => {
    const recordInteractionAsync = vi.fn(async () => undefined);
    const appendMessage = vi.fn(async () => undefined);
    const emit = vi.fn();

    const command = new IntroductionCommand(
      { recordInteractionAsync },
      markdownSectionService,
      { appendMessage } as any,
      { emit } as any
    );

    const history: any[] = [];
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      markdown: '## Greeting\n\nHi {{developerName}}',
    } as any;

    await command.execute({
      agent,
      history,
      developerName: 'Clemens',
      sessionId: 'sess-1',
      hooks: { emitService: {} as any },
    });

    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        from: 'michael-brown',
        to: 'human',
        content: 'Hi Clemens',
      })
    );
    expect(appendMessage.mock.calls[0]?.[1]).not.toHaveProperty('importance');
    expect(emit).not.toHaveBeenCalled();
    expect(history).toHaveLength(1);
    expect(recordInteractionAsync).toHaveBeenCalledWith('michael-brown');
  });
});
