import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../api/endpoints';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  /** True while the stored token is being validated on first load. */
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Any API call returning 401 (expired/invalid token) drops the session.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
  }, [clearSession]);

  // Validate a previously stored token on app start.
  useEffect(() => {
    if (!tokenStore.get()) {
      setInitializing(false);
      return;
    }
    authApi
      .me()
      .then(({ user: me }) => setUser(me))
      .catch(() => clearSession())
      .finally(() => setInitializing(false));
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: loggedIn } = await authApi.login(email, password);
    tokenStore.set(token);
    setUser(loggedIn);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const { token, user: registered } = await authApi.register(email, name, password);
    tokenStore.set(token);
    setUser(registered);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined); // best-effort server call
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, initializing, login, register, logout }),
    [user, initializing, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
