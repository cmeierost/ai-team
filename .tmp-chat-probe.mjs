import { createLocalAiTeamClient } from './packages/api-client/dist/index.js';

const client = createLocalAiTeamClient(process.cwd());
const seen = [];

for await (const event of client.stream({
  command: 'chat',
  payload: { employeeId: undefined, options: {} },
}, {
  questionInput: async () => 'exit',
  questionConfirm: async () => false,
  questionSelect: async (req) => req.choices?.[0]?.value ?? '',
  questionPassword: async () => '',
  questionChecklist: async () => [],
})) {
  seen.push(event.kind);
  if (event.kind === 'log') {
    process.stdout.write(`LOG:${event.message}\n`);
  }
  if (event.kind === 'question') {
    process.stdout.write(`QUESTION:${event.message}\n`);
  }
  if (event.kind === 'done' || event.kind === 'error' || event.kind === 'aborted') {
    process.stdout.write(`FINAL:${event.kind}\n`);
    break;
  }
}
process.stdout.write(`SEEN:${seen.join(',')}\n`);
