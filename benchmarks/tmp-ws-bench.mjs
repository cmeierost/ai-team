/**
 * WebSocket chat perf bench — tmp-ws-bench.mjs
 *
 * Usage:
 *   node tmp-ws-bench.mjs [agentId] [message] [sessionId]
 *
 * Examples:
 *   node tmp-ws-bench.mjs michael-brown "hello"
 *   node tmp-ws-bench.mjs michael-brown "hello" "some-session-id"
 *
 * Measures:
 *   - Time to first token (TTFT)
 *   - Time to last token / stream done (total latency)
 *   - Token count
 *   - Tokens/sec
 *   - Full event log with timestamps
 */

// Uses the native WebSocket built into Node 22+ (no extra dependency needed).

const WS_URL = process.env.WS_URL || 'ws://localhost:3002';
const agentId = process.argv[2] || 'michael-brown';
const message = process.argv[3] || 'say exactly: hello';
const sessionId = process.argv[4] || null;

const url = sessionId
  ? `${WS_URL}/ws/chat/${encodeURIComponent(agentId)}?sessionId=${encodeURIComponent(sessionId)}`
  : `${WS_URL}/ws/chat/${encodeURIComponent(agentId)}`;

console.log(`\nConnecting to: ${url}`);
console.log(`Message: "${message}"\n`);

const ws = new WebSocket(url);

const startAt = Date.now();
let readyAt = null;
let sentAt = null;
let firstTokenAt = null;
let doneAt = null;
let tokenCount = 0;
let fullText = '';
const events = [];

function log(label, extra = '') {
  const elapsed = Date.now() - startAt;
  const entry = `[+${String(elapsed).padStart(5)}ms] ${label}${extra ? ' ' + extra : ''}`;
  events.push(entry);
  console.log(entry);
}

ws.addEventListener('open', () => {
  log('WS open');
});

ws.addEventListener('message', ({ data: raw }) => {
  const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());

  if (msg.type === 'ready') {
    readyAt = Date.now();
    log('← ready  ', `(${readyAt - startAt}ms to ready)`);

    const payload = JSON.stringify({ type: 'message', content: message });
    ws.send(payload);
    sentAt = Date.now();
    log('→ sent   ', `"${message}"`);
    return;
  }

  if (msg.type === 'ack') {
    log('← ack');
    return;
  }

  if (msg.type === 'cancelled') {
    log('← cancelled');
    ws.close();
    return;
  }

  if (msg.type === 'error') {
    log('← error  ', JSON.stringify(msg.data));
    ws.close();
    return;
  }

  if (msg.type === 'mediator') {
    const evt = msg.data;

    if (evt.kind === 'token') {
      tokenCount++;
      fullText += evt.text;
      if (!firstTokenAt) {
        firstTokenAt = Date.now();
        log('← token#1', `TTFT=${firstTokenAt - sentAt}ms  text="${evt.text}"`);
      }
      return;
    }

    if (evt.kind === 'done') {
      doneAt = Date.now();
      log('← done');
      ws.close();
      return;
    }

    if (evt.kind === 'status') {
      log('← status ', JSON.stringify(evt));
      return;
    }

    if (evt.kind === 'tool') {
      log('← tool   ', `${evt.toolPhase} ${evt.toolName}`);
      return;
    }

    if (evt.kind === 'error') {
      log('← err    ', evt.message);
      ws.close();
      return;
    }

    log('← mediator', evt.kind);
    return;
  }

  // backward-compat
  if (msg.type === 'done') {
    doneAt = Date.now();
    log('← done (legacy)');
    ws.close();
    return;
  }

  log('← unknown', msg.type);
});

ws.addEventListener('close', () => {
  const totalMs = (doneAt ?? Date.now()) - startAt;
  const streamMs = doneAt && sentAt ? doneAt - sentAt : null;
  const ttft = firstTokenAt && sentAt ? firstTokenAt - sentAt : null;
  const tokensPerSec = streamMs && tokenCount > 0 ? (tokenCount / (streamMs / 1000)).toFixed(1) : 'n/a';

  console.log('\n─────────────────────────────────────────');
  console.log('  RESULTS');
  console.log('─────────────────────────────────────────');
  console.log(`  Total wall time  : ${totalMs}ms`);
  console.log(`  Time to ready    : ${readyAt ? readyAt - startAt : 'n/a'}ms`);
  console.log(`  TTFT (send→tok1) : ${ttft !== null ? ttft + 'ms' : 'no tokens'}`);
  console.log(`  Stream duration  : ${streamMs !== null ? streamMs + 'ms' : 'n/a'}`);
  console.log(`  Token count      : ${tokenCount}`);
  console.log(`  Tokens/sec       : ${tokensPerSec}`);
  console.log(`  Response length  : ${fullText.length} chars`);
  console.log('─────────────────────────────────────────');
  if (fullText) {
    const preview = fullText.length > 200 ? fullText.slice(0, 200) + '…' : fullText;
    console.log('\n  Response preview:');
    console.log(`  ${preview.replace(/\n/g, '\n  ')}`);
  }
  console.log('');
});

ws.addEventListener('error', (event) => {
  console.error('WebSocket error:', event.message ?? event.type);
  process.exit(1);
});
