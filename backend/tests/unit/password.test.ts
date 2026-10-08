import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('CorrectHorse1');
    expect(hash).not.toContain('CorrectHorse1');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
    await expect(verifyPassword('CorrectHorse1', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('CorrectHorse1');
    await expect(verifyPassword('WrongHorse1', hash)).resolves.toBe(false);
  });

  it('produces a different hash per call (unique salts)', async () => {
    const first = await hashPassword('CorrectHorse1');
    const second = await hashPassword('CorrectHorse1');
    expect(first).not.toEqual(second);
  });
});
