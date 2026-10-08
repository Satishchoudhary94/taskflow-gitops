/** API types mirroring the backend contracts. */

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  role?: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  color: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceName?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  workspaceId?: string;
}

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  stats: {
    assignedToMe: number;
    completed: number;
    overdue: number;
    dueSoon: number;
    byStatus: Record<TaskStatus, number>;
  };
  myTasks: Task[];
  overdueTasks: Task[];
  upcomingTasks: Task[];
  recentProjects: Project[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface TaskFilters {
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  assigneeId?: string;
  search?: string;
}
