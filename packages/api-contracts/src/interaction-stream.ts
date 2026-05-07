import type {
  IInteractionStream,
  QuestionEventName,
  QuestionHandlerMap,
  StreamEvent,
} from './contract/routers/streaming.js';

/**
 * Concrete stream wrapper that collects `.on()` handler registrations and
 * passes them to a factory when async iteration begins.
 *
 * The factory receives the collected handlers so it can wire them into
 * whatever transport or service context it uses internally.
 */
export class InteractionStream<
  TCommand extends string = string,
> implements IInteractionStream<TCommand> {
  private readonly handlers: Partial<QuestionHandlerMap> = {};

  constructor(
    private readonly factory: (
      handlers: Partial<QuestionHandlerMap>
    ) => AsyncIterable<StreamEvent<TCommand>>
  ) {}

  on<K extends QuestionEventName>(event: K, handler: QuestionHandlerMap[K]): this {
    (this.handlers as Record<string, unknown>)[event] = handler;
    return this;
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent<TCommand>> {
    return this.factory(this.handlers)[Symbol.asyncIterator]();
  }
}
