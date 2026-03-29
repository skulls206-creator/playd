import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const base = import.meta.env.BASE_URL || '/';
    const swUrl = `${base}sw.js`;
    try {
      const reg = await navigator.serviceWorker.register(swUrl, { scope: base });
      console.log('[SW] Registered, scope:', reg.scope);

      // Register periodic background sync if supported (Chrome / Edge)
      if ('periodicSync' in reg) {
        try {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
          if (status.state === 'granted') {
            await (reg as any).periodicSync.register('playd-periodic-sync', { minInterval: 24 * 60 * 60 * 1000 });
          }
        } catch { /* periodic sync not available */ }
      }

      // Listen for messages from the service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_LIBRARY' || event.data?.type === 'PERIODIC_SYNC') {
          // Dispatch a custom event that hooks can listen for
          window.dispatchEvent(new CustomEvent('playd-bg-sync'));
        }
      });
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
