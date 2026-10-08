import { workspaceRepository } from '../repositories/workspaceRepository';
import { userRepository } from '../repositories/userRepository';
import { Errors } from '../utils/errors';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '../models/types';

/**
 * Workspace business rules and authorization.
 *
 * Access model:
 *   - Non-members get 404 (not 403) so workspace ids can't be enumerated.
 *   - OWNER: everything, cannot be removed.
 *   - ADMIN: manage workspace settings and members.
 *   - MEMBER: read the workspace, work on projects/tasks, leave.
 */
export const workspaceService = {
  /** Membership gate used by every workspace-scoped operation. */
  async requireMember(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const role = await workspaceRepository.getMemberRole(workspaceId, userId);
    if (!role) throw Errors.notFound('WORKSPACE_NOT_FOUND', 'Workspace not found');
    return role;
  },

  async requireAdmin(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const role = await this.requireMember(workspaceId, userId);
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw Errors.forbidden('Only workspace owners and admins can do this');
    }
    return role;
  },

  async create(userId: string, fields: { name: string; description: string }): Promise<Workspace> {
    return workspaceRepository.create(fields.name, fields.description, userId);
  },

  async list(userId: string): Promise<Workspace[]> {
    return workspaceRepository.listForUser(userId);
  },

  async get(workspaceId: string, userId: string): Promise<Workspace> {
    const role = await this.requireMember(workspaceId, userId);
    const workspace = await workspaceRepository.findById(workspaceId);
    if (!workspace) throw Errors.notFound('WORKSPACE_NOT_FOUND', 'Workspace not found');
    return { ...workspace, role };
  },

  async update(
    workspaceId: string,
    userId: string,
    fields: { name?: string; description?: string },
  ): Promise<Workspace> {
    await this.requireAdmin(workspaceId, userId);
    const updated = await workspaceRepository.update(workspaceId, fields);
    if (!updated) throw Errors.notFound('WORKSPACE_NOT_FOUND', 'Workspace not found');
    return updated;
  },

  async delete(workspaceId: string, userId: string): Promise<void> {
    const role = await this.requireMember(workspaceId, userId);
    if (role !== 'OWNER') {
      throw Errors.forbidden('Only the workspace owner can delete a workspace');
    }
    await workspaceRepository.delete(workspaceId);
  },

  // ------------------------------------------------------------ members

  async listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
    await this.requireMember(workspaceId, userId);
    return workspaceRepository.listMembers(workspaceId);
  },

  async addMember(
    workspaceId: string,
    actingUserId: string,
    email: string,
    role: 'ADMIN' | 'MEMBER',
  ): Promise<WorkspaceMember[]> {
    await this.requireAdmin(workspaceId, actingUserId);

    const user = await userRepository.findByEmail(email);
    if (!user) throw Errors.notFound('USER_NOT_FOUND', 'No user exists with this email');

    const existingRole = await workspaceRepository.getMemberRole(workspaceId, user.id);
    if (existingRole) {
      throw Errors.conflict('ALREADY_MEMBER', 'This user is already a workspace member');
    }

    await workspaceRepository.addMember(workspaceId, user.id, role);
    return workspaceRepository.listMembers(workspaceId);
  },

  async removeMember(
    workspaceId: string,
    actingUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const actingRole = await this.requireMember(workspaceId, actingUserId);
    const targetRole = await workspaceRepository.getMemberRole(workspaceId, targetUserId);
    if (!targetRole) throw Errors.notFound('MEMBER_NOT_FOUND', 'User is not a workspace member');

    if (targetRole === 'OWNER') {
      throw Errors.forbidden('The workspace owner cannot be removed');
    }

    const removingSelf = actingUserId === targetUserId;
    const actingIsAdmin = actingRole === 'OWNER' || actingRole === 'ADMIN';
    // Members may leave on their own; removing OTHERS requires admin rights.
    if (!removingSelf && !actingIsAdmin) {
      throw Errors.forbidden('Only workspace owners and admins can remove members');
    }

    await workspaceRepository.removeMember(workspaceId, targetUserId);
  },
};
