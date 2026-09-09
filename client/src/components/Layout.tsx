import { useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { RealtimeContext } from '../context/RealtimeContext';
import { api } from '../api/client';
import { SystemStatusInfo } from '../types';
import { LoadingBlock } from './Ui';

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat', key: 'chat' },
  { to: '/tasks', label: 'Tasks', key: 'tasks' },
  { to: '/agents', label: 'Agents', key: 'agents' },
  { to: '/memory', label: 'Memory', key: 'memory' },
  { to: '/notes', label: 'Notes', key: 'notes' },
  { to: '/projects', label: 'Projects', key: 'projects' },
  { to: '/automations', label: 'Automations', key: 'automations' },
  { to: '/approvals', label: 'Approvals', key: 'approvals', badge: 'approvals' },
  { to: '/logs', label: 'Logs', key: 'logs' },
  { to: '/settings', label: 'Settings', key: 'settings' },
];

export default function Layout() {
  const { user, logout } = useContext(AuthContext);
  const { connected, subscribe } = useContext(RealtimeContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [status, setStatus] = useState<SystemStatusInfo | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    api
      .get<SystemStatusInfo>('/system/status')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    api
      .get<{ count: number }>('/approvals/pending/count')
      .then((d) => setPendingApprovals(d.count))
      .catch(() => setPendingApprovals(0));
  }, [location.pathname]);

  useEffect(() => {
    const unsub = subscribe('approval:new', () => {
      api
        .get<{ count: number }>('/approvals/pending/count')
        .then((d) => setPendingApprovals(d.count))
        .catch(() => {});
    });
    const unsub2 = subscribe('approval:responded', () => {
      api
        .get<{ count: number }>('/approvals/pending/count')
        .then((d) => setPendingApprovals(d.count))
        .catch(() => {});
    });
    const unsub3 = subscribe('system:status', (data) => {
      setStatus(data as SystemStatusInfo);
    });
    return () => {
      unsub();
      unsub2();
      unsub3();
    };
  }, [subscribe]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const statusText =
    status && status.opencode
      ? status.opencode.available
        ? `OpenCode ${status.opencode.version ?? ''}`
        : 'OpenCode offline'
      : 'Checking...';

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">A</div>
          <div className="brand-text">
            <span className="brand-name">AgentOS</span>
            <span className="brand-sub">Control Center</span>
          </div>
        </div>
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
            >
              <span className="nav-label">{item.label}</span>
              {item.badge && pendingApprovals > 0 && (
                <span className="nav-badge">{pendingApprovals}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink
            to="/system"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <span className="nav-label">System</span>
            <span className={`led ${connected ? 'led-green' : 'led-red'}`} />
          </NavLink>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen((v) => !v)}>
            menu
          </button>
          <div className="topbar-left">
            {status ? (
              <span className="sys-chip">
                <span className={`led ${status.server === 'online' ? 'led-green' : 'led-red'}`} />
                <span className="sys-chip-label">{status.server}</span>
              </span>
            ) : (
              <LoadingBlock label="Checking system" />
            )}
            <span className="sys-chip">
              <span className={`led ${connected ? 'led-green' : 'led-red'}`} />
              <span className="sys-chip-label">realtime {connected ? 'live' : 'offline'}</span>
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="chip-btn"
              onClick={() => navigate('/system')}
              title="System status"
            >
              <span className="sys-chip">
                <span className="sys-chip-label">{status ? statusText : '...'}</span>
              </span>
            </button>
            <div className="user-menu">
              <button
                className="chip-btn user-chip"
                onClick={() => setStatusOpen(!statusOpen)}
                title="System details"
              >
                {status ? (
                  <span className="sys-chip-label">
                    {status.workers.available} workers · {status.activeTasks} active
                  </span>
                ) : (
                  <span className="sys-chip-label">status</span>
                )}
              </button>
            </div>
            <div className="user-menu">
              <button className="chip-btn user-chip" onClick={() => setMenuOpen(!menuOpen)}>
                <span className="user-avatar">{user?.username?.slice(0, 2).toUpperCase()}</span>
                <span className="user-name">{user?.username}</span>
              </button>
              {menuOpen && (
                <div className="dropdown">
                  <div className="dropdown-header">
                    <div className="dropdown-title">{user?.username}</div>
                    <div className="dropdown-sub">Signed in to AgentOS</div>
                  </div>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/settings');
                    }}
                  >
                    Settings
                  </button>
                  <button className="dropdown-item" onClick={handleLogout}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}