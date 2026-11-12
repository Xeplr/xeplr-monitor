# xeplr-monitor — ui

The React app (Vite), using `@xeplr/ui-account` for sign-in and the app shell and `@xeplr/ui-factory` for forms.

```bash
npm run dev       # http://localhost:19400
npm run build     # → dist/
```

`.env` holds the port and where the sign-in service and the API are; `vite.config.js` proxies `/auth/api` to sign-in and `/api` (and `/health`, `/whoami`) to the API. A new data prefix must be added there too.

## Layout

| Path | What |
|---|---|
| `src/main.jsx` | `ThemeProvider` (required — the theme's colours exist only inside it) and `AccessProvider` |
| `src/App.jsx` | routes, the side rail (`drawerItems`) and the settings menu (`settingsOverrides`) — **by key**, never by label |
| `src/menu.js` | every menu key this app uses; forms added to the menu are `form:<key>` |
| `src/api/factory.js` | the calls to the API's forms routes — with `authFetchFile`, so a form's stored pictures show as thumbnails |
| `src/pages/Tasks.jsx` | the sample list. It opens records on a **page** (`onOpenRecord` → `/tasks/new`, `/tasks/:id`), and `EditTask.jsx` is that page — it also holds the task form's **front-end hooks** (`TaskHooks extends FactoryHooks` — every method calls `super`, including `step`, run before a stepper moves) and sends **Done** back to the list |
| `src/pages/ConfigureUI.jsx` | Configure UI (Super Admin): `Forms.jsx` and `MenuSettings.jsx` tabs; `FormDesigner.jsx` designs one form |
| `src/pages/FormRecords.jsx` | opens any published form — what a form added to the menu links to |

## Rules

- `authFetch` returns the **parsed body**, not a Response — no `.json()`.
- A side-rail item needs an **icon** (a collapsed rail shows icons only) and its key must exist as a menu row, or it is dropped silently. Give it its **`path`** too: that is how the rail marks the page you are on.
- The rail is 48px when collapsed; `--app-rail-width` in `src/index.css` reserves the same space and must match it.
- **Phones work without extra code.** Below 640px the rail becomes a bar across the top (`@xeplr/ui-account`) and `src/index.css` gives the page's top to it instead of its left (`--xeplr-nav-bar-height`). Forms and lists made in the designer stack themselves (`@xeplr/ui-factory`); tables keep scrolling sideways with their row buttons pinned on screen (`@xeplr/ui-table`). A page you write by hand follows the same rules in the phone block at the bottom of `src/index.css`: inputs 16px or larger (or iOS zooms the page), buttons 44px tall, tables that scroll inside their own box, nothing a fixed width wider than the screen.
- Set page backgrounds on a container inside the theme, never on `body`.
- **`pages.json` lists every route**: `documents` (drawn from screens — works in any renderer, a phone app included) or `webOnly` (written by hand, with the reason). `npm run pages` prints the warnings the pre-commit hook prints: each web-only page, each route not listed, each listed page no route has. `npm install` here points git at `../.githooks`, where that hook is. Configure UI → Menu tags web-only items.
