import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useContext, ReactNode } from 'react';
import { AuthContext } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForcePasswordChange from './pages/ForcePasswordChange';
import Chat from './pages/Chat';
import Tasks from './pages/Tasks';
import Agents from './pages/Agents';
import Memory from './pages/Memory';
import Notes from './pages/Notes';
import Projects from './pages/Projects';
import Automations from './pages/Automations';
import Approvals from './pages/Approvals';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import SystemStatus from './pages/SystemStatus';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  const location = useLocation();
  if (loading) {
    return <div className="boot-screen">Loading AgentOS...</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user.mustChangePassword && location.pathname !== '/force-password-change') {
    return <Navigate to="/force-password-change" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useContext(AuthContext);
  if (loading) {
    return <div className="boot-screen">Loading AgentOS...</div>;
  }
  if (user && user.mustChangePassword) {
    return (
      <Routes>
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="*" element={<Navigate to="/force-password-change" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Chat />} />
        <Route path="chat" element={<Chat />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="agents" element={<Agents />} />
        <Route path="memory" element={<Memory />} />
        <Route path="notes" element={<Notes />} />
        <Route path="projects" element={<Projects />} />
        <Route path="automations" element={<Automations />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="system" element={<SystemStatus />} />
        <Route path="force-password-change" element={<ForcePasswordChange />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
