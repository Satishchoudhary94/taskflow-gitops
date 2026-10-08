import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../observability/logger';
import { hashPassword } from '../utils/password';

/**
 * Development seed data.
 *
 * Creates two demo users, a workspace with both as members, projects, tasks
 * and comments — enough data to explore the UI and dashboards immediately.
 *
 * Idempotent: if the demo user already exists, nothing is inserted.
 *
 * Run with: npm run seed   (or `node dist/db/seed.js` in the container)
 *
 * Demo credentials:
 *   demo@taskflow.dev  / DemoPass123
 *   alice@taskflow.dev / DemoPass123
 */

const DEMO_PASSWORD = 'DemoPass123';

async function seed(pool: Pool): Promise<void> {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', ['demo@taskflow.dev']);
  if (existing.rowCount && existing.rowCount > 0) {
    logger.info('Seed data already present, skipping');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      rows: [demo],
    } = await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['demo@taskflow.dev', 'Demo User', passwordHash],
    );
    const {
      rows: [alice],
    } = await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['alice@taskflow.dev', 'Alice Kumar', passwordHash],
    );

    const {
      rows: [workspace],
    } = await client.query(
      `INSERT INTO workspaces (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id`,
      ['My Company', 'Demo workspace for exploring TaskFlow', demo.id],
    );

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
         ($1, $2, 'OWNER'), ($1, $3, 'MEMBER')`,
      [workspace.id, demo.id, alice.id],
    );

    const projectDefs = [
      ['Website Redesign', 'Revamp the marketing site', '#6366f1'],
      ['Mobile Application', 'iOS and Android client', '#0ea5e9'],
      ['Infrastructure Migration', 'Move workloads to Kubernetes', '#f59e0b'],
      ['DevOps Platform', 'Internal developer platform', '#10b981'],
    ];
    const projectIds: string[] = [];
    for (const [name, description, color] of projectDefs) {
      const {
        rows: [project],
      } = await client.query(
        `INSERT INTO projects (workspace_id, name, description, color, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspace.id, name, description, color, demo.id],
      );
      projectIds.push(project.id);
    }

    const today = new Date();
    const dateOffset = (days: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    };

    const taskDefs: Array<[number, string, string, string, string, string | null, string | null]> = [
      [0, 'Design new landing page', 'Hero section, pricing, testimonials', 'IN_PROGRESS', 'HIGH', demo.id, dateOffset(3)],
      [0, 'Migrate blog to CMS', 'Move posts, keep URLs stable', 'TODO', 'MEDIUM', alice.id, dateOffset(10)],
      [0, 'Fix mobile navigation bug', 'Menu does not close after navigation', 'IN_REVIEW', 'URGENT', demo.id, dateOffset(-2)],
      [1, 'Set up push notifications', 'FCM for Android, APNs for iOS', 'TODO', 'HIGH', alice.id, dateOffset(7)],
      [1, 'Offline mode spike', 'Investigate local-first sync options', 'TODO', 'LOW', null, null],
      [2, 'Write Dockerfiles', 'Multi-stage builds, non-root user', 'DONE', 'HIGH', demo.id, dateOffset(-5)],
      [2, 'Cluster capacity planning', 'Node sizing and autoscaling targets', 'IN_PROGRESS', 'MEDIUM', demo.id, dateOffset(5)],
      [3, 'Golden path templates', 'Service scaffolding for new teams', 'TODO', 'MEDIUM', alice.id, dateOffset(14)],
      [3, 'Set up observability stack', 'Prometheus, Loki, Tempo, Grafana', 'IN_PROGRESS', 'URGENT', demo.id, dateOffset(1)],
    ];

    const taskIds: string[] = [];
    for (const [projectIdx, title, description, status, priority, assigneeId, dueDate] of taskDefs) {
      const {
        rows: [task],
      } = await client.query(
        `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, due_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [projectIds[projectIdx], title, description, status, priority, assigneeId, dueDate, demo.id],
      );
      taskIds.push(task.id);
    }

    await client.query(
      `INSERT INTO comments (task_id, user_id, content) VALUES
         ($1, $2, 'First draft is up — feedback welcome.'),
         ($1, $3, 'Looks great, can we tweak the CTA color?'),
         ($4, $2, 'Blocked on APNs certificates, chasing it.')`,
      [taskIds[0], demo.id, alice.id, taskIds[3]],
    );

    await client.query('COMMIT');
    logger.info('Seed data inserted (demo@taskflow.dev / DemoPass123)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    await seed(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Seeding failed');
      process.exit(1);
    });
}
