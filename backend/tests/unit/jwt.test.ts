import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../../src/utils/jwt';
import { config } from '../../src/config';

describe('jwt utils', () => {
  const payload = { sub: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'A' };

  it('signs and verifies a token round-trip', () => {
    const token = signToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.name).toBe(payload.name);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(payload, 'some-other-secret');
    expect(() => verifyToken(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(payload, config.jwt.secret, { expiresIn: '-1s' });
    expect(() => verifyToken(expired)).toThrow(jwt.TokenExpiredError);
  });

  it('rejects garbage input', () => {
    expect(() => verifyToken('not-a-token')).toThrow();
  });
});
