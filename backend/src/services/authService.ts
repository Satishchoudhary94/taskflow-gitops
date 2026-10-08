import { userRepository } from '../repositories/userRepository';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { AppError, Errors } from '../utils/errors';
import type { User } from '../models/types';

export interface AuthResult {
  token: string;
  user: User;
}

export const authService = {
  async register(email: string, name: string, password: string): Promise<AuthResult> {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw Errors.conflict('EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const user = await userRepository.create(email, name, passwordHash);
    return { token: signToken({ sub: user.id, email: user.email, name: user.name }), user };
  },

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await userRepository.findByEmail(email);
    // Same error for unknown email and wrong password — no account probing.
    const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (!user) throw invalid();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw invalid();

    const { passwordHash: _ignored, ...publicUser } = user;
    return {
      token: signToken({ sub: user.id, email: user.email, name: user.name }),
      user: publicUser,
    };
  },

  async me(userId: string): Promise<User> {
    const user = await userRepository.findById(userId);
    if (!user) throw Errors.notFound('USER_NOT_FOUND', 'User not found');
    return user;
  },
};
