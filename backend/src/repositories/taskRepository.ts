import { pool } from '../db/pool';
import type { Task, TaskFilters, TaskStatus } from '../models/types';

const COLUMNS = `
  t.id, t.project_id AS "projectId", t.title, t.description, t.status, t.priority,
  t.assignee_id AS "assigneeId", u.name AS "assigneeName",
  to_char(t.due_date, 'YYYY-MM-DD') AS "dueDate",
  t.created_by AS "createdBy", t.created_at AS "createdAt", t.updated_at AS "updatedAt"
`;
const FROM = `FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;

export interface TaskCreateFields {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Task['priority'];
  assigneeId: string | null;
  dueDate: string | null;
}

export const taskRepository = {
  async create(projectId: string, fields: TaskCreateFields, createdBy: string): Promise<Task> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        projectId,
        fields.title,
        fields.description,
        fields.status,
        fields.priority,
        fields.assigneeId,
        fields.dueDate,
        createdBy,
      ],
    );
    return (await this.findById(rows[0].id)) as Task;
  },

  async listByProject(projectId: string, filters: TaskFilters): Promise<Task[]> {
    const conditions = ['t.project_id = $1'];
    const params: unknown[] = [projectId];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (filters.priority) {
      params.push(filters.priority);
      conditions.push(`t.priority = $${params.length}`);
    }
    if (filters.assigneeId) {
      params.push(filters.assigneeId);
      conditions.push(`t.assignee_id = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(
        `(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`,
      );
    }

    const { rows } = await pool.query<Task>(
      `SELECT ${COLUMNS} ${FROM}
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC`,
      params,
    );
    return rows;
  },

  async findById(id: string): Promise<Task | null> {
    const { rows } = await pool.query<Task>(
      `SELECT ${COLUMNS} ${FROM} WHERE t.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Partial update; undefined fields are left untouched (explicit null clears). */
  async update(
    id: string,
    fields: Partial<TaskCreateFields>,
  ): Promise<Task | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];

    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (fields.title !== undefined) push('title', fields.title);
    if (fields.description !== undefined) push('description', fields.description);
    if (fields.status !== undefined) push('status', fields.status);
    if (fields.priority !== undefined) push('priority', fields.priority);
    if (fields.assigneeId !== undefined) push('assignee_id', fields.assigneeId);
    if (fields.dueDate !== undefined) push('due_date', fields.dueDate);

    if (sets.length === 0) return this.findById(id);

    const result = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return this.findById(id);
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  // ------------------------------------------------------------ dashboard

  /** Tasks assigned to the user across all their workspaces. */
  async listAssignedToUser(userId: string, limit = 50): Promise<Array<Task & { projectName: string; workspaceId: string }>> {
    const { rows } = await pool.query<Task & { projectName: string; workspaceId: string }>(
      `SELECT ${COLUMNS}, p.name AS "projectName", p.workspace_id AS "workspaceId"
       ${FROM}
       JOIN projects p ON p.id = t.project_id
       WHERE t.assignee_id = $1 AND t.status <> 'DONE'
       ORDER BY t.due_date ASC NULLS LAST, t.priority DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  },

  async statsForUser(userId: string): Promise<{
    byStatus: Record<string, number>;
    overdue: number;
    dueSoon: number;
    assignedToMe: number;
    completed: number;
  }> {
    // One pass over the tasks visible to the user (their workspaces).
    const { rows } = await pool.query<{
      status: TaskStatus;
      total: string;
      mine: string;
      overdue: string;
      due_soon: string;
    }>(
      `SELECT t.status,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE t.assignee_id = $1 AND t.status <> 'DONE') AS mine,
              COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'DONE') AS overdue,
              COUNT(*) FILTER (
                WHERE t.due_date >= CURRENT_DATE
                  AND t.due_date < CURRENT_DATE + 8
                  AND t.status <> 'DONE'
              ) AS due_soon
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       JOIN workspace_members m ON m.workspace_id = p.workspace_id
       WHERE m.user_id = $1
       GROUP BY t.status`,
      [userId],
    );

    const byStatus: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 };
    let overdue = 0;
    let dueSoon = 0;
    let assignedToMe = 0;
    for (const row of rows) {
      byStatus[row.status] = Number(row.total);
      overdue += Number(row.overdue);
      dueSoon += Number(row.due_soon);
      assignedToMe += Number(row.mine);
    }
    return { byStatus, overdue, dueSoon, assignedToMe, completed: byStatus.DONE };
  },

  /** Overdue + upcoming (next 7 days) tasks visible to the user. */
  async listByDueWindow(
    userId: string,
    window: 'overdue' | 'upcoming',
    limit = 20,
  ): Promise<Array<Task & { projectName: string }>> {
    const condition =
      window === 'overdue'
        ? `t.due_date < CURRENT_DATE`
        : `t.due_date >= CURRENT_DATE AND t.due_date < CURRENT_DATE + 8`;
    const { rows } = await pool.query<Task & { projectName: string }>(
      `SELECT ${COLUMNS}, p.name AS "projectName"
       ${FROM}
       JOIN projects p ON p.id = t.project_id
       JOIN workspace_members m ON m.workspace_id = p.workspace_id
       WHERE m.user_id = $1 AND t.status <> 'DONE' AND ${condition}
       ORDER BY t.due_date ASC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  },
};
