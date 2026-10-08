import { taskRepository } from '../repositories/taskRepository';
import { workspaceRepository } from '../repositories/workspaceRepository';
import { projectService } from './projectService';
import { Errors } from '../utils/errors';
import type { Task, TaskFilters, TaskPriority, TaskStatus } from '../models/types';

interface TaskInput {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

/**
 * Task rules. Access is derived: task → project → workspace membership.
 * Assignees must themselves be members of the task's workspace.
 */
export const taskService = {
  async getAccessible(taskId: string, userId: string): Promise<Task> {
    const task = await taskRepository.findById(taskId);
    if (!task) throw Errors.notFound('TASK_NOT_FOUND', 'Task not found');
    try {
      await projectService.getAccessible(task.projectId, userId);
    } catch {
      throw Errors.notFound('TASK_NOT_FOUND', 'Task not found');
    }
    return task;
  },

  async assertAssigneeIsMember(workspaceId: string, assigneeId: string): Promise<void> {
    const role = await workspaceRepository.getMemberRole(workspaceId, assigneeId);
    if (!role) {
      throw Errors.badRequest(
        'ASSIGNEE_NOT_MEMBER',
        'The assignee must be a member of this workspace',
      );
    }
  },

  async create(projectId: string, userId: string, input: TaskInput): Promise<Task> {
    const project = await projectService.getAccessible(projectId, userId);
    if (input.assigneeId) {
      await this.assertAssigneeIsMember(project.workspaceId, input.assigneeId);
    }
    return taskRepository.create(
      projectId,
      {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
      },
      userId,
    );
  },

  async listByProject(projectId: string, userId: string, filters: TaskFilters): Promise<Task[]> {
    await projectService.getAccessible(projectId, userId);
    return taskRepository.listByProject(projectId, filters);
  },

  async get(taskId: string, userId: string): Promise<Task> {
    return this.getAccessible(taskId, userId);
  },

  async update(taskId: string, userId: string, input: Partial<TaskInput>): Promise<Task> {
    const task = await this.getAccessible(taskId, userId);
    if (input.assigneeId) {
      const project = await projectService.getAccessible(task.projectId, userId);
      await this.assertAssigneeIsMember(project.workspaceId, input.assigneeId);
    }
    const updated = await taskRepository.update(taskId, input);
    if (!updated) throw Errors.notFound('TASK_NOT_FOUND', 'Task not found');
    return updated;
  },

  async delete(taskId: string, userId: string): Promise<void> {
    await this.getAccessible(taskId, userId);
    await taskRepository.delete(taskId);
  },
};
