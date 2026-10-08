import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { projectApi, workspaceApi } from '../api/endpoints';
import type { Project, Workspace, WorkspaceMember } from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';

const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function WorkspaceDetailPage() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // create-project modal state
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0]);
  const [modalError, setModalError] = useState<string | null>(null);

  // settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // add-member state
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ workspace: ws }, { projects: ps }, { members: ms }] = await Promise.all([
        workspaceApi.get(workspaceId),
        projectApi.listByWorkspace(workspaceId),
        workspaceApi.listMembers(workspaceId),
      ]);
      setWorkspace(ws);
      setProjects(ps);
      setMembers(ms);
      setEditName(ws.name);
      setEditDescription(ws.description);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setModalError(null);
    try {
      const { project } = await projectApi.create(workspaceId, {
        name: projectName.trim(),
        description: projectDescription.trim(),
        color: projectColor,
      });
      setProjects((current) => [...current, project]);
      setShowCreate(false);
      setProjectName('');
      setProjectDescription('');
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setModalError(null);
    try {
      const { workspace: updated } = await workspaceApi.update(workspaceId, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setWorkspace((current) => (current ? { ...current, ...updated } : updated));
      setShowSettings(false);
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : 'Failed to update workspace');
    } finally {
      setBusy(false);
    }
  };

  const deleteWorkspace = async () => {
    if (!window.confirm('Delete this workspace and everything in it? This cannot be undone.')) {
      return;
    }
    try {
      await workspaceApi.remove(workspaceId);
      navigate('/workspaces');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete workspace');
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    setMemberError(null);
    setBusy(true);
    try {
      const { members: updated } = await workspaceApi.addMember(
        workspaceId,
        memberEmail.trim(),
        memberRole,
      );
      setMembers(updated);
      setMemberEmail('');
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'Failed to add member');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!window.confirm('Remove this member from the workspace?')) return;
    try {
      await workspaceApi.removeMember(workspaceId, userId);
      setMembers((current) => current.filter((member) => member.userId !== userId));
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'Failed to remove member');
    }
  };

  if (loading) return <Spinner />;
  if (error || !workspace) return <ErrorBanner message={error ?? 'Workspace not found'} />;

  return (
    <div className="page">
      <nav className="breadcrumbs">
        <Link to="/workspaces">Workspaces</Link> <span>/</span> <b>{workspace.name}</b>
      </nav>
      <header className="page-header">
        <div>
          <h1>{workspace.name}</h1>
          {workspace.description && <p className="muted">{workspace.description}</p>}
        </div>
        <div className="header-actions">
          {isAdmin && (
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
              ⚙ Settings
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New project
          </button>
        </div>
      </header>

      <div className="workspace-columns">
        <section className="panel grow">
          <h2>Projects</h2>
          {projects.length === 0 ? (
            <EmptyState icon="📁" title="No projects yet" hint="Create the first project." />
          ) : (
            <div className="card-grid">
              {projects.map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`} className="project-card">
                  <span className="project-dot" style={{ background: project.color }} />
                  <div>
                    <span className="project-name">{project.name}</span>
                    {project.description && (
                      <span className="muted small">{project.description}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel members-panel">
          <h2>Members</h2>
          <ErrorBanner message={memberError} />
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.userId}>
                <Avatar name={member.name} />
                <div className="user-meta">
                  <span className="user-name">
                    {member.name}
                    {member.userId === user?.id && <span className="muted"> (you)</span>}
                  </span>
                  <span className="user-email">{member.email}</span>
                </div>
                <span className={`badge role-${member.role.toLowerCase()}`}>{member.role}</span>
                {isAdmin && member.role !== 'OWNER' && (
                  <button
                    className="icon-btn"
                    title="Remove member"
                    onClick={() => removeMember(member.userId)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <form onSubmit={addMember} className="add-member-form">
              <input
                type="email"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                placeholder="teammate@company.com"
                required
              />
              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as 'MEMBER' | 'ADMIN')}
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
              <button className="btn btn-primary" disabled={busy || !memberEmail.trim()}>
                Add
              </button>
            </form>
          )}
        </section>
      </div>

      {showCreate && (
        <Modal title="New project" onClose={() => setShowCreate(false)}>
          <form onSubmit={createProject} className="form">
            <ErrorBanner message={modalError} />
            <label>
              Name
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Website Redesign"
                required
                maxLength={100}
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </label>
            <label>
              Color
              <div className="color-row">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch${projectColor === color ? ' selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => setProjectColor(color)}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !projectName.trim()}>
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showSettings && (
        <Modal title="Workspace settings" onClose={() => setShowSettings(false)}>
          <form onSubmit={saveSettings} className="form">
            <ErrorBanner message={modalError} />
            <label>
              Name
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <label>
              Description
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </label>
            <div className="form-actions space-between">
              {workspace.role === 'OWNER' ? (
                <button type="button" className="btn btn-danger" onClick={deleteWorkspace}>
                  Delete workspace
                </button>
              ) : (
                <span />
              )}
              <button className="btn btn-primary" disabled={busy || !editName.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
