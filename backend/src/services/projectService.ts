import { projectRepository } from '../repositories/projectRepository';
import { workspaceService } from './workspaceService';
import { Errors } from '../utils/errors';
import type { Project } from '../models/types';

/**
 * Project rules. Any workspace member can manage projects (Asana-style);
 * the hard boundary is workspace membership, enforced for every call.
 */
export const projectService = {
  /** Loads a project and verifies the user can access its workspace. */
  async getAccessible(projectId: string, userId: string): Promise<Project> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw Errors.notFound('PROJECT_NOT_FOUND', 'Project not found');
    try {
      await workspaceService.requireMember(project.workspaceId, userId);
    } catch {
      // Hide existence from non-members.
      throw Errors.notFound('PROJECT_NOT_FOUND', 'Project not found');
    }
    return project;
  },

  async create(
    workspaceId: string,
    userId: string,
    fields: { name: string; description: string; color: string },
  ): Promise<Project> {
    await workspaceService.requireMember(workspaceId, userId);
    return projectRepository.create(workspaceId, fields, userId);
  },

  async listByWorkspace(workspaceId: string, userId: string): Promise<Project[]> {
    await workspaceService.requireMember(workspaceId, userId);
    return projectRepository.listByWorkspace(workspaceId);
  },

  async get(projectId: string, userId: string): Promise<Project> {
    return this.getAccessible(projectId, userId);
  },

  async update(
    projectId: string,
    userId: string,
    fields: { name?: string; description?: string; color?: string },
  ): Promise<Project> {
    await this.getAccessible(projectId, userId);
    const updated = await projectRepository.update(projectId, fields);
    if (!updated) throw Errors.notFound('PROJECT_NOT_FOUND', 'Project not found');
    return updated;
  },

  async delete(projectId: string, userId: string): Promise<void> {
    await this.getAccessible(projectId, userId);
    await projectRepository.delete(projectId);
  },
};
