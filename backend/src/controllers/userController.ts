import type { Request, Response } from 'express';
import { userRepository } from '../repositories/userRepository';
import type { userSearchQuerySchema } from '../models/schemas';
import type { z } from 'zod';

export const userController = {
  /** Email search used by the "add member" flow. Requires authentication. */
  async search(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as z.infer<typeof userSearchQuerySchema>;
    const users = await userRepository.searchByEmail(query.search);
    res.json({ users });
  },
};
