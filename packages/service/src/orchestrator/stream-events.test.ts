import { describe, expect, it, vi, afterEach } from 'vitest';
import { emitLog } from './stream-events.js';
import { EmitService } from './services/emit-service.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { setServiceContainer } from '../service-registry.js';

function installEmitService(emit?: (event: any) => void) {
  const emitService = new EmitService();
  emitService.setDefaultEmitter(emit);
  setServiceContainer({
    resolve: (token: { id?: string }) => {
      if (token?.id === COMMAND_FACTORY_TOKENS.EmitService.id) {
        return emitService;
      }
      throw new Error(`Unexpected token: ${String(token?.id)}`);
    },
  } as any);
}

describe('emitLog fallback output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to stdout when no hooks.emit exists', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    installEmitService();

    emitLog('info', 'slash help output');

    expect(stdoutSpy).toHaveBeenCalledWith('slash help output\n');
  });

  it('writes to stderr for error level when no hooks.emit exists', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    installEmitService();

    emitLog('error', 'slash error');

    expect(stderrSpy).toHaveBeenCalledWith('slash error\n');
  });

  it('prefers hooks.emit and does not write to stdout directly when emitter is present', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const emit = vi.fn();

    installEmitService(emit);

    emitLog('info', 'via event');

    expect(emit).toHaveBeenCalledWith({ kind: 'log', level: 'info', message: 'via event' });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
