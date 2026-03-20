import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);   // null = not loaded yet
  const [ready, setReady]             = useState(false);  // true once initial check done
  const [tradeAccess, setTradeAccess] = useState(false);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('sessionToken');
    if (!token) { setUser(null); setTradeAccess(false); setReady(true); return; }
    try {
      const [data, access] = await Promise.all([api.me(), api.tradeAccess().catch(() => ({ access: false }))]);
      setUser({ ...data, sessionToken: token });
      setTradeAccess(access.access === true);
    } catch {
      localStorage.removeItem('sessionToken');
      setUser(null);
      setTradeAccess(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback((sessionToken) => {
    localStorage.setItem('sessionToken', sessionToken);
    refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ok if token already invalid */ }
    localStorage.removeItem('sessionToken');
    setUser(null);
    setTradeAccess(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, refreshUser, tradeAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
