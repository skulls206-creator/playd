import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg width="36" height="36" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="abg" cx="50%" cy="45%" r="65%">
                  <stop offset="0%" stopColor="#1a0f3a"/>
                  <stop offset="100%" stopColor="#07091a"/>
                </radialGradient>
                <linearGradient id="agem" x1="25%" y1="20%" x2="80%" y2="80%">
                  <stop offset="0%"   stopColor="#e0aaff"/>
                  <stop offset="30%"  stopColor="#c026d3"/>
                  <stop offset="70%"  stopColor="#7e22ce"/>
                  <stop offset="100%" stopColor="#3b0764"/>
                </linearGradient>
                <linearGradient id="arim" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="#f0abfc"/>
                  <stop offset="50%"  stopColor="#a855f7"/>
                  <stop offset="100%" stopColor="#6b21a8" stopOpacity="0.4"/>
                </linearGradient>
                <radialGradient id="aspec" cx="35%" cy="28%" r="38%">
                  <stop offset="0%"   stopColor="white" stopOpacity="0.95"/>
                  <stop offset="55%"  stopColor="white" stopOpacity="0.15"/>
                  <stop offset="100%" stopColor="white" stopOpacity="0"/>
                </radialGradient>
                <filter id="aamb" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="22"/>
                </filter>
                <clipPath id="aframe">
                  <rect width="180" height="180" rx="38"/>
                </clipPath>
              </defs>
              <rect width="180" height="180" rx="38" fill="url(#abg)"/>
              <ellipse cx="96" cy="92" rx="72" ry="64" fill="#9333ea" opacity="0.35" filter="url(#aamb)" clipPath="url(#aframe)"/>
              <polygon points="38,36 38,144 148,90" fill="#c084fc" opacity="0.45" filter="url(#aamb)" clipPath="url(#aframe)"/>
              <polygon points="38,36 38,144 148,90" fill="url(#agem)" stroke="url(#arim)" strokeWidth="2" strokeLinejoin="round"/>
              <polygon points="38,36 38,144 148,90" fill="url(#aspec)"/>
              <circle cx="68" cy="50" r="2.5" fill="white" opacity="0.95"/>
            </svg>
            <span className="text-xl font-bold text-white tracking-tight">PLAYD</span>
          </div>
          <p className="text-zinc-500 text-sm">Your personal music library</p>
        </div>

        {/* Form card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl">
          <h2 className="text-white font-semibold text-lg mb-5">
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Display name (optional)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                required
                minLength={mode === "register" ? 8 : undefined}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            {error && (
              <div className="bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition-colors mt-1"
            >
              {loading
                ? mode === "login" ? "Signing in…" : "Creating account…"
                : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-zinc-800 text-center">
            <span className="text-zinc-500 text-xs">
              {mode === "login" ? "New to PLAYD?" : "Already have an account?"}{" "}
            </span>
            <button
              type="button"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
              className="text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>

        <p className="text-center text-zinc-600 text-xs mt-6">
          Your library metadata is stored privately per account.
        </p>
      </div>
    </div>
  );
}
