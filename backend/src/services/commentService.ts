import { commentRepository } from '../repositories/commentRepository';
import { workspaceRepository } from '../repositories/workspaceRepository';
import { projectRepository } from '../repositories/projectRepository';
import { taskService } from './taskService';
import { Errors } from '../utils/errors';
import type { Comment } from '../models/types';

/**
 * Comment rules:
 *   - any workspace member can read/write comments on tasks they can access
 *   - only the AUTHOR can edit a comment
 *   - the author OR a workspace OWNER/ADMIN can delete a comment
 */
export const commentService = {
  async listByTask(taskId: string, userId: string): Promise<Comment[]> {
    await taskService.getAccessible(taskId, userId);
    return commentRepository.listByTask(taskId);
  },

  async create(taskId: string, userId: string, content: string): Promise<Comment> {
    await taskService.getAccessible(taskId, userId);
    return commentRepository.create(taskId, userId, content);
  },

  /** Loads a comment the user can see (member of the task's workspace). */
  async getAccessible(commentId: string, userId: string): Promise<Comment> {
    const comment = await commentRepository.findById(commentId);
    if (!comment) throw Errors.notFound('COMMENT_NOT_FOUND', 'Comment not found');
    try {
      await taskService.getAccessible(comment.taskId, userId);
    } catch {
      throw Errors.notFound('COMMENT_NOT_FOUND', 'Comment not found');
    }
    return comment;
  },

  async update(commentId: string, userId: string, content: string): Promise<Comment> {
    const comment = await this.getAccessible(commentId, userId);
    if (comment.userId !== userId) {
      throw Errors.forbidden('Only the comment author can edit a comment');
    }
    const updated = await commentRepository.update(commentId, content);
    if (!updated) throw Errors.notFound('COMMENT_NOT_FOUND', 'Comment not found');
    return updated;
  },

  async delete(commentId: string, userId: string): Promise<void> {
    const comment = await this.getAccessible(commentId, userId);
    if (comment.userId !== userId) {
      // Not the author — allow only workspace OWNER/ADMIN to moderate.
      const task = await taskService.getAccessible(comment.taskId, userId);
      const project = await projectRepository.findById(task.projectId);
      const role = project
        ? await workspaceRepository.getMemberRole(project.workspaceId, userId)
        : null;
      if (role !== 'OWNER' && role !== 'ADMIN') {
        throw Errors.forbidden('Only the author or a workspace admin can delete a comment');
      }
    }
    await commentRepository.delete(commentId);
  },
};
