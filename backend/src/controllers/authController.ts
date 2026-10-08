import type { Request, Response } from 'express';
import { authService } from '../services/authService';
import type { loginSchema, registerSchema } from '../models/schemas';
import type { z } from 'zod';

/**
 * Controllers are deliberately thin: extract validated input, call a service,
 * shape the HTTP response. All rules live in services; all SQL in repositories.
 * Express 5 forwards rejected promises to the error handler automatically.
 */
export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof registerSchema>;
    const result = await authService.register(body.email, body.name, body.password);
    req.log.info({ userId: result.user.id }, 'User registered');
    res.status(201).json(result);
  },

  async login(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof loginSchema>;
    const result = await authService.login(body.email, body.password);
    req.log.info({ userId: result.user.id }, 'User logged in');
    res.json(result);
  },

  /**
   * JWTs are stateless, so logout is client-side (drop the token). The
   * endpoint exists so clients have a consistent call and so a future
   * refresh-token/denylist implementation has a place to live.
   */
  async logout(req: Request, res: Response): Promise<void> {
    req.log.info({ userId: req.user?.id }, 'User logged out');
    res.status(204).end();
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.me(req.user!.id);
    res.json({ user });
  },
};
