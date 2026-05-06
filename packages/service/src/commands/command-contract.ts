export interface CommandExecute<TParams, TContext, TResult = void> {
  execute(params: TParams, context: TContext): Promise<TResult>;
}
