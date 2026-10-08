import type { Request, Response } from 'express';
import { dashboardService } from '../services/dashboardService';

export const dashboardController = {
  async get(req: Request, res: Response): Promise<void> {
    const dashboard = await dashboardService.get(req.user!.id);
    res.json(dashboard);
  },
};
