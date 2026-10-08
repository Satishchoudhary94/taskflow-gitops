// OpenTelemetry MUST load before http/express/pg so it can instrument them.
import { shutdownTelemetry } from './observability/telemetry';
import http from 'http';
import { config } from './config';
import { logger } from './observability/logger';
import { createApp } from './app';
import { closePool } from './db/pool';
import { markShuttingDown } from './utils/lifecycle';

/**
 * Process entrypoint: HTTP server + graceful shutdown.
 *
 * Shutdown sequence (SIGTERM from Kubernetes / SIGINT from a terminal):
 *   1. mark not-ready         → /ready returns 503, LB drains this instance
 *   2. server.close()         → stop accepting new connections
 *   3. in-flight requests finish (idle keep-alive connections are closed)
 *   4. close the DB pool, flush traces
 *   5. exit 0 — or exit 1 if the deadline (SHUTDOWN_TIMEOUT_MS) passes first
 */
const app = createApp();
const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  logger.info(
    {
      port: config.port,
      host: config.host,
      env: config.env,
      debugEndpoints: config.enableDebugEndpoints,
    },
    'TaskFlow backend listening',
  );
});

let shutdownStarted = false;

function shutdown(signal: string): void {
  if (shutdownStarted) return;
  shutdownStarted = true;

  logger.info({ signal }, 'Graceful shutdown initiated');
  markShuttingDown();

  const forceExit = setTimeout(() => {
    logger.error(
      { timeoutMs: config.shutdownTimeoutMs },
      'Shutdown deadline exceeded, forcing exit',
    );
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  server.close((err) => {
    void (async () => {
      if (err) logger.error({ err }, 'Error while closing HTTP server');
      try {
        await closePool();
        logger.info('Database pool closed');
      } catch (poolErr) {
        logger.error({ err: poolErr }, 'Error closing database pool');
      }
      await shutdownTelemetry();
      logger.info('Graceful shutdown complete');
      process.exit(err ? 1 : 0);
    })();
  });

  // Keep-alive connections with no active request would otherwise hold
  // server.close() open until the force-exit deadline.
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  // State is unknown after an uncaught exception — log and let the
  // orchestrator restart us (crash-only design).
  logger.fatal({ err, stack: err.stack }, 'Uncaught exception, exiting');
  process.exit(1);
});
