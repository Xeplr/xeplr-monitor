# xeplr-monitor — api

The API (`@xeplr/base-apis`) and the sign-in service (`@xeplr/auth`), with this app's forms served by `@xeplr/factory`.

## Commands

| Command | Does |
|---|---|
| `npm run setup` | create both databases (`xeplr_monitor_auth`, `xeplr_monitor_api`), the sign-in tables, permissions and menus |
| `npm run start-auth` | the sign-in service, port 19401 — refuses to start without Redis or `REDIS_PREFIX`; its banner says whether email works |
| `npm run start-api` | the API, port 19402 — runs `migrations/` and publishes never-published screens on start |
| `npm run migrate:auth` | apply new `migrations-auth/*.sql` (a new menu row, say), then restart sign-in |
| `npm run db:encrypt` | redo the encrypted database connection |
| `npm run check-env` | check every required setting is present |
| `npx xeplr-factory screens screens/<form>/<form>.entity.json -o screens/<form> --no-pages` | a form's screens, server functions and model from its spec |
| `npx xeplr-factory validate <screen>.json` | check a screen document |

## Layout

| Path | What |
|---|---|
| `development.env` | every setting — ports, the encrypted connection, `REDIS_PREFIX`, secrets, the super admin, email |
| `env.required.js` | the settings that must be present; the API refuses to start and names any that are missing |
| `app.js` | the Express app: the auth gate, and the routes |
| `routes/index.js` | this app's own routes — every data address under `/api` |
| `routes/access.js` | who may design and publish forms (Super Admin) |
| `screens/` | the forms this app ships with: per form, its spec, list and edit screens, server functions and model — registered in `screens/index.js` |
| `functions/` | this app's functions — the code screens' events and flows' `decide` pick by name — registered with `@xeplr/actions` by event, loaded at startup |
| `workflow.js` | flows: `@xeplr/workflow-api` started inside this API, in its own database (`DB_WORKFLOW`) |
| `data/` | `XEPLR_DATA_DIR` in development: every file the app keeps, a folder per company — what people attach through a form's **file** field is in `<company>/screens/`. Never committed, and never served: a file comes back only through the API's own route, which checks the caller the way reading a record does |
| `migrations/` | hand-written SQL for tables no form owns |
| `migrations-auth/` | this app's rows in the sign-in database — menus (by key), permissions |
| `models/` | models for hand-written tables |

## Settings to know

| Setting | |
|---|---|
| `REDIS_PREFIX` | **required, unique to this app** (`xeplr-monitor:`) |
| `XEPLR_DATA_DIR` | **required, absolute, existing**: where every file the app keeps lives, a folder per company (`<root>/xeplr-monitor/<company>/…`). Generated as `api/data`; on a server, somewhere backed up |
| `XEPLR_MONITOR_CONNECTION`, `AUTH_DB_CONNECTION_INFO_ENCRYPTED` | the database, encrypted — `npm run db:encrypt` |
| `DB_API`, `AUTH_DB_NAME` | the two database names — never guessed |
| `AUTH_SUPER_ADMIN_EMAIL` / `_PASSWORD` | the first account — created once, when the sign-in database is first set up |
| `AUTH_TENANT_HEADER` | `none`: one set of roles for everyone. A multi-tenant app names its company header (e.g. `x-company-id`), so a role made inside a company belongs to it |
| `AUTH_ACTIVATION_URL`, `AUTH_INVITE_URL`, `AUTH_RESET_URL` | the UI pages the emailed links open; the token is appended. The reset address is never taken from the request |
| `AUTH_REGISTER_ROLES` | the role a new sign-up gets when activated (`Viewer`). **Required to register:** unset, or naming a role that does not exist, and registration is refused |
| `EMAIL_PROVIDER` and its settings | needed to register, resend an activation link, invite or reset a password — each is refused while email does not work. Signing in works without it |

## Sign-up

Register → an activation email → the link (or an admin's **Activate** on the User Roles screen) → sign in. Lost the email? `/auth/resend-activation` sends a new one. Invited people set their password at `/auth/accept-invite`.
