import type { ExecutionContext } from '@ai-team/core';

interface PathPermissionChecker {
  canWritePath(permissions: unknown, filePath: string): boolean;
}

export class ExecutionContextGuards {
  static requirePathPermissionChecker(context: ExecutionContext): PathPermissionChecker {
    const checker = (
      context as ExecutionContext & {
        pathPermissionChecker?: PathPermissionChecker;
      }
    ).pathPermissionChecker;

    if (!checker) {
      throw new Error('ExecutionContext.pathPermissionChecker is required for code tools.');
    }

    return checker;
  }
}
