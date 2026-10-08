import { pool } from '../db/pool';
import type { Comment } from '../models/types';

const COLUMNS = `
  c.id, c.task_id AS "taskId", c.user_id AS "userId", u.name AS "userName",
  c.content, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
`;
const FROM = `FROM comments c JOIN users u ON u.id = c.user_id`;

export const commentRepository = {
  async create(taskId: string, userId: string, content: string): Promise<Comment> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO comments (task_id, user_id, content) VALUES ($1, $2, $3) RETURNING id`,
      [taskId, userId, content],
    );
    return (await this.findById(rows[0].id)) as Comment;
  },

  async listByTask(taskId: string): Promise<Comment[]> {
    const { rows } = await pool.query<Comment>(
      `SELECT ${COLUMNS} ${FROM} WHERE c.task_id = $1 ORDER BY c.created_at`,
      [taskId],
    );
    return rows;
  },

  async findById(id: string): Promise<Comment | null> {
    const { rows } = await pool.query<Comment>(
      `SELECT ${COLUMNS} ${FROM} WHERE c.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async update(id: string, content: string): Promise<Comment | null> {
    const result = await pool.query(`UPDATE comments SET content = $2 WHERE id = $1`, [
      id,
      content,
    ]);
    if ((result.rowCount ?? 0) === 0) return null;
    return this.findById(id);
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM comments WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
