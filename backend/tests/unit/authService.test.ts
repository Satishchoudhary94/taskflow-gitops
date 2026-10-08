import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authService } from '../../src/services/authService';
import { userRepository } from '../../src/repositories/userRepository';
import { hashPassword } from '../../src/utils/password';
import { AppError } from '../../src/utils/errors';

// Unit test: the repository (and therefore the database) is mocked out.
vi.mock('../../src/repositories/userRepository', () => ({
  userRepository: {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    searchByEmail: vi.fn(),
  },
}));

const mockedRepo = vi.mocked(userRepository);

const storedUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'demo@x.co',
  name: 'Demo',
  createdAt: new Date().toISOString(),
};

describe('authService', () => {
  beforeEach(() => vi.resetAllMocks());

  it('registers a new user and returns a token', async () => {
    mockedRepo.findByEmail.mockResolvedValue(null);
    mockedRepo.create.mockResolvedValue(storedUser);

    const result = await authService.register('demo@x.co', 'Demo', 'Secret123');

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe('demo@x.co');
    // The plaintext password must never be forwarded to the repository.
    const [, , passedHash] = mockedRepo.create.mock.calls[0];
    expect(passedHash).not.toBe('Secret123');
  });

  it('rejects registration when the email is taken (409)', async () => {
    mockedRepo.findByEmail.mockResolvedValue({ ...storedUser, passwordHash: 'x' });

    await expect(authService.register('demo@x.co', 'Demo', 'Secret123')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_ALREADY_EXISTS',
    });
  });

  it('logs in with the correct password', async () => {
    mockedRepo.findByEmail.mockResolvedValue({
      ...storedUser,
      passwordHash: await hashPassword('Secret123'),
    });

    const result = await authService.login('demo@x.co', 'Secret123');
    expect(result.token).toBeTruthy();
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a wrong password with the same error as an unknown email', async () => {
    mockedRepo.findByEmail.mockResolvedValue({
      ...storedUser,
      passwordHash: await hashPassword('Secret123'),
    });
    const wrongPassword = await authService.login('demo@x.co', 'Nope12345').catch((e) => e);

    mockedRepo.findByEmail.mockResolvedValue(null);
    const unknownEmail = await authService.login('ghost@x.co', 'Secret123').catch((e) => e);

    for (const err of [wrongPassword, unknownEmail]) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('INVALID_CREDENTIALS');
      expect(err.message).toBe('Invalid email or password');
    }
  });
});
