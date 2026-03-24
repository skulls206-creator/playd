import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import MainPlayer from "@/pages/MainPlayer";
import AuthPage from "@/pages/AuthPage";
import NotFound from "@/pages/not-found";
import { InstallPrompt } from "@/components/layout/InstallPrompt";
import { KhurkOsBanner } from "@/components/layout/KhurkOsBanner";
import { DiscordBanner } from "@/components/layout/DiscordBanner";
import { useAuth } from "@/hooks/use-auth";
import { requestNotificationPermission, setNotificationsEnabled } from "@/hooks/use-now-playing-notification";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, initialize } = useAuth();

  useEffect(() => {
    initialize();
  }, []);

  // Auto-prompt for notification permission once, shortly after first authenticated load.
  // Only fires when permission is 'default' (never asked). If the user grants it, we
  // automatically enable notifications so they work straight away.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!('Notification' in window)) return;
    // If already granted and pref not set yet (fresh account), auto-enable silently.
    if (Notification.permission === 'granted') {
      if (localStorage.getItem('playd_notifications') === null) {
        setNotificationsEnabled(true);
      }
      return;
    }
    // If permission hasn't been asked yet, prompt after a short delay.
    if (Notification.permission !== 'default') return;
    const t = setTimeout(async () => {
      const perm = await requestNotificationPermission();
      if (perm === 'granted') setNotificationsEnabled(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-zinc-600 text-sm">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={MainPlayer} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <AuthGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <InstallPrompt />
          <KhurkOsBanner />
          <DiscordBanner />
        </AuthGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
