import { pool } from '../db/pool';
import type { User } from '../models/types';

/** Internal shape including the bcrypt hash — never leaves the service layer. */
export interface UserWithPassword extends User {
  passwordHash: string;
}

const PUBLIC_COLUMNS = `id, email, name, created_at AS "createdAt"`;

export const userRepository = {
  async create(email: string, name: string, passwordHash: string): Promise<User> {
    const { rows } = await pool.query<User>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`,
      [email, name, passwordHash],
    );
    return rows[0];
  },

  async findByEmail(email: string): Promise<UserWithPassword | null> {
    const { rows } = await pool.query<UserWithPassword>(
      `SELECT ${PUBLIC_COLUMNS}, password_hash AS "passwordHash"
       FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ?? null;
  },

  async findById(id: string): Promise<User | null> {
    const { rows } = await pool.query<User>(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Prefix/substring search on email — used when adding workspace members. */
  async searchByEmail(term: string, limit = 10): Promise<User[]> {
    const { rows } = await pool.query<User>(
      `SELECT ${PUBLIC_COLUMNS} FROM users
       WHERE email ILIKE '%' || $1 || '%'
       ORDER BY email
       LIMIT $2`,
      [term, limit],
    );
    return rows;
  },
};
