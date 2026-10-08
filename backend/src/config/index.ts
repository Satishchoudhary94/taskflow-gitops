import 'dotenv/config';

/**
 * Central, typed application configuration.
 *
 * Every value comes from an environment variable so the same container image
 * can run in Docker Compose, Kubernetes, or anywhere else without a rebuild
 * (12-factor config). Nothing outside this module reads process.env directly.
 */

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer environment value, got "${value}"`);
  }
  return parsed;
}

const env = process.env.NODE_ENV ?? 'development';

let jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  if (env === 'production') {
    // Fail fast: booting a production instance without a signing secret is a
    // misconfiguration, not something to paper over with a default.
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  jwtSecret = 'taskflow-dev-only-insecure-secret';
}

export const config = {
  env,
  isProduction: env === 'production',
  port: intFromEnv(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'taskflow-backend',

  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: intFromEnv(process.env.DATABASE_PORT, 5432),
    name: process.env.DATABASE_NAME ?? 'taskflow',
    user: process.env.DATABASE_USER ?? 'taskflow',
    password: process.env.DATABASE_PASSWORD ?? '',
    poolMax: intFromEnv(process.env.DATABASE_POOL_MAX, 10),
  },

  jwt: {
    secret: jwtSecret,
    expiration: process.env.JWT_EXPIRATION ?? '1d',
  },

  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  bodyLimit: process.env.BODY_LIMIT ?? '100kb',

  enableDebugEndpoints: process.env.ENABLE_DEBUG_ENDPOINTS === 'true',
  shutdownTimeoutMs: intFromEnv(process.env.SHUTDOWN_TIMEOUT_MS, 10000),
} as const;
