import { AgentManager, executeAgentTool } from './packages/core/dist/index.js';

const agentManager = new AgentManager(process.cwd());
await agentManager.initialize();

const maya = agentManager.resolveAgent('maya')[0];
if (!maya) {
  console.error('Maya not found');
  process.exit(1);
}

const context = {
  agent: maya,
  workspaceRoot: process.cwd(),
};

const registerResult = await executeAgentTool({
  toolName: 'register_cli_tool',
  params: { command: 'git' },
  context,
});

const runResult = await executeAgentTool({
  toolName: 'run_cli_tool',
  params: { command: 'git', args: ['status', '--short', '--branch'] },
  context,
});

const preview = runResult.ok
  ? String((runResult.result && typeof runResult.result === 'object' && 'stdout' in runResult.result)
    ? (runResult.result.stdout || '')
    : '')
    .split('\n')
    .slice(0, 5)
  : [runResult.error || 'unknown error'];

console.log(JSON.stringify({
  registerOk: registerResult.ok,
  runOk: runResult.ok,
  preview,
}, null, 2));
