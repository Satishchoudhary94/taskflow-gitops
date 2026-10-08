import { pool } from '../db/pool';
import type { Project } from '../models/types';

const COLUMNS = `
  id, workspace_id AS "workspaceId", name, description, color,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const projectRepository = {
  async create(
    workspaceId: string,
    fields: { name: string; description: string; color: string },
    createdBy: string,
  ): Promise<Project> {
    const { rows } = await pool.query<Project>(
      `INSERT INTO projects (workspace_id, name, description, color, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [workspaceId, fields.name, fields.description, fields.color, createdBy],
    );
    return rows[0];
  },

  async listByWorkspace(workspaceId: string): Promise<Project[]> {
    const { rows } = await pool.query<Project>(
      `SELECT ${COLUMNS} FROM projects WHERE workspace_id = $1 ORDER BY created_at`,
      [workspaceId],
    );
    return rows;
  },

  async findById(id: string): Promise<Project | null> {
    const { rows } = await pool.query<Project>(
      `SELECT ${COLUMNS} FROM projects WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async update(
    id: string,
    fields: { name?: string; description?: string; color?: string },
  ): Promise<Project | null> {
    const { rows } = await pool.query<Project>(
      `UPDATE projects
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           color = COALESCE($4, color)
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, fields.name ?? null, fields.description ?? null, fields.color ?? null],
    );
    return rows[0] ?? null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  /** Most recently updated projects across all of a user's workspaces. */
  async listRecentForUser(userId: string, limit = 5): Promise<Array<Project & { workspaceName: string }>> {
    const { rows } = await pool.query<Project & { workspaceName: string }>(
      `SELECT p.id, p.workspace_id AS "workspaceId", p.name, p.description, p.color,
              p.created_by AS "createdBy", p.created_at AS "createdAt",
              p.updated_at AS "updatedAt", w.name AS "workspaceName"
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
       JOIN workspace_members m ON m.workspace_id = p.workspace_id
       WHERE m.user_id = $1
       ORDER BY p.updated_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  },
};
