import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../observability/logger';

/**
 * Shared PostgreSQL connection pool.
 *
 * The pool is created lazily on first query; the app process boots even when
 * the database is down (liveness stays green, readiness reports 503) and
 * recovers automatically once PostgreSQL is reachable again.
 */
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: config.database.poolMax,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Idle clients can error (e.g. Postgres restarted). Without a handler this
// would crash the process; with it, the pool discards the client and recovers.
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/** Used by GET /ready — cheap connectivity probe. */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Drain the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
