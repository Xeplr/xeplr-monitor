# xeplr-monitor — ui

The React app (Vite): `@xeplr/ui-account` for sign-in and the app shell, and the Monitor page from `@xeplr/ui-monitor`.

```bash
npm run dev       # http://localhost:19400
npm run build     # → dist/
```

`.env` holds the port and where the sign-in service and the API are; `vite.config.js` proxies `/auth/api` to sign-in and `/api` (and `/health`, `/whoami`) to the API. In production nginx does the same (the deploy writes it).

## Layout

| Path | What |
|---|---|
| `src/main.jsx` | `ThemeProvider` (required — the theme's colours exist only inside it) and `AccessProvider` |
| `src/App.jsx` | routes, the side rail (`drawerItems`: Monitor) and the settings menu (Admin) — **by key**, never by label |
| `src/api/monitor.js` | `createMonitorApi({ fetch: authFetch, stream: authEventStream })` — every call with the sign-in token |
| `src/pages/Monitor.jsx` | `@xeplr/ui-monitor`'s `MonitorPage` on that API |

## Rules

- `authFetch` returns the **parsed body**, not a Response — no `.json()`.
- A side-rail item needs an **icon** (a collapsed rail shows icons only) and its key must exist as a menu row (`Monitor`, in `api/migrations-auth/0006_monitor.sql`), or it is dropped silently. Give it its **`path`** too: that is how the rail marks the page you are on.
- **`pages.json` lists every route.** The Monitor page is `webOnly`: written by hand, since services, processes and live logs are not a form. The pre-commit hook (`.githooks/pre-commit`, set up by `npm install` here) prints that on every commit, with `xeplr-factory pages` (`@xeplr/ui-factory`, a dev dependency for that only).
- Phones: below 640px the rail becomes a bar across the top (`@xeplr/ui-account`) and the Monitor page stacks its list above the selected service; its tables scroll inside their own box.
- Set page backgrounds on a container inside the theme, never on `body`.
