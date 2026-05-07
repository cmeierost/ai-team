/**
 * Application error classes used by the service layer.
 * Thrown from service classes and translated to the appropriate output
 * by each adapter (HTTP status codes by the api-server middleware, exit codes / messages by the CLI).
 */

export class ApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApplicationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends ApplicationError {
  constructor(message: string) {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class InternalError extends ApplicationError {
  constructor(message: string) {
    super(500, message);
    this.name = 'InternalError';
  }
}
