import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../observability/logger';

/** 404 for any request that matched no route. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

/**
 * Central error handler — the ONLY place that turns errors into responses.
 *
 * - AppError (expected, thrown by services): status + code + message go to
 *   the client; logged at warn.
 * - Body-parser errors: mapped to 400/413.
 * - Everything else: logged at error WITH the stack trace (for Loki), but the
 *   client only ever sees a generic 500 envelope — internals never leak.
 */
export function errorHandler(
  err: Error & { type?: string; statusCode?: number },
  req: Request,
  res: Response,
  // Express identifies error middleware by arity — the 4th param is required.
  _next: NextFunction,
): void {
  const log = req.log ?? logger;

  if (res.headersSent) {
    // Response already streaming; nothing safe to do but note it.
    log.error({ err }, 'Error after response headers were sent');
    return;
  }

  if (err instanceof AppError) {
    log.warn({ code: err.code, statusCode: err.statusCode }, err.message);
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // express.json() parse failures
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
    return;
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' },
    });
    return;
  }

  log.error({ err, error: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
  });
}
