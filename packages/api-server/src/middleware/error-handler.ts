import type { Request, Response, NextFunction } from 'express';
import { AmbiguousAgentQueryError } from '@ai-team/service';
import { AgentNotFoundError, ApplicationError } from '@ai-team/core';
import { writeServerError } from '../server-log.js';

export interface ApiError {
  error: string;
  details?: unknown;
  statusCode?: number;
}

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction): void {
  writeServerError(err, {
    phase: 'request',
    method: _req.method,
    path: _req.path,
  });
  console.error('API Error:', err);

  // Check if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // Handle AmbiguousAgentQueryError - multiple matches
  if (err instanceof AmbiguousAgentQueryError) {
    res.status(400).json({
      error: err.message,
      query: err.query,
      matches: err.matches,
      details: 'Multiple agents matched your query. Please be more specific.',
    } as ApiError);
    return;
  }

  // Handle AgentNotFoundError - no matches
  if (err instanceof AgentNotFoundError || err.name === 'AgentNotFoundError') {
    res.status(404).json({
      error: err.message,
      details: 'Agent not found. Check the agent ID, role, or name.',
    } as ApiError);
    return;
  }

  // Handle ApplicationError (thrown by route handlers)
  if (err instanceof ApplicationError) {
    res.status(err.statusCode).json({ error: err.message } as ApiError);
    return;
  }

  // Map error types to status codes
  let statusCode = 500;
  let message = err.message || 'Internal server error';

  // Check for common error patterns
  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.message.includes('not found') || err.message.includes('does not exist')) {
    statusCode = 404;
  } else if (err.message.includes('permission') || err.message.includes('unauthorized')) {
    statusCode = 403;
  } else if (err.message.includes('already exists')) {
    statusCode = 409;
  }

  // Send error response
  res.status(statusCode).json({
    error: message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  } as ApiError);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not found',
    details: `Route ${req.method} ${req.path} does not exist`,
  } as ApiError);
}
