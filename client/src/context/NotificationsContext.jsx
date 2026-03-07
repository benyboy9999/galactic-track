import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const NotificationsContext = createContext({ unread: 0, notifications: [], markRead: () => {}, refresh: () => {} });

const POLL_INTERVAL = 45_000;

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [unread,        setUnread]        = useState(0);
  const [notifications, setNotifications] = useState([]);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.notifications();
      setUnread(data.unread);
      setNotifications(data.items);
    } catch { /* ignore */ }
  }, []);

  const markRead = useCallback(async () => {
    if (unread === 0) return;
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try { await api.markNotificationsRead(); } catch { /* ignore */ }
  }, [unread]);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      setNotifications([]);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [user, refresh]);

  return (
    <NotificationsContext.Provider value={{ unread, notifications, markRead, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
