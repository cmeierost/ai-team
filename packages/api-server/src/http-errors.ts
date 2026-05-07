/**
 * Application error classes — re-exported from @ai-team/core so api-server handlers
 * and consumers share the same class instances, which is required for `instanceof` checks.
 */
export {
  ApplicationError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  InternalError,
} from '@ai-team/core';
