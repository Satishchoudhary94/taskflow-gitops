import { Router } from 'express';
import { isDatabaseReachable } from '../db/pool';
import { isShuttingDown } from '../utils/lifecycle';

export const healthRouter = Router();

/**
 * Liveness: "is this process alive?" Always 200 while the event loop runs.
 * Deliberately does NOT check the database — a dead DB must not make
 * Kubernetes restart healthy pods (that's readiness's job).
 */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Readiness: "should this instance receive traffic?"
 * 503 when the database is unreachable or the process is draining during
 * graceful shutdown, so load balancers / kube-proxy stop routing to it.
 */
healthRouter.get('/ready', async (_req, res) => {
  if (isShuttingDown()) {
    res.status(503).json({ status: 'shutting_down', database: 'unknown' });
    return;
  }
  const databaseUp = await isDatabaseReachable();
  if (!databaseUp) {
    res.status(503).json({ status: 'not_ready', database: 'disconnected' });
    return;
  }
  res.json({ status: 'ready', database: 'connected' });
});
