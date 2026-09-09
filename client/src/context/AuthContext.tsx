import { createContext, ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export interface User {
  id: string;
  username: string;
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {
    throw new Error('AuthContext not initialized');
  },
  logout: async () => {},
  setUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const handleUnauthorized = useCallback(() => {
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [handleUnauthorized]);

  useEffect(() => {
    api
      .get<{ user: User }>('/auth/me')
      .then((data) => {
        setUser(data.user);
        if (data.user.mustChangePassword) {
          navigate('/force-password-change', { replace: true });
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<{ user: User; requiresPasswordChange: boolean }>(
      '/auth/login',
      { username, password }
    );
    const authed = { ...data.user, mustChangePassword: data.requiresPasswordChange };
    setUser(authed);
    return authed;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post<{ ok: boolean }>('/auth/logout');
    } catch {
      /* ignore */
    }
    setUser(null);
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}