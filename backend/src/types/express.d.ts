import type { Logger } from 'pino';
import type { AuthUser } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id (incoming X-Request-ID or generated UUID). */
      id: string;
      /** Request-scoped structured logger (carries requestId). */
      log: Logger;
      /** Authenticated identity, set by requireAuth. */
      user?: AuthUser;
      /** Parsed + validated inputs, set by the validate middleware. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
