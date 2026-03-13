import { serveApiCommand, type ServeApiOptions } from '@ai-team/service';

export async function serveCommand(options: ServeApiOptions = {}): Promise<void> {
  await serveApiCommand(process.cwd(), options);
}