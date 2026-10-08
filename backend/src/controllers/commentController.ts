import type { Request, Response } from 'express';
import { commentService } from '../services/commentService';
import type { commentCreateSchema, commentUpdateSchema } from '../models/schemas';
import type { z } from 'zod';

export const commentController = {
  async listByTask(req: Request, res: Response): Promise<void> {
    const comments = await commentService.listByTask(String(req.params.taskId), req.user!.id);
    res.json({ comments });
  },

  async create(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof commentCreateSchema>;
    const comment = await commentService.create(String(req.params.taskId), req.user!.id, body.content);
    res.status(201).json({ comment });
  },

  async update(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof commentUpdateSchema>;
    const comment = await commentService.update(String(req.params.commentId), req.user!.id, body.content);
    res.json({ comment });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await commentService.delete(String(req.params.commentId), req.user!.id);
    res.status(204).end();
  },
};
