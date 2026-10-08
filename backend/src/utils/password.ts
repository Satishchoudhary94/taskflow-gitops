import bcrypt from 'bcryptjs';

// 10 rounds ≈ 100ms per hash — the standard cost/security tradeoff for APIs.
const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
