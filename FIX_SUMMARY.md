# Fix Summary — playd

## Electron Security Hardening
- **File:** `electron/main.js`
- Added `sandbox: true` and `webSecurity: true` to BrowserWindow webPreferences
- Already had `contextIsolation: true` and `nodeIntegration: false` — confirmed correct

## .gitignore Created
- Root `.gitignore` now covers: node_modules/, dist/, .env, .env.local, *.log, .DS_Store
