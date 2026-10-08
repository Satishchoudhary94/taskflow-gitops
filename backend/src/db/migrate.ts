import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../observability/logger';

/**
 * Minimal forward-only SQL migration runner.
 *
 * - Reads backend/migrations/*.sql in filename order (001_..., 002_..., ...)
 * - Records applied files in schema_migrations
 * - Applies each pending file inside a transaction
 * - Retries the initial DB connection so it works as a "migrate" init step in
 *   Docker Compose / Kubernetes Jobs where Postgres may still be starting.
 *
 * Run with: npm run migrate   (or `node dist/db/migrate.js` in the container)
 */

// Resolves to backend/migrations from both src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

async function waitForDatabase(pool: Pool, attempts = 30, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger.warn({ attempt: i, attempts }, 'Database not reachable yet, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  await waitForDatabase(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
      logger.info({ migration: file }, 'Migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

async function main(): Promise<void> {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: 2,
  });

  try {
    const appliedNow = await runMigrations(pool);
    logger.info({ appliedNow, count: appliedNow.length }, 'Migrations complete');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration run failed');
      process.exit(1);
    });
}
