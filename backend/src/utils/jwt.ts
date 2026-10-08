import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload {
  /** User id (standard JWT subject claim). */
  sub: string;
  email: string;
  name: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiration as jwt.SignOptions['expiresIn'],
  });
}

/** Throws (jwt.JsonWebTokenError / TokenExpiredError) when invalid. */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwt.secret);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new jwt.JsonWebTokenError('Unexpected token payload');
  }
  return decoded as unknown as TokenPayload;
}
