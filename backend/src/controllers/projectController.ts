import type { Request, Response } from 'express';
import { projectService } from '../services/projectService';
import type { projectCreateSchema, projectUpdateSchema } from '../models/schemas';
import type { z } from 'zod';

export const projectController = {
  async create(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof projectCreateSchema>;
    const project = await projectService.create(String(req.params.workspaceId), req.user!.id, body);
    res.status(201).json({ project });
  },

  async listByWorkspace(req: Request, res: Response): Promise<void> {
    const projects = await projectService.listByWorkspace(String(req.params.workspaceId), req.user!.id);
    res.json({ projects });
  },

  async get(req: Request, res: Response): Promise<void> {
    const project = await projectService.get(String(req.params.projectId), req.user!.id);
    res.json({ project });
  },

  async update(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof projectUpdateSchema>;
    const project = await projectService.update(String(req.params.projectId), req.user!.id, body);
    res.json({ project });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await projectService.delete(String(req.params.projectId), req.user!.id);
    res.status(204).end();
  },
};
