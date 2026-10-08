import { http } from './client';
import type {
  AuthResponse,
  Comment,
  Dashboard,
  Project,
  Task,
  TaskFilters,
  TaskPriority,
  TaskStatus,
  User,
  Workspace,
  WorkspaceMember,
} from './types';

export const authApi = {
  register: (email: string, name: string, password: string) =>
    http.post<AuthResponse>('/api/auth/register', { email, name, password }),
  login: (email: string, password: string) =>
    http.post<AuthResponse>('/api/auth/login', { email, password }),
  logout: () => http.post<void>('/api/auth/logout'),
  me: () => http.get<{ user: User }>('/api/auth/me'),
};

export const dashboardApi = {
  get: () => http.get<Dashboard>('/api/dashboard'),
};

export const workspaceApi = {
  list: () => http.get<{ workspaces: Workspace[] }>('/api/workspaces'),
  get: (id: string) => http.get<{ workspace: Workspace }>(`/api/workspaces/${id}`),
  create: (name: string, description: string) =>
    http.post<{ workspace: Workspace }>('/api/workspaces', { name, description }),
  update: (id: string, fields: { name?: string; description?: string }) =>
    http.patch<{ workspace: Workspace }>(`/api/workspaces/${id}`, fields),
  remove: (id: string) => http.delete<void>(`/api/workspaces/${id}`),

  listMembers: (id: string) =>
    http.get<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),
  addMember: (id: string, email: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') =>
    http.post<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`, { email, role }),
  removeMember: (id: string, userId: string) =>
    http.delete<void>(`/api/workspaces/${id}/members/${userId}`),
};

export const projectApi = {
  listByWorkspace: (workspaceId: string) =>
    http.get<{ projects: Project[] }>(`/api/workspaces/${workspaceId}/projects`),
  get: (id: string) => http.get<{ project: Project }>(`/api/projects/${id}`),
  create: (workspaceId: string, fields: { name: string; description?: string; color?: string }) =>
    http.post<{ project: Project }>(`/api/workspaces/${workspaceId}/projects`, fields),
  update: (id: string, fields: { name?: string; description?: string; color?: string }) =>
    http.patch<{ project: Project }>(`/api/projects/${id}`, fields),
  remove: (id: string) => http.delete<void>(`/api/projects/${id}`),
};

export interface TaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export const taskApi = {
  listByProject: (projectId: string, filters: TaskFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
    if (filters.search) params.set('search', filters.search);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return http.get<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks${suffix}`);
  },
  get: (id: string) => http.get<{ task: Task }>(`/api/tasks/${id}`),
  create: (projectId: string, fields: TaskInput & { title: string }) =>
    http.post<{ task: Task }>(`/api/projects/${projectId}/tasks`, fields),
  update: (id: string, fields: TaskInput) => http.patch<{ task: Task }>(`/api/tasks/${id}`, fields),
  remove: (id: string) => http.delete<void>(`/api/tasks/${id}`),
};

export const commentApi = {
  listByTask: (taskId: string) => http.get<{ comments: Comment[] }>(`/api/tasks/${taskId}/comments`),
  create: (taskId: string, content: string) =>
    http.post<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, { content }),
  update: (id: string, content: string) =>
    http.patch<{ comment: Comment }>(`/api/comments/${id}`, { content }),
  remove: (id: string) => http.delete<void>(`/api/comments/${id}`),
};
