# xeplr-monitor

An xeplr application, created by [`@xeplr/cli`](https://www.npmjs.com/package/@xeplr/cli).

```
xeplr-monitor/
├─ api/        the API and the sign-in service          → api/README.md
├─ ui/         the React app                           → ui/README.md
└─ CLAUDE.md   how to change this app — for Claude, and a good read for people
```

## Start it

Needs **PostgreSQL** and **Redis** running.

```bash
cd api && npm run start-auth     # sign-in           http://localhost:19401
cd api && npm run start-api      # the API           http://localhost:19402
cd ui  && npm run dev            # the app           http://localhost:19400
```

Open http://localhost:19400 and sign in as `admin@xeplr.com`.

Flows (`@xeplr/workflow-api`) run **inside the API**, in a database of their
own that the API creates on first start — nothing else to start.

## Where each address goes

The browser only ever calls **paths** on the app's own address — never a port.
What serves each path is decided in ONE place per environment: Vite's dev proxy
locally (`ui/vite.config.js`, from `ui/.env`), nginx in production.

| path | served by | local (`ui/.env`) | production (nginx) |
|---|---|---|---|
| `/auth/api/…` | the sign-in service | `AUTH_URL` | `127.0.0.1:<AUTH_PORT>` |
| `/api/workflow/…` | flows — `@xeplr/workflow-api`, inside the API | `API_URL` | `127.0.0.1:<XEPLR_MONITOR_PORT>` |
| `/api/…`, `/health`, `/whoami` | the API | `API_URL` | `127.0.0.1:<XEPLR_MONITOR_PORT>` |

### Production

`api/production.env.example` lists every setting (copy it to
`api/production.env`, fill in, start with `NODE_ENV=production`). Build the UI
(`cd ui && npm run build`) and let nginx serve it and route the paths:

```nginx
server {
  server_name app.example.com;
  root /srv/xeplr-monitor/ui/dist;

  location /auth/api/     { proxy_pass http://127.0.0.1:19401; }
  location /api/          { proxy_pass http://127.0.0.1:19402; }
  location = /health      { proxy_pass http://127.0.0.1:19402; }
  location = /whoami      { proxy_pass http://127.0.0.1:19402; }
  location /              { try_files $uri /index.html; }   # the React app's own pages
}
```

Every one of these checks the same sign-in token, so one login covers them all.

## What is in it

- **Sign-in** — login, register, password reset, profile, and the admin screens for users, roles and permissions (`@xeplr/auth`, `@xeplr/ui-account`).
- **Tasks** — a sample built from screens: a list, and a form it opens on a page of its own, saved into an ordinary `tasks` table. The form is filled in over three steps and uses every control there is — text, a dropdown, radio buttons, a tick box, a date, a date and time, several tags at once, and a file.
- **Configure UI** — in the settings menu, for Super Admin: every form (make one, design it, publish it, add it to the side rail), every flow (screens one after another — each screen's events, and where it goes next) and the side rail itself (rename, reorder, hide).
- **Flows** — in the side rail: the journeys people can start, run by `@xeplr/workflow-api` inside the API.
- **Functions** — `api/functions/`: your code, registered by event and picked by name in a screen's events or a flow step (see "Functions" below).

## Create a new UI

- **Without code** — Configure UI → Forms → New form → design → Publish → Add to menu.
- **With Claude** — open Claude in this folder and give it (change the name and the fields):

  > Create a new UI for farming departments. One record is a farming department with: Name (required), Region (dropdown: North, South, East, West), Area in acres (number, at least 0), Started on (date), Notes (long text). Show Name, Region and Area in the list. Follow "Create a new UI" in CLAUDE.md.

## Flows

Your forms, one after another. Design one in **Configure UI → Flows**: pick the screens, and for each one say what runs around its records (its **events**) and where the journey goes once it is saved — a screen, a **function that decides**, or the end. Publish it, and people start it from **Flows** in the side rail (or at `/journey/<key>`). The run id joins the address once it starts, so a journey can be reloaded, left, or handed to someone else and opened on the step it is on.

Flows are run by **`@xeplr/workflow-api`**, **inside this API** — `bin/www` starts it after the screens. Nothing else to start:

| | |
|---|---|
| **Database** | its own, `DB_WORKFLOW` (`xeplr_monitor_workflow`), beside this app's — a sub-product embedded in an app keeps its tables apart. Created and migrated the first time the API starts. Each screen still saves into its own table in `DB_API`. |
| **Tenancy** | none, like the rest of this app — flows belong to the whole app. Workflow never creates companies or workspaces of its own. |
| **Permissions** | each route checks the caller's (`List flows`, `Start flow run`, `Publish flow`…), granted by `@xeplr/workflow-api`'s `migrations-auth`, which `XEPLR_AUTH_MIGRATIONS` loads. |

## Functions — your code, picked by name

Code around a form's records — a check on save, an email after, a list narrowed to the user's own — is a **function** in `api/functions/`, registered with `@xeplr/actions` under the **event** it is for. A screen names it in its `events`; a flow step names a `decide` function to choose where to go next. The designer shows each event only the functions written for it, with what they are handed and return; the code stays in `api/functions/` and runs on the server.

| event | runs | return |
|---|---|---|
| `beforeLoad` | before records are read | nothing, or a narrower `ctx.query` |
| `beforeSave` | before a record is written | the values to save; `ctx.reject(message, { field })` refuses |
| `afterSave` | once it is saved | (ignored) |
| `beforeDelete` | before a delete | nothing; `ctx.reject` refuses |
| `onError` | when load / save / delete failed | (ignored) |
| `decide` | a flow step is done | the next step's key |

`api/functions/index.js` registers two to start from: `tidyTaskTitle` (Tasks' `beforeSave`) and `byPriority` (a `decide`). A screen that names a function nobody registered is refused when it is published, by name.

## Rules this app follows

| Rule | Why |
|---|---|
| Records live in **real tables**, one column per field — never JSON. | Reports stay plain SQL. |
| A **key** and a **label**, everywhere: code uses keys (form keys, menu keys); people read labels, renamed in Configure UI. | Renaming what people see never breaks code. |
| **`REDIS_PREFIX`** in `api/development.env` is required and unique to this app. | Apps sharing a Redis would otherwise serve each other's sessions and permissions. |
| Designing and publishing forms is **Super Admin only**. | Publishing changes database tables. |
| Rules that must hold go in **server functions** (`api/functions/`), named in a screen's events; the browser only shapes what people see and send. | The browser is not a security boundary. |
| Every data address is under **`/api`**. | A page and a data path must never collide. |
| A screen is a **document**; a button is a **registered function and its parameters**; a page written by hand is **web only**, listed in `ui/pages.json` with the reason. | What is a document can be drawn anywhere — a phone app too. The pre-commit hook and Configure UI → Menu say which pages are not. |
| Every file the app keeps is under **`XEPLR_DATA_DIR`**, a folder per company. | One place to back up, and no company reads another's files. |

The full list, and where each piece lives, is in `CLAUDE.md`.
