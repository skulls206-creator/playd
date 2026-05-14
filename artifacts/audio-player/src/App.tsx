import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import MainPlayer from "@/pages/MainPlayer";
import NotFound from "@/pages/not-found";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KhurkOsBanner } from "@/components/layout/KhurkOsBanner";
import { DiscordBanner } from "@/components/layout/DiscordBanner";
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={MainPlayer} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Auto-prompt for notification permission once on mount.
  useEffect(() => {
    if (!("Notification" in window)) return;
    // If already granted and pref not set yet (fresh account), auto-enable silently.
    if (Notification.permission === "granted") {
      if (localStorage.getItem("playd_notifications") === null) {
        setNotificationsEnabled(true);
      }
      return;
    }
    // If permission hasn't been asked yet, prompt after a short delay.
    if (Notification.permission !== "default") return;
    const t = setTimeout(async () => {
      const perm = await requestNotificationPermission();
      if (perm === "granted") setNotificationsEnabled(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={150}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <KhurkOsBanner />
          <DiscordBanner />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
