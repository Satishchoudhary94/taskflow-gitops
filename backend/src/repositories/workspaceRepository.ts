import { pool } from '../db/pool';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '../models/types';

const COLUMNS = `
  w.id, w.name, w.description, w.owner_id AS "ownerId",
  w.created_at AS "createdAt", w.updated_at AS "updatedAt"
`;

export const workspaceRepository = {
  /** Creates the workspace and its OWNER membership row atomically. */
  async create(name: string, description: string, ownerId: string): Promise<Workspace> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<Workspace>(
        `INSERT INTO workspaces (name, description, owner_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, owner_id AS "ownerId",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [name, description, ownerId],
      );
      const workspace = rows[0];
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [workspace.id, ownerId],
      );
      await client.query('COMMIT');
      return { ...workspace, role: 'OWNER' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** All workspaces the user is a member of, with the user's role. */
  async listForUser(userId: string): Promise<Workspace[]> {
    const { rows } = await pool.query<Workspace>(
      `SELECT ${COLUMNS}, m.role
       FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = $1
       ORDER BY w.created_at`,
      [userId],
    );
    return rows;
  },

  async findById(id: string): Promise<Workspace | null> {
    const { rows } = await pool.query<Workspace>(
      `SELECT ${COLUMNS} FROM workspaces w WHERE w.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async update(
    id: string,
    fields: { name?: string; description?: string },
  ): Promise<Workspace | null> {
    const { rows } = await pool.query<Workspace>(
      `UPDATE workspaces w
       SET name = COALESCE($2, name), description = COALESCE($3, description)
       WHERE id = $1
       RETURNING ${COLUMNS.replaceAll('w.', '')}`,
      [id, fields.name ?? null, fields.description ?? null],
    );
    return rows[0] ?? null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  /** null means the user is not a member at all. */
  async getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const { rows } = await pool.query<{ role: WorkspaceRole }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    return rows[0]?.role ?? null;
  },

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { rows } = await pool.query<WorkspaceMember>(
      `SELECT u.id AS "userId", u.email, u.name, m.role, m.created_at AS "joinedAt"
       FROM workspace_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
       ORDER BY m.created_at`,
      [workspaceId],
    );
    return rows;
  },

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
      [workspaceId, userId, role],
    );
  },

  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  },
};
