import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Account = { name: string; email: string; passwordHash: string };
type User = { name: string; email: string };
type AuthResult = { ok: true } | { ok: false; error: string };

const ACCOUNTS_KEY = "signalroom.accounts";
const SESSION_KEY = "signalroom.session";

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readAccounts(): Account[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeAccounts(accounts: Account[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

const AuthContext = createContext<{
  user: User | null;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  googleSignIn: (name: string, email: string) => Promise<AuthResult>;
  signOut: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const email = localStorage.getItem(SESSION_KEY);
    if (!email) return;
    const account = readAccounts().find((a) => a.email === email);
    if (account) setUser({ name: account.name, email: account.email });
  }, []);

  const signUp = async (name: string, email: string, password: string): Promise<AuthResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim()) return { ok: false, error: "Enter your name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return { ok: false, error: "Enter a valid email address." };
    if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

    const accounts = readAccounts();
    if (accounts.some((a) => a.email === normalizedEmail)) {
      return { ok: false, error: "An account with that email already exists. Try signing in instead." };
    }

    const passwordHash = await hash(password);
    accounts.push({ name: name.trim(), email: normalizedEmail, passwordHash });
    writeAccounts(accounts);
    localStorage.setItem(SESSION_KEY, normalizedEmail);
    setUser({ name: name.trim(), email: normalizedEmail });
    return { ok: true };
  };

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    const account = readAccounts().find((a) => a.email === normalizedEmail);
    if (!account) return { ok: false, error: "No account found with that email." };
    const passwordHash = await hash(password);
    if (passwordHash !== account.passwordHash) return { ok: false, error: "Incorrect password." };
    localStorage.setItem(SESSION_KEY, normalizedEmail);
    setUser({ name: account.name, email: account.email });
    return { ok: true };
  };

  const googleSignIn = async (name: string, email: string): Promise<AuthResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    const account = accounts.find((a) => a.email === normalizedEmail);

    if (!account) {
      // Create a dummy account if it doesn't exist
      const dummyPasswordHash = await hash(Math.random().toString(36).slice(-8));
      accounts.push({ name: name.trim(), email: normalizedEmail, passwordHash: dummyPasswordHash });
      writeAccounts(accounts);
    } else {
      // Update name if changed
      account.name = name.trim();
      writeAccounts(accounts);
    }

    localStorage.setItem(SESSION_KEY, normalizedEmail);
    setUser({ name: name.trim(), email: normalizedEmail });
    return { ok: true };
  };

  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, signUp, signIn, googleSignIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
