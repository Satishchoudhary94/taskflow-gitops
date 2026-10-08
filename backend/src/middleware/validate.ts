import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { Errors } from '../utils/errors';

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Route-level input validation.
 *
 * Parses body/query/params against zod schemas. Parsed (and defaulted /
 * normalized) values are stored on req.validated because Express 5 exposes
 * req.query and req.params as read-only getters.
 *
 * On failure, responds 400 with code VALIDATION_ERROR and a per-field
 * details array — the client can render field-level messages.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
        return next(Errors.badRequest('VALIDATION_ERROR', 'Request validation failed', details));
      }
      next(err);
    }
  };
}

/** Builds a params schema validator for one or more UUID path parameters. */
export function validateUuidParams(...names: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const name of names) {
      const value = req.params[name];
      if (
        typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ) {
        return next(
          Errors.badRequest('VALIDATION_ERROR', 'Request validation failed', [
            { field: name, message: 'must be a valid UUID' },
          ]),
        );
      }
    }
    next();
  };
}
