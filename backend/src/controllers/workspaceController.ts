import type { Request, Response } from 'express';
import { workspaceService } from '../services/workspaceService';
import type {
  memberAddSchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '../models/schemas';
import type { z } from 'zod';

export const workspaceController = {
  async create(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof workspaceCreateSchema>;
    const workspace = await workspaceService.create(req.user!.id, body);
    res.status(201).json({ workspace });
  },

  async list(req: Request, res: Response): Promise<void> {
    const workspaces = await workspaceService.list(req.user!.id);
    res.json({ workspaces });
  },

  async get(req: Request, res: Response): Promise<void> {
    const workspace = await workspaceService.get(String(req.params.workspaceId), req.user!.id);
    res.json({ workspace });
  },

  async update(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof workspaceUpdateSchema>;
    const workspace = await workspaceService.update(String(req.params.workspaceId), req.user!.id, body);
    res.json({ workspace });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await workspaceService.delete(String(req.params.workspaceId), req.user!.id);
    res.status(204).end();
  },

  async listMembers(req: Request, res: Response): Promise<void> {
    const members = await workspaceService.listMembers(String(req.params.workspaceId), req.user!.id);
    res.json({ members });
  },

  async addMember(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as z.infer<typeof memberAddSchema>;
    const members = await workspaceService.addMember(
      String(req.params.workspaceId),
      req.user!.id,
      body.email,
      body.role,
    );
    res.status(201).json({ members });
  },

  async removeMember(req: Request, res: Response): Promise<void> {
    await workspaceService.removeMember(
      String(req.params.workspaceId),
      req.user!.id,
      String(req.params.userId),
    );
    res.status(204).end();
  },
};
