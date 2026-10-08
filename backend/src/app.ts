import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { registry } from './observability/metrics';
import { requestContext } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { apiRouter } from './routes/api';
import { logger } from './observability/logger';

/**
 * Assembles the Express application (no listening socket — that lives in
 * server.ts so tests can drive the app with supertest directly).
 *
 * Middleware order matters:
 *   correlation id → access log → metrics → security headers → CORS →
 *   body parsing → routes → 404 → central error handler
 */
export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  // Respect X-Forwarded-* from the ingress/load balancer in front of us.
  app.set('trust proxy', true);

  app.use(requestContext);
  app.use(requestLogger);
  app.use(metricsMiddleware);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
    }),
  );

  // Reject oversized bodies before they reach any handler.
  app.use(express.json({ limit: config.bodyLimit }));

  // Operational endpoints (unauthenticated by design; restrict at the
  // network/ingress layer in real deployments).
  app.use(healthRouter);
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  if (config.enableDebugEndpoints) {
    // Required lazily so the failure-injection code isn't even loaded when off.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { debugRouter } = require('./routes/debug') as typeof import('./routes/debug');
    app.use('/debug', debugRouter);
    logger.warn('Debug endpoints are ENABLED (/debug/*) — never enable in production');
  }

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
