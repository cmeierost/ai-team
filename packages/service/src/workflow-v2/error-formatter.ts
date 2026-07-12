export class WorkflowV2ErrorFormatter {
  format(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      const serialized = JSON.stringify(error);
      return serialized || 'Unknown workflow error';
    } catch {
      return 'Unknown workflow error';
    }
  }
}
