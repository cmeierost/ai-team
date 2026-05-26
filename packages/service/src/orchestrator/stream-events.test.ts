import { describe, expect, it, vi, afterEach } from 'vitest';
import { emitLog, runWithEmitter } from './stream-events.js';
import { EmitService } from './services/emit-service.js';

describe('emitLog fallback output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to stdout when no hooks.emit exists', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    emitLog('info', 'slash help output');

    expect(stdoutSpy).toHaveBeenCalledWith('slash help output\n');
  });

  it('writes to stderr for error level when no hooks.emit exists', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    emitLog('error', 'slash error');

    expect(stderrSpy).toHaveBeenCalledWith('slash error\n');
  });

  it('prefers hooks.emit and does not write to stdout directly when emitter is present', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const emit = vi.fn();

    await runWithEmitter(new EmitService(emit), async () => {
      emitLog('info', 'via event');
    });

    expect(emit).toHaveBeenCalledWith({ kind: 'log', level: 'info', message: 'via event' });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
