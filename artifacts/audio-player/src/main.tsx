import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/';
    const swUrl = `${base}sw.js`;
    navigator.serviceWorker.register(swUrl, { scope: base })
      .then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
