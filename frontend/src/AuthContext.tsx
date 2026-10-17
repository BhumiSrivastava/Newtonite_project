import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from './api';

interface Membership {
  team_id: string;
  team_name: string;
  role: string;
}

interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  memberships: Membership[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem('ops_token');
    const savedUser = localStorage.getItem('ops_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
        api.setToken(savedToken);
      } catch {
        localStorage.removeItem('ops_token');
        localStorage.removeItem('ops_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password);
    setToken(data.token);
    setUser(data.user);
    api.setToken(data.token);
    localStorage.setItem('ops_token', data.token);
    localStorage.setItem('ops_user', JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    api.setToken(null);
    localStorage.removeItem('ops_token');
    localStorage.removeItem('ops_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
