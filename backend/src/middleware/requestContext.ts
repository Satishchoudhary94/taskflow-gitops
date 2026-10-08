import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../observability/logger';

/**
 * Request correlation.
 *
 * Honors an incoming X-Request-ID (from an ingress/load balancer or an
 * upstream service), otherwise generates one. The id is:
 *   - echoed back in the X-Request-ID response header
 *   - attached to a request-scoped child logger (req.log)
 * so a single request can be followed across logs and traces.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = (req.header('x-request-id') ?? '').trim();
  // Ignore absurd/abusive values; correlation ids should be short tokens.
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();

  req.id = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('X-Request-ID', requestId);
  next();
}
