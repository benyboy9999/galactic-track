import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // null = not loaded yet
  const [ready, setReady]     = useState(false);  // true once initial check done

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('sessionToken');
    if (!token) { setUser(null); setReady(true); return; }
    try {
      const data = await api.me();
      setUser({ ...data, sessionToken: token });
    } catch {
      localStorage.removeItem('sessionToken');
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback((sessionToken, companyName, creditsUsed, creditsTotal, id, role) => {
    localStorage.setItem('sessionToken', sessionToken);
    setUser({ sessionToken, companyName, creditsUsed, creditsTotal, id, role });
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ok if token already invalid */ }
    localStorage.removeItem('sessionToken');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
