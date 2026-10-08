import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, closePool, isDatabaseReachable } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';

/**
 * API integration tests — exercise the full stack (routes → middleware →
 * services → repositories → PostgreSQL) against a REAL database.
 *
 * Requires a reachable PostgreSQL configured via DATABASE_* env vars.
 * Locally: `docker compose up -d postgres` from the repo root, then
 * `npm run test:integration`.
 *
 * Tests use unique per-run emails, so re-runs against the same database work.
 */

const app = createApp();
const run = Date.now().toString(36);
const owner = { email: `owner-${run}@it.taskflow.dev`, name: 'Owner', password: 'Secret123' };
const member = { email: `member-${run}@it.taskflow.dev`, name: 'Member', password: 'Secret123' };
const outsider = { email: `outsider-${run}@it.taskflow.dev`, name: 'Outsider', password: 'Secret123' };

let ownerToken = '';
let memberToken = '';
let outsiderToken = '';
let memberId = '';
let workspaceId = '';
let projectId = '';
let taskId = '';
let commentId = '';

beforeAll(async () => {
  if (!(await isDatabaseReachable())) {
    throw new Error(
      'Integration tests need PostgreSQL. Start it with: docker compose up -d postgres',
    );
  }
  await runMigrations(pool);
});

afterAll(async () => {
  await closePool();
});

describe('operational endpoints', () => {
  it('GET /health returns ok without touching the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready reports database connectivity', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'connected' });
  });

  it('GET /metrics exposes Prometheus metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('echoes an incoming X-Request-ID and generates one when absent', async () => {
    const echoed = await request(app).get('/health').set('X-Request-ID', 'test-corr-42');
    expect(echoed.headers['x-request-id']).toBe('test-corr-42');

    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('does not expose debug endpoints by default', async () => {
    const res = await request(app).get('/debug/error');
    expect(res.status).toBe(404);
  });
});

describe('authentication', () => {
  it('registers users', async () => {
    for (const user of [owner, member, outsider]) {
      const res = await request(app).post('/api/auth/register').send(user);
      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    }
  });

  it('rejects duplicate registration with 409', async () => {
    const res = await request(app).post('/api/auth/register').send(owner);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects a weak password with field-level details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `weak-${run}@it.taskflow.dev`, name: 'W', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(true);
  });

  it('logs in and rejects bad credentials', async () => {
    const good = await request(app).post('/api/auth/login').send(owner);
    expect(good.status).toBe(200);
    ownerToken = good.body.token;

    memberToken = (await request(app).post('/api/auth/login').send(member)).body.token;
    outsiderToken = (await request(app).post('/api/auth/login').send(outsider)).body.token;
    memberId = (
      await request(app).get('/api/auth/me').set('Authorization', `Bearer ${memberToken}`)
    ).body.user.id;

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'WrongPass1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('protects routes: no token / bad token → 401', async () => {
    expect((await request(app).get('/api/workspaces')).status).toBe(401);
    expect(
      (await request(app).get('/api/workspaces').set('Authorization', 'Bearer nonsense')).status,
    ).toBe(401);
  });
});

describe('workspaces and members', () => {
  it('creates a workspace (creator becomes OWNER)', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Engineering', description: 'Core team' });
    expect(res.status).toBe(201);
    expect(res.body.workspace.role).toBe('OWNER');
    workspaceId = res.body.workspace.id;
  });

  it('lists and reads workspaces', async () => {
    const list = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.workspaces.map((w: { id: string }) => w.id)).toContain(workspaceId);

    const one = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(one.status).toBe(200);
    expect(one.body.workspace.name).toBe('Engineering');
  });

  it('hides workspaces from non-members (404, not 403)', async () => {
    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });

  it('adds a member by email and rejects duplicates', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: member.email });
    expect(res.status).toBe(201);
    expect(res.body.members).toHaveLength(2);

    const dup = await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: member.email });
    expect(dup.status).toBe(409);
  });

  it('forbids a plain MEMBER from updating the workspace', async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('lets an OWNER update the workspace', async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Core platform team' });
    expect(res.status).toBe(200);
    expect(res.body.workspace.description).toBe('Core platform team');
  });
});

