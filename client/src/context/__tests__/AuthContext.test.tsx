import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext, type ReactNode } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { AuthContext, AuthProvider, type User } from '../AuthContext';

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;

const authed: User = { id: 'uid-1', username: 'admin', mustChangePassword: false };

function Gate({ children }: { children: ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div>Loading AgentOS...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/force-password-change" replace />;
  return <>{children}</>;
}

function DashboardWithLogout() {
  const { logout } = useContext(AuthContext);
  return (
    <div>
      Dashboard Page
      <button onClick={() => void logout()}>Sign out</button>
    </div>
  );
}

function renderHarness(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/force-password-change" element={<div>Force Password Change Page</div>} />
          <Route path="/" element={<Gate>{<DashboardWithLogout />}</Gate>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
    mockedPost.mockReset();
  });

  it('restores the session from the cookie on reload and stays on the dashboard', async () => {
    mockedGet.mockResolvedValue({ user: authed });

    renderHarness('/');

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/auth/me');
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('clears the session and redirects to login on logout', async () => {
    mockedGet.mockResolvedValue({ user: authed });
    mockedPost.mockResolvedValue({ ok: true });

    renderHarness('/');
    await screen.findByText('Dashboard Page');

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(mockedPost).toHaveBeenCalledWith('/auth/logout');
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  it('sends the stored user to the password-change screen when mustChangePassword is set', async () => {
    mockedGet.mockResolvedValue({ user: { ...authed, mustChangePassword: true } });

    renderHarness('/');

    expect(await screen.findByText('Force Password Change Page')).toBeInTheDocument();
  });
});