import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PlaydLogo } from "@/components/ui/PlaydLogo";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setIdentifier("");
    setUsername("");
    setEmail("");
    setPassword("");
    setDisplayName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(identifier, password);
      } else {
        await register(username, password, email || undefined, displayName || undefined);
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
            <span className="text-primary"><PlaydLogo size={36} /></span>
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
            {mode === "login" ? (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Username or email</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="your_username or you@example.com"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  autoComplete="username"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="your_username"
                    required
                    pattern="[a-zA-Z0-9._\-]{3,30}"
                    title="3–30 characters: letters, numbers, . _ -"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                    autoComplete="username"
                  />
                  <p className="text-zinc-600 text-xs mt-1">Letters, numbers, . _ - allowed</p>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                    Email <span className="text-zinc-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                    Display name <span className="text-zinc-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                    autoComplete="name"
                  />
                </div>
              </>
            )}

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
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
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
