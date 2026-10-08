import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectApi, taskApi, workspaceApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type {
  Project,
  Task,
  TaskFilters,
  TaskPriority,
  TaskStatus,
  WorkspaceMember,
} from '../api/types';
import { STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from '../api/types';
import { TaskFormModal } from '../components/TaskFormModal';
import {
  Avatar,
  DueDate,
  EmptyState,
  ErrorBanner,
  PriorityBadge,
  Spinner,
  StatusBadge,
} from '../components/ui';

type ViewMode = 'list' | 'board';

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('board');
  const [showTaskModal, setShowTaskModal] = useState(false);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [search, setSearch] = useState('');
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const filters: TaskFilters = useMemo(
    () => ({ status: statusFilter, priority: priorityFilter, search: search.trim() || undefined }),
    [statusFilter, priorityFilter, search],
  );

  // Initial load: project + members (workspace comes from the project).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { project: loaded } = await projectApi.get(projectId);
        if (cancelled) return;
        setProject(loaded);
        const { members: ms } = await workspaceApi.listMembers(loaded.workspaceId);
        if (!cancelled) setMembers(ms);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load project');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Task list reloads whenever filters change (server-side filtering).
  const loadTasks = useCallback(async () => {
    try {
      const { tasks: list } = await taskApi.listByProject(projectId, filters);
      setTasks(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [projectId, filters]);

  useEffect(() => {
    const debounce = setTimeout(() => void loadTasks(), search ? 250 : 0);
    return () => clearTimeout(debounce);
  }, [loadTasks, search]);

  const changeStatus = async (taskId: string, status: TaskStatus) => {
    const previous = tasks;
    // Optimistic move; reconcile with the server response afterwards.
    setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      const { task: updated } = await taskApi.update(taskId, { status });
      setTasks((current) => current.map((t) => (t.id === taskId ? updated : t)));
    } catch (err) {
      setTasks(previous);
      setError(err instanceof ApiError ? err.message : 'Failed to update task');
    }
  };

  const deleteProject = async () => {
    if (!project) return;
    if (!window.confirm(`Delete project "${project.name}" and all of its tasks?`)) return;
    try {
      await projectApi.remove(project.id);
      navigate(`/workspaces/${project.workspaceId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete project');
    }
  };

  if (loading && !project) return <Spinner />;
  if (error && !project) return <ErrorBanner message={error} />;
  if (!project) return null;

  const tasksByStatus = (status: TaskStatus) => tasks.filter((task) => task.status === status);

  return (
    <div className="page">
      <nav className="breadcrumbs">
        <Link to="/workspaces">Workspaces</Link> <span>/</span>{' '}
        <Link to={`/workspaces/${project.workspaceId}`}>Workspace</Link> <span>/</span>{' '}
        <b>{project.name}</b>
      </nav>
      <header className="page-header">
        <div className="project-title">
          <span className="project-dot large" style={{ background: project.color }} />
          <div>
            <h1>{project.name}</h1>
            {project.description && <p className="muted">{project.description}</p>}
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={deleteProject} title="Delete project">
            🗑 Delete
          </button>
          <button className="btn btn-primary" onClick={() => setShowTaskModal(true)}>
            + New task
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="view-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={view === 'list'}
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            ☰ List
          </button>
          <button
            role="tab"
            aria-selected={view === 'board'}
            className={view === 'board' ? 'active' : ''}
            onClick={() => setView('board')}
          >
            ▦ Board
          </button>
        </div>
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
        >
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner message={error} />

      {view === 'list' ? (
        <section className="panel">
          {tasks.length === 0 ? (
            <EmptyState icon="🗒" title="No tasks match" hint="Create a task or adjust filters." />
          ) : (
            tasks.map((task) => (
              <Link key={task.id} to={`/tasks/${task.id}`} className="task-row">
                <span className="task-row-title">{task.title}</span>
                <span className="task-row-meta">
                  {task.assigneeName && <Avatar name={task.assigneeName} />}
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                  <DueDate dueDate={task.dueDate} status={task.status} />
                </span>
              </Link>
            ))
          )}
        </section>
      ) : (
        <div className="board">
          {TASK_STATUSES.map((status) => (
            <div
              key={status}
              className={`board-column${dragOver === status ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                if (dragTaskId) void changeStatus(dragTaskId, status);
                setDragTaskId(null);
              }}
            >
              <div className={`board-column-header header-${status.toLowerCase()}`}>
                {STATUS_LABELS[status]}
                <span className="count">{tasksByStatus(status).length}</span>
              </div>
              <div className="board-column-body">
                {tasksByStatus(status).map((task) => (
                  <div
                    key={task.id}
                    className="task-card"
                    draggable
                    onDragStart={() => setDragTaskId(task.id)}
                    onDragEnd={() => setDragTaskId(null)}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <span className="task-card-title">{task.title}</span>
                    <div className="task-card-meta">
                      <PriorityBadge priority={task.priority} />
                      <DueDate dueDate={task.dueDate} status={task.status} />
                      {task.assigneeName && <Avatar name={task.assigneeName} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showTaskModal && (
        <TaskFormModal
          projectId={project.id}
          members={members}
          onClose={() => setShowTaskModal(false)}
          onSaved={() => void loadTasks()}
        />
      )}
    </div>
  );
}
