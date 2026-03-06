import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const WebSocket = require('./packages/ide-interface/node_modules/ws');
import { readFileSync } from 'fs';

const serverInfo = JSON.parse(readFileSync('.ai-team/.ide-server.json', 'utf8'));
console.log('Connecting to plugin on port', serverInfo.port);

const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);

ws.once('open', () => {
  ws.send(JSON.stringify({ type: 'register', workspaceRoot: serverInfo.workspaceRoot, kind: 'cli' }));
});

ws.once('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Register reply:', msg);
  if (msg.type !== 'registered') { ws.close(); process.exit(1); }

  const oldContent = [
    '---',
    'name: Alex Morgan',
    'role: senior-typescript-core-service-engineer',
    'type: individual-contributor',
    'contextLevel: module',
    'reportsTo: michael-brown',
    '---',
    '',
    'Alex is a senior engineer focused on TypeScript core services.',
    '',
  ].join('\n');

  const newContent = [
    '---',
    'name: Alex Morgan',
    'role: lead-typescript-core-service-engineer',
    'type: team-lead',
    'contextLevel: module',
    'reportsTo: michael-brown',
    '---',
    '',
    'Alex is a lead engineer focused on TypeScript core services and mentoring junior developers.',
    '',
  ].join('\n');

  const proposal = {
    type: 'codeEditProposal',
    proposal: {
      proposalId: 'test-proposal-001',
      agentName: 'Test Agent',
      description: 'Promote Alex to team lead role',
      files: [{
        filePath: 'C:\\Projects\\ai-team\\.ai-team\\agents\\alex-morgan.md',
        oldContent,
        newContent,
        additions: 2,
        deletions: 1,
      }],
    },
  };

  ws.send(JSON.stringify(proposal));
  console.log('Sent codeEditProposal — check VS Code for keep/undo decorations');

  ws.on('message', (d) => {
    console.log('Plugin ack:', d.toString());
  });

  // Keep connection open for 30s so you can interact with keep/undo in VS Code
  setTimeout(() => {
    console.log('Done, closing');
    ws.close();
    process.exit(0);
  }, 30000);
});

ws.once('error', (e) => { console.log('ERROR:', e.message); process.exit(1); });
