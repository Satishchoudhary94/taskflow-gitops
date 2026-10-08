import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { commentApi, projectApi, taskApi, workspaceApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Comment, Project, Task, TaskStatus, WorkspaceMember } from '../api/types';
import { STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { TaskFormModal } from '../components/TaskFormModal';
import { Avatar, DueDate, ErrorBanner, PriorityBadge, Spinner, StatusBadge } from '../components/ui';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ task: loaded }, { comments: loadedComments }] = await Promise.all([
          taskApi.get(taskId),
          commentApi.listByTask(taskId),
        ]);
        if (cancelled) return;
        setTask(loaded);
        setComments(loadedComments);
        const { project: loadedProject } = await projectApi.get(loaded.projectId);
        if (cancelled) return;
        setProject(loadedProject);
        const { members: ms } = await workspaceApi.listMembers(loadedProject.workspaceId);
        if (!cancelled) setMembers(ms);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load task');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const patchTask = async (fields: Parameters<typeof taskApi.update>[1]) => {
    if (!task) return;
    try {
      const { task: updated } = await taskApi.update(task.id, fields);
      setTask(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update task');
    }
  };

  const deleteTask = async () => {
    if (!task || !project) return;
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    await taskApi.remove(task.id);
    navigate(`/projects/${project.id}`);
  };

  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!newComment.trim()) return;
    setBusy(true);
    try {
      const { comment } = await commentApi.create(taskId, newComment.trim());
      setComments((current) => [...current, comment]);
      setNewComment('');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add comment');
    } finally {
      setBusy(false);
    }
  };

  const saveComment = async (commentId: string) => {
    try {
      const { comment } = await commentApi.update(commentId, editingContent.trim());
      setComments((current) => current.map((c) => (c.id === commentId ? comment : c)));
      setEditingCommentId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to edit comment');
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await commentApi.remove(commentId);
      setComments((current) => current.filter((c) => c.id !== commentId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete comment');
    }
  };

  if (error && !task) return <ErrorBanner message={error} />;
  if (!task) return <Spinner />;

  return (
    <div className="page task-detail">
      <nav className="breadcrumbs">
        {project ? (
          <>
            <Link to={`/workspaces/${project.workspaceId}`}>Workspace</Link> <span>/</span>{' '}
            <Link to={`/projects/${project.id}`}>{project.name}</Link> <span>/</span>{' '}
          </>
        ) : null}
        <b>{task.title}</b>
      </nav>

      <header className="page-header">
        <h1>{task.title}</h1>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>
            ✎ Edit
          </button>
          <button className="btn btn-danger" onClick={deleteTask}>
            Delete
          </button>
        </div>
      </header>

      <ErrorBanner message={error} />

      <div className="two-col">
        <section className="panel">
          <h2>Description</h2>
          <p className="task-description">
            {task.description || <span className="muted">No description.</span>}
          </p>

          <h2>Comments</h2>
          <div className="comment-list">
            {comments.length === 0 && <p className="muted">No comments yet — start the thread.</p>}
            {comments.map((comment) => (
              <div key={comment.id} className="comment">
                <Avatar name={comment.userName} />
                <div className="comment-body">
                  <div className="comment-head">
                    <b>{comment.userName}</b>
                    <span className="muted small">{timeAgo(comment.createdAt)}</span>
                    {comment.userId === user?.id && editingCommentId !== comment.id && (
                      <button
                        className="link-btn"
                        onClick={() => {
                          setEditingCommentId(comment.id);
                          setEditingContent(comment.content);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    <button className="link-btn danger" onClick={() => deleteComment(comment.id)}>
                      Delete
                    </button>
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="comment-edit">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={2}
                        maxLength={2000}
                      />
                      <div className="form-actions">
                        <button
                          className="btn btn-ghost"
                          onClick={() => setEditingCommentId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => saveComment(comment.id)}
                          disabled={!editingContent.trim()}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>{comment.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={addComment} className="comment-form">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              maxLength={2000}
            />
            <button className="btn btn-primary" disabled={busy || !newComment.trim()}>
              Comment
            </button>
          </form>
        </section>

        <aside className="panel task-sidebar">
          <h2>Details</h2>
          <div className="field">
            <span className="field-label">Status</span>
            <select
              value={task.status}
              onChange={(e) => void patchTask({ status: e.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Priority</span>
            <select
              value={task.priority}
              onChange={(e) =>
                void patchTask({ priority: e.target.value as Task['priority'] })
              }
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Assignee</span>
            <select
              value={task.assigneeId ?? ''}
              onChange={(e) => void patchTask({ assigneeId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Due date</span>
            <input
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => void patchTask({ dueDate: e.target.value || null })}
            />
          </div>
          <div className="field">
            <span className="field-label">Current</span>
            <div className="badge-row">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              <DueDate dueDate={task.dueDate} status={task.status} />
            </div>
          </div>
          <p className="muted small">
            Created {new Date(task.createdAt).toLocaleString()}
            <br />
            Updated {new Date(task.updatedAt).toLocaleString()}
          </p>
        </aside>
      </div>

      {showEdit && project && (
        <TaskFormModal
          projectId={project.id}
          members={members}
          task={task}
          onClose={() => setShowEdit(false)}
          onSaved={(saved) => setTask(saved)}
        />
      )}
    </div>
  );
}
