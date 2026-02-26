import { createLocalAiTeamClient } from './packages/api-client/dist/index.js';

const client = createLocalAiTeamClient(process.cwd());
const controller = new AbortController();
const seen = [];

try {
  for await (const event of client.stream({
    command: 'init',
    payload: { options: { force: true } },
  }, {
    signal: controller.signal,
    questionInput: async () => 'done',
    questionConfirm: async () => true,
    questionSelect: async (request) => request.choices?.[0]?.value ?? '',
    questionPassword: async () => 'x',
    questionChecklist: async () => [],
  })) {
    seen.push(event.kind);
    if (event.kind === 'question') {
      console.log('QUESTION_EVENT', JSON.stringify({ type: event.questionType, message: event.message }));
      controller.abort(new Error('probe-stop'));
      break;
    }
  }
} catch (error) {
  console.log('ERROR', String(error));
}

console.log('SEEN', seen.join(','));
