import { taskRepository } from '../repositories/taskRepository';
import { projectRepository } from '../repositories/projectRepository';

/**
 * Aggregates everything the dashboard page needs in one response:
 * my open tasks, task statistics, overdue/upcoming lists and recent projects.
 */
export const dashboardService = {
  async get(userId: string) {
    const [myTasks, stats, overdueTasks, upcomingTasks, recentProjects] = await Promise.all([
      taskRepository.listAssignedToUser(userId),
      taskRepository.statsForUser(userId),
      taskRepository.listByDueWindow(userId, 'overdue'),
      taskRepository.listByDueWindow(userId, 'upcoming'),
      projectRepository.listRecentForUser(userId),
    ]);

    return {
      stats: {
        assignedToMe: stats.assignedToMe,
        completed: stats.completed,
        overdue: stats.overdue,
        dueSoon: stats.dueSoon,
        byStatus: stats.byStatus,
      },
      myTasks,
      overdueTasks,
      upcomingTasks,
      recentProjects,
    };
  },
};
