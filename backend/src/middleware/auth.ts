import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../utils/jwt';
import { Errors } from '../utils/errors';

/**
 * JWT bearer authentication.
 *
 * Verifies `Authorization: Bearer <token>` and attaches the authenticated
 * identity as req.user. Rejects with a consistent 401 for missing, malformed,
 * invalid or expired tokens (no distinction — don't help attackers probe).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return next(Errors.unauthorized());
  }

  try {
    const payload = verifyToken(header.slice('Bearer '.length).trim());
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    next(Errors.unauthorized('Invalid or expired token'));
  }
}
