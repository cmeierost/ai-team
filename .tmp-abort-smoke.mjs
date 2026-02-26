import { createLocalAiTeamClient } from './packages/api-client/dist/index.js';

const client = createLocalAiTeamClient(process.cwd());
const controller = new AbortController();
const startedAt = Date.now();

setTimeout(() => {
  controller.abort(new Error('smoke-test abort'));
}, 1000);

let sawAborted = false;
for await (const event of client.stream({
  command: 'chat',
  payload: {
    employeeId: 'maya',
    options: { message: 'quick abort test', oneShot: true },
  },
}, {
  signal: controller.signal,
})) {
  if (event.kind === 'aborted') {
    sawAborted = true;
    break;
  }
}

const duration = Date.now() - startedAt;
console.log(JSON.stringify({ sawAborted, duration }));
if (!sawAborted || duration > 8000) {
  process.exit(1);
}
