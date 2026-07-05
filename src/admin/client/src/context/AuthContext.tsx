import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api';

interface AuthState {
  authenticated: boolean;
  login: (password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  const login = useCallback(async (password: string): Promise<string | null> => {
    const result = await api<{ success: boolean; error?: string }>('POST', '/api/login', { password });
    if (result.status === 200 && result.data.success) {
      setAuthenticated(true);
      return null;
    }
    return result.data.error || 'Login failed';
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/api/logout');
    setAuthenticated(false);
  }, []);

  const checkSession = useCallback(async () => {
    // skipUnauthorized=true: a 401 here means "no session yet" (expected on first load),
    // not a session expiry — don't fire the global unauthorized handler.
    const result = await api('GET', '/api/status', undefined, true);
    if (result.status === 200) {
      setAuthenticated(true);
    }
  }, []);

  // Whenever the session is invalid (any 401 from any api() call), drop back to
  // the login screen automatically instead of silently failing.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthenticated(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, login, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
