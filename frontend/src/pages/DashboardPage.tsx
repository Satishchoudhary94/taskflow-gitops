import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/endpoints';
import type { Dashboard, Task } from '../api/types';
import { STATUS_LABELS, TASK_STATUSES } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { DueDate, EmptyState, ErrorBanner, PriorityBadge, Spinner, StatusBadge } from '../components/ui';

function TaskRow({ task }: { task: Task }) {
  return (
    <Link to={`/tasks/${task.id}`} className="task-row">
      <span className="task-row-title">{task.title}</span>
      <span className="task-row-meta">
        {task.projectName && <span className="muted">{task.projectName}</span>}
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
        <DueDate dueDate={task.dueDate} status={task.status} />
      </span>
    </Link>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dashboardApi
      .get()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;

  const { stats } = data;
  const totalTasks = Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Good day, {user?.name.split(' ')[0]} 👋</h1>
          <p className="muted">Here’s what’s happening across your workspaces.</p>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value">{stats.assignedToMe}</span>
          <span className="stat-label">My open tasks</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.completed}</span>
          <span className="stat-label">Completed</span>
        </div>
        <div className="stat-card stat-danger">
          <span className="stat-value">{stats.overdue}</span>
          <span className="stat-label">Overdue</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.dueSoon}</span>
          <span className="stat-label">Due in 7 days</span>
        </div>
      </div>

      <section className="panel">
        <h2>Tasks by status</h2>
        <div className="status-bars">
          {TASK_STATUSES.map((status) => {
            const count = stats.byStatus[status] ?? 0;
            const pct = totalTasks ? Math.round((count / totalTasks) * 100) : 0;
            return (
              <div key={status} className="status-bar-row">
                <span className="status-bar-label">{STATUS_LABELS[status]}</span>
                <div className="status-bar-track">
                  <div
                    className={`status-bar-fill fill-${status.toLowerCase()}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="status-bar-count">{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>My tasks</h2>
          {data.myTasks.length === 0 ? (
            <EmptyState icon="🎉" title="Nothing assigned to you" hint="Enjoy the calm." />
          ) : (
            data.myTasks.map((task) => <TaskRow key={task.id} task={task} />)
          )}
        </section>

        <section className="panel">
          <h2>Needs attention</h2>
          {data.overdueTasks.length === 0 && data.upcomingTasks.length === 0 ? (
            <EmptyState icon="✅" title="No deadlines at risk" />
          ) : (
            <>
              {data.overdueTasks.length > 0 && <h3 className="subhead danger">Overdue</h3>}
              {data.overdueTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {data.upcomingTasks.length > 0 && <h3 className="subhead">Upcoming</h3>}
              {data.upcomingTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Recent projects</h2>
        {data.recentProjects.length === 0 ? (
          <EmptyState
            icon="📁"
            title="No projects yet"
            hint="Create a workspace, then add your first project."
          />
        ) : (
          <div className="card-grid">
            {data.recentProjects.map((project) => (
              <Link key={project.id} to={`/projects/${project.id}`} className="project-card">
                <span className="project-dot" style={{ background: project.color }} />
                <div>
                  <span className="project-name">{project.name}</span>
                  {project.workspaceName && (
                    <span className="muted small">{project.workspaceName}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
