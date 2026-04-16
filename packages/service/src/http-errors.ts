/**
 * HTTP error classes used by service-layer controllers.
 * Thrown from service classes and translated to HTTP status codes
 * by the api-server error handler middleware.
 */

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class InternalError extends HttpError {
  constructor(message: string) {
    super(500, message);
    this.name = 'InternalError';
  }
}
