import type { Request, Response } from 'express';
import { taskService } from '../services/taskService';
import type { taskCreateSchema, taskQuerySchema, taskUpdateSchema } from '../models/schemas';
import type { z } from 'zod';

export const taskController = {
  async create(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof taskCreateSchema>;
    const task = await taskService.create(String(req.params.projectId), req.user!.id, body);
    res.status(201).json({ task });
  },

  async listByProject(req: Request, res: Response): Promise<void> {
    const filters = (req.validated?.query ?? {}) as z.infer<typeof taskQuerySchema>;
    const tasks = await taskService.listByProject(String(req.params.projectId), req.user!.id, filters);
    res.json({ tasks });
  },

  async get(req: Request, res: Response): Promise<void> {
    const task = await taskService.get(String(req.params.taskId), req.user!.id);
    res.json({ task });
  },

  async update(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof taskUpdateSchema>;
    const task = await taskService.update(String(req.params.taskId), req.user!.id, body);
    res.json({ task });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await taskService.delete(String(req.params.taskId), req.user!.id);
    res.status(204).end();
  },
};
