import type { NextFunction, Request, Response } from 'express';

// Probe/scrape endpoints are hit every few seconds; log them at debug so
// production logs aren't dominated by health-check noise.
const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);

/** Emits one structured access-log line when each response finishes. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const fields = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration: Math.round(durationMs * 100) / 100,
    };

    if (QUIET_PATHS.has(req.path)) {
      req.log.debug(fields, 'HTTP request completed');
    } else if (res.statusCode >= 500) {
      req.log.error(fields, 'HTTP request completed');
    } else if (res.statusCode >= 400) {
      req.log.warn(fields, 'HTTP request completed');
    } else {
      req.log.info(fields, 'HTTP request completed');
    }
  });

  next();
}
