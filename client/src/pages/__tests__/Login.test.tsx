import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { AuthProvider } from '../../context/AuthContext';
import Login from '../Login';

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

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Dashboard Page</div>} />
          <Route path="/force-password-change" element={<div>Force Password Change Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function fillForm(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('Login', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedGet.mockImplementation(() => Promise.reject(new Error('Unauthorized')));
  });

  it('fails login with wrong credentials: shows error and stays logged out', async () => {
    mockedPost.mockImplementation(() => Promise.reject(new Error('Invalid username or password')));

    renderLogin();
    await screen.findByRole('button', { name: /sign in/i });
    await fillForm('admin', 'wrongpass');
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'wrongpass' });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('successfully logs in with admin/admin123 and navigates to the dashboard', async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    mockedPost.mockImplementation((path: string) => {
      if (path === '/auth/login') {
        return new Promise((resolve) => {
          resolveLogin = resolve;
        });
      }
      return Promise.resolve({});
    });

    renderLogin();
    await screen.findByRole('button', { name: /sign in/i });
    await fillForm('admin', 'admin123');
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    expect(mockedPost).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'admin123' });
    expect(screen.getByRole('button', { name: /signing in\.\.\./i })).toBeInTheDocument();

    await act(async () => {
      resolveLogin({ user: { id: 'u1', username: 'admin' }, requiresPasswordChange: false });
    });

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
  });

  it('routes to the password-change screen when requiresPasswordChange is true', async () => {
    mockedPost.mockResolvedValue({
      user: { id: 'u2', username: 'forceuser' },
      requiresPasswordChange: true,
    });

    renderLogin();
    await screen.findByRole('button', { name: /sign in/i });
    await fillForm('forceuser', 'ChangeMe123');
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    expect(await screen.findByText('Force Password Change Page')).toBeInTheDocument();
  });
});