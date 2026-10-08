import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './ui';

/** App shell: sidebar navigation + routed content. */
export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">✦</span>
          <span className="brand-name">TaskFlow</span>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end>
            <span className="nav-icon">◧</span> Dashboard
          </NavLink>
          <NavLink to="/workspaces">
            <span className="nav-icon">▦</span> Workspaces
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div className="user-chip">
              <Avatar name={user.name} />
              <div className="user-meta">
                <span className="user-name">{user.name}</span>
                <span className="user-email">{user.email}</span>
              </div>
            </div>
          )}
          <button className="btn btn-ghost btn-block" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