describe('projects', () => {
  it('creates and lists projects inside a workspace', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Infrastructure Migration', description: 'Move to K8s' });
    expect(res.status).toBe(201);
    projectId = res.body.project.id;

    const list = await request(app)
      .get(`/api/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(list.status).toBe(200);
    expect(list.body.projects).toHaveLength(1);
  });

  it('hides projects from non-members', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });

  it('updates a project', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ color: '#10b981' });
    expect(res.status).toBe(200);
    expect(res.body.project.color).toBe('#10b981');
  });
});

describe('tasks', () => {
  it('creates a task with defaults', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Write Dockerfiles', description: 'Multi-stage, non-root' });
    expect(res.status).toBe(201);
    expect(res.body.task.status).toBe('TODO');
    expect(res.body.task.priority).toBe('MEDIUM');
    taskId = res.body.task.id;
  });

  it('rejects an invalid status value', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'X', status: 'BLOCKED' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('assigns the task to a workspace member with a due date', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ assigneeId: memberId, dueDate: '2026-09-15', priority: 'HIGH' });
    expect(res.status).toBe(200);
    expect(res.body.task.assigneeId).toBe(memberId);
    expect(res.body.task.assigneeName).toBe(member.name);
    expect(res.body.task.dueDate).toBe('2026-09-15');
  });

  it('refuses to assign a task to a non-member', async () => {
    const outsiderId = (
      await request(app).get('/api/auth/me').set('Authorization', `Bearer ${outsiderToken}`)
    ).body.user.id;
    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ assigneeId: outsiderId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNEE_NOT_MEMBER');
  });

  it('changes status and filters/searches tasks', async () => {
    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ status: 'IN_PROGRESS' });

    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Plan cluster capacity', status: 'DONE', priority: 'LOW' });

    const byStatus = await request(app)
      .get(`/api/projects/${projectId}/tasks?status=IN_PROGRESS`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(byStatus.body.tasks).toHaveLength(1);
    expect(byStatus.body.tasks[0].id).toBe(taskId);

    const bySearch = await request(app)
      .get(`/api/projects/${projectId}/tasks?search=docker`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(bySearch.body.tasks).toHaveLength(1);
    expect(bySearch.body.tasks[0].title).toBe('Write Dockerfiles');

    const badFilter = await request(app)
      .get(`/api/projects/${projectId}/tasks?priority=EXTREME`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(badFilter.status).toBe(400);
  });

  it('returns 404 for a task the user cannot see', async () => {
    const res = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });
});

describe('comments', () => {
  it('adds and lists comments', async () => {
    const res = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: 'Started on the base image.' });
    expect(res.status).toBe(201);
    commentId = res.body.comment.id;
    expect(res.body.comment.userName).toBe(member.name);

    const list = await request(app)
      .get(`/api/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.body.comments).toHaveLength(1);
  });

  it('only the author can edit a comment', async () => {
    const denied = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'edited by someone else' });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: 'Base image done, moving to compose.' });
    expect(ok.status).toBe(200);
  });

  it('a workspace admin can delete another user’s comment', async () => {
    const res = await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);
  });
});

describe('dashboard', () => {
  it('aggregates stats, my tasks and recent projects', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.byStatus).toMatchObject({ IN_PROGRESS: 1, DONE: 1 });
    expect(res.body.stats.assignedToMe).toBe(1);
    expect(res.body.myTasks[0].title).toBe('Write Dockerfiles');
    expect(res.body.recentProjects.length).toBeGreaterThan(0);
  });
});

describe('cleanup and deletion flows', () => {
  it('removes a member', async () => {
    const res = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);

    const denied = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(denied.status).toBe(404);
  });

  it('deletes task, project and workspace (owner only)', async () => {
    expect(
      (
        await request(app)
          .delete(`/api/tasks/${taskId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status,
    ).toBe(204);

    expect(
      (
        await request(app)
          .delete(`/api/projects/${projectId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status,
    ).toBe(204);

    expect(
      (
        await request(app)
          .delete(`/api/workspaces/${workspaceId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status,
    ).toBe(204);

    const gone = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(gone.status).toBe(404);
  });
});
