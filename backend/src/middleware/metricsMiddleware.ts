import type { NextFunction, Request, Response } from 'express';
import {
  httpRequestDurationSeconds,
  httpRequestsInFlight,
  httpRequestsTotal,
} from '../observability/metrics';

/**
 * Records RED metrics for every request.
 *
 * The route label uses the Express route PATTERN (e.g. /api/tasks/:taskId),
 * not the raw URL — raw URLs contain UUIDs and would explode Prometheus label
 * cardinality. Requests that match no route are grouped under "unmatched".
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/metrics') return next();

  httpRequestsInFlight.inc();
  const endTimer = httpRequestDurationSeconds.startTimer();

  res.on('finish', () => {
    const routePattern = req.route?.path
      ? `${req.baseUrl ?? ''}${req.route.path === '/' ? '' : req.route.path}` || '/'
      : res.statusCode === 404
        ? 'unmatched'
        : req.path;

    const labels = {
      method: req.method,
      route: routePattern,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    endTimer(labels);
    httpRequestsInFlight.dec();
  });

  next();
}
