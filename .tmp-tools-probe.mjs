import fs from 'fs';

const envText = fs.readFileSync('.ai-team/.env', 'utf-8');
const keyLine = envText.split(/\r?\n/).find(line => line.startsWith('AI_TEAM_LLM_API_KEY='));
const apiKey = keyLine ? keyLine.split('=', 2)[1].replace(/^"|"$/g, '') : '';

const baseUrl = 'https://api.llmhub.infs.ai/v1';

const messages = [{ role: 'user', content: 'Say hi' }];

const testCases = [
  {
    name: 'no-tools',
    body: {
      model: 'best-chat',
      messages,
      max_tokens: 20,
    },
  },
  {
    name: 'tool-generic',
    body: {
      model: 'best-chat',
      messages,
      max_tokens: 20,
      tools: [
        {
          type: 'function',
          function: {
            name: 'semantic_search',
            description: 'Search codebase',
            parameters: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      ],
    },
  },
  {
    name: 'tool-explicit',
    body: {
      model: 'best-chat',
      messages,
      max_tokens: 20,
      tools: [
        {
          type: 'function',
          function: {
            name: 'semantic_search',
            description: 'Search codebase',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        },
      ],
    },
  },
];

for (const testCase of testCases) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || 'not-needed'}`,
      },
      body: JSON.stringify(testCase.body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.log(`${testCase.name}: ERR (HTTP ${response.status}) ${text}`);
      continue;
    }

    const json = await response.json();
    console.log(`${testCase.name}: OK (${json?.choices?.[0]?.finish_reason ?? 'n/a'})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${testCase.name}: ERR (${message})`);
  }
}
