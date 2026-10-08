import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { workspaceApi } from '../api/endpoints';
import type { Workspace } from '../api/types';
import { ApiError } from '../api/client';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui';

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    workspaceApi
      .list()
      .then(({ workspaces: list }) => setWorkspaces(list))
      .catch((err) => setError(err.message));
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const { workspace } = await workspaceApi.create(name.trim(), description.trim());
      setWorkspaces((current) => [...(current ?? []), workspace]);
      setShowCreate(false);
      setName('');
      setDescription('');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create workspace');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (!workspaces) return <Spinner />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Workspaces</h1>
          <p className="muted">Teams and organizations you belong to.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New workspace
        </button>
      </header>

      {workspaces.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No workspaces yet"
          hint="Create a workspace to start organizing projects and tasks."
        />
      ) : (
        <div className="card-grid">
          {workspaces.map((workspace) => (
            <Link key={workspace.id} to={`/workspaces/${workspace.id}`} className="workspace-card">
              <h3>{workspace.name}</h3>
              {workspace.description && <p className="muted">{workspace.description}</p>}
              <span className={`badge role-${(workspace.role ?? 'member').toLowerCase()}`}>
                {workspace.role}
              </span>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New workspace" onClose={() => setShowCreate(false)}>
          <form onSubmit={create} className="form">
            <ErrorBanner message={createError} />
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Company"
                required
                maxLength={100}
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this workspace for?"
                maxLength={500}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
