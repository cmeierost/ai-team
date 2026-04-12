/**
 * HTTP error classes — re-exported from @ai-team/service so service-layer
 * controllers and api-server handlers share the same class instances,
 * which is required for `instanceof` checks in the error-handler middleware.
 */
export {
  HttpError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  InternalError,
} from '@ai-team/service';
