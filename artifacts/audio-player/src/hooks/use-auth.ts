import { create } from "zustand";
import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "playd_token";

export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
}

async function apiFetch<T>(path: string, options?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = token ?? localStorage.getItem(TOKEN_KEY);
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers: { ...headers, ...(options?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const { user } = await apiFetch<{ user: AuthUser }>("/api/auth/me", undefined, stored);
      set({ user, token: stored, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (email, password) => {
    const { token, user } = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem(TOKEN_KEY, token);
    set({ user, token, isAuthenticated: true });
  },

  register: async (email, password, displayName) => {
    const { token, user } = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    });
    localStorage.setItem(TOKEN_KEY, token);
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null, isAuthenticated: false });
    window.location.reload();
  },
}));
