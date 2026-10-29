# Issuel

A minimal GitHub Issues client built with React, TypeScript, Vite, Hono and Tailwind CSS.

GitHub is the source of truth for issues. SQLite stores authentication sessions and encrypted tokens, not issue data.

## Features

- GitHub App sign-in and public/private repository workspaces.
- Grouped issue lists with sorting, pagination and manual refresh.
- Markdown descriptions, comments and issue properties.
- Issue creation, inline title editing, status changes and reopening.
- English and Traditional Chinese interface languages.

## Getting started

### Requirements

- Node.js 24 or newer
- pnpm 12.11.2, as declared in `package.json`
- A GitHub App installed on the repositories you want to access

Run commands from the project root.

### GitHub App setup

1. Register a [GitHub App](https://github.com/settings/apps/new) with these local development settings:

   | Setting                                        | Value                                     |
   | ---------------------------------------------- | ----------------------------------------- |
   | Homepage URL                                   | `http://localhost:5173`                   |
   | Callback URL                                   | `http://localhost:5173/api/auth/callback` |
   | Expire user authorization tokens               | Enabled                                   |
   | Request user authorization during installation | Disabled                                  |
   | Device flow and webhooks                       | Disabled                                  |
   | Setup URL                                      | Empty                                     |

2. Grant **Issues: Read and write** repository permission. Metadata read access is implicit.
3. Copy the App's **Client ID** and generate a **Client secret** for the backend settings below.
4. Install the App on the account that owns your repositories and select the repositories it can access. Complete any required organization approval.

Signing in and installing the App are separate steps. The signed-in GitHub user must also have access to the selected repositories.

### Local setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Copy `.env.example` to `.env` and fill in the required settings listed under [Configuration](#configuration).
3. Generate a session encryption key. This PowerShell command copies the value to the clipboard without printing it:

   ```powershell
   node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('hex'))" | Set-Clipboard
   ```

   Paste it into `SESSION_ENCRYPTION_KEY` and retain the same value across restarts. Keep credentials and the real `.env` out of version control.

4. Start development:

   ```sh
   pnpm dev
   ```

Open **http://localhost:5173**, click **Connect GitHub**, then select a repository from the sidebar.

Vite serves the frontend on port 5173 and proxies `/api` to Hono, which defaults to port 3000. The API loads `.env` and checks required settings before startup. Restart `pnpm dev` after changing those settings. Ctrl+C stops the development processes.

### Temporarily change the API port

Set `PORT` in the PowerShell session before starting development so Hono and the Vite proxy use the same port:

```powershell
$env:PORT = '3001'
pnpm dev
```

The frontend remains at **http://localhost:5173**, and the GitHub callback remains `http://localhost:5173/api/auth/callback`.

To clear the override, stop development and run:

```powershell
Remove-Item Env:PORT
```

The override applies only to that terminal session and its child processes. Setting `PORT` only in `.env` does not configure the Vite proxy.

## Configuration

Development loads backend settings from `.env`; production uses process-level settings supplied by the deployment environment.

| Variable                    | Required / default   | Purpose                                                                                                           |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`      | Required             | GitHub App Client ID                                                                                              |
| `GITHUB_APP_CLIENT_SECRET`  | Required             | GitHub App Client secret                                                                                          |
| `GITHUB_OAUTH_CALLBACK_URL` | Required             | Exact browser-facing URL ending in `/api/auth/callback`                                                           |
| `SESSION_ENCRYPTION_KEY`    | Required             | 32 random bytes encoded as 64 hexadecimal characters                                                              |
| `GITHUB_APP_SLUG`           | Optional             | App URL name used to offer an installation link before a user's first installation; must match the configured App |
| `SQLITE_DATABASE_PATH`      | `./data/auth.sqlite` | Persistent authentication database path; `:memory:` is not supported                                              |
| `SESSION_COOKIE_SECURE`     | `true`               | Use `false` only for local HTTP development                                                                       |
| `NODE_ENV`                  | Deployment-defined   | Use `production` when deploying                                                                                   |
| `PORT`                      | `3000`               | API port; set in the shell to configure both Hono and the development proxy                                       |

For local development, use `GITHUB_OAUTH_CALLBACK_URL=http://localhost:5173/api/auth/callback` and `SESSION_COOKIE_SECURE=false`.

For production, use an exact HTTPS callback, `SESSION_COOKIE_SECURE=true` and `NODE_ENV=production`. The browser page and `/api` must share the configured origin, including scheme, host and port. Keep secrets on the backend; do not expose them through `VITE_` variables.

## Using Issuel

Choose a repository from the sidebar. Use **Refresh repositories** after changing the App's repository access. The globe menu switches interface language; GitHub content retains its original language.

**New issue** requires a title, accepts an optional raw Markdown description and defaults to Backlog. Click a title to edit it: Enter or clicking outside saves, Escape or the cancel icon discards the draft. Failed writes retain the input.

Click the current status to choose another status. Duplicate requires the original issue number from the same repository. A closed issue must first reopen into a selected Open status before changing to another closed reason.

### Status mapping

| Status      | GitHub representation                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| Backlog     | Open without a mapped status label; existing `status:backlog` is also recognized |
| Todo        | Open + `status:todo`                                                             |
| In Progress | Open + `status:in-progress`                                                      |
| In Review   | Open + `status:in-review`                                                        |
| Done        | Closed + `state_reason: completed`                                               |
| Canceled    | Closed + `state_reason: not_planned`                                             |
| Duplicate   | Closed + `state_reason: duplicate`                                               |

Open status changes replace only mapped Open labels and preserve ordinary labels and assignees. Backlog does not require creating a label. A missing target label is created only when explicitly needed by a write. Resolve conflicting Open status labels in GitHub before changing Open status.

### Refresh and limits

Lists are cached in memory for the signed-in browser session. Use **Refresh issues** to see external GitHub changes. Successful Issuel writes update the displayed issue and its list group directly. Closed groups load separately when expanded and provide their own pagination. Counts describe loaded results until loading is complete.

- Existing descriptions and comments are read-only. General label/assignee management and custom status mapping are not available.
- There is no background synchronization or polling. Reloading the browser clears the in-memory issue cache.
- Closed groups use GitHub Search, which may lag behind writes and limits each query to 1,000 results. The interface identifies incomplete or delayed results.
- Same-issue writes are serialized within one server process. Concurrent external edits or writes from multiple server processes can still race when replacing labels.
- If a write's outcome is unknown, check GitHub before retrying, especially when creating an issue.

## Development commands

| Command             | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | Start frontend and API with source watching      |
| `pnpm dev:web`      | Start Vite only                                  |
| `pnpm dev:api`      | Start the API only                               |
| `pnpm lint`         | Run ESLint                                       |
| `pnpm check`        | Run lint, frontend/backend type checks and build |
| `pnpm typecheck`    | Check frontend and backend TypeScript            |
| `pnpm format:check` | Check Prettier formatting                        |
| `pnpm format`       | Format project files                             |
| `pnpm build`        | Build frontend assets and compile the backend    |
| `pnpm start`        | Serve the production build                       |

`pnpm check` runs every check sequentially, continuing after failures. Output is
prefixed with the check name, includes the tools' full diagnostics, and reports
each command's exit code. Frontend and backend type checks both run even if one
fails. Any failed check makes the overall command fail; the final `ELIFECYCLE`
line is a summary, with the actual errors shown above it.

The API writes structured request logs to stdout. `X-Request-ID` correlates API and GitHub requests. Logs omit credentials, cookies and request/response bodies.

## Production

```sh
pnpm build
pnpm start
```

A single Node.js process serves the API and built SPA on port 3000, or the configured `PORT`. Start it from the project root. Deploy `dist`, `package.json` and `pnpm-lock.yaml`, and install runtime dependencies with `pnpm install --prod --frozen-lockfile`. No Vite process is needed at runtime.

- Serve HTTPS with the frontend and `/api` on the same origin, and configure the matching GitHub App callback and backend callback URL.
- Persist the SQLite database directory on local storage and retain the encryption key across restarts. Back up both securely and restrict filesystem access. Changing the key requires signing in again.
- This deployment uses local SQLite and does not provide multi-host shared sessions.
- Redact cookies, authorization headers and OAuth callback query strings in reverse-proxy and monitoring logs.

`GET /api/health` returns `{"status":"ok"}` without checking GitHub or authentication readiness. Missing or invalid production authentication settings leave the SPA and health endpoint available but return `503 auth_not_configured` for protected functionality.

## Troubleshooting

| Problem                            | What to check                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login returns `403 invalid_origin` | Open the Vite frontend on `http://localhost:5173`. Both callback settings must be `http://localhost:5173/api/auth/callback`, even when Hono uses another port. Restart development after configuration changes.                                                          |
| No repositories appear             | Confirm the same App is installed on the repository's owning account, the installation is active, organization approval is complete and your GitHub user has access. Then refresh repositories. `GITHUB_APP_SLUG` controls the installation link, not repository access. |
| Write controls are unavailable     | Writing requires repository push access and the App's Issues write permission.                                                                                                                                                                                           |
| Sessions disappear after restart   | Preserve the database directory and the same encryption key. Logout clears Issuel's local session; it does not revoke the GitHub App authorization.                                                                                                                      |
| GitHub rate limit error            | Wait for the displayed retry time before retrying.                                                                                                                                                                                                                       |

## Project structure

```text
server/           Hono routes, GitHub integration and authentication
src/components/   Workspace, issue detail and local UI components
src/lib/          Queries, mutations, preferences and localization
src/locales/      English and Traditional Chinese dictionaries
src/App.tsx       Authentication and application shell
src/index.css     Tailwind theme and Markdown styles
vite.config.ts    Frontend build, aliases and development proxy
```
