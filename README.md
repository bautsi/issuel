# Issuel

A minimal GitHub Issues client with GitHub App authentication: React + TypeScript SPA built with Vite, Hono on Node.js, Tailwind CSS, and local shadcn/ui components. One repository and one pnpm package.

## Requirements and installation

- Node.js 24 or newer
- pnpm 12.11.2 (declared in `packageManager`)

Run all commands from the project root:

```sh
pnpm install
```

The production SPA and health endpoint run without credentials. Authentication requires the settings below; missing or invalid production configuration returns HTTP 503 with `auth_not_configured`, without configuration values. Production reads process-level settings only. Development loads `.env` and checks configuration before starting the API.

## Development

Copy `.env.example` to `.env` and fill in the GitHub App Client ID, Client secret and encryption key. `pnpm dev` (or `pnpm dev:api`) loads this file for the API and stops startup if the file is missing or required settings are missing or invalid. Errors identify the variable, never its value. The frontend process does not receive the backend's loaded settings. A nonzero API preflight exit also stops the frontend through the existing development process runner.

```sh
pnpm dev
```

- Frontend: http://localhost:5173 (Vite, with hot reload).
- API: http://localhost:3000 (Hono, with automatic restarts).
- Vite forwards `/api` requests to `http://127.0.0.1:3000`. The frontend uses relative URLs, so no CORS setup is needed.
- Click **Connect GitHub** to authorize the GitHub App. After authorization, the page restores your session and displays your GitHub identity. **Logout** invalidates the local session.
- Stop both processes with Ctrl+C. `pnpm dev:web` and `pnpm dev:api` also run them individually.
- Restart `pnpm dev` after changing `.env`; source watching does not reload the environment file.

The health endpoint returns `{"status":"ok"}`. It reports that the API is running; no external services are checked.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

Lint covers frontend, backend, and configuration files. Typecheck covers both frontend/configuration and backend. The build writes frontend assets to `dist/client` and compiles the backend to `dist/server`.

Run `pnpm format` to format source, configuration, and documentation with Prettier. The configuration in `package.json` preserves single quotes and omits semicolons. `.prettierignore` excludes generated output, the pnpm lockfile, environment files, and sensitive filenames. `pnpm format:check` checks formatting without modifying files.

## Production

```sh
pnpm build
pnpm start
```

Open http://localhost:3000. A single Node.js process serves the API and built SPA. No Vite process or TypeScript runner is required in production. Deploy `dist`, `package.json`, `pnpm-lock.yaml`, and the production dependencies (`pnpm install --prod --frozen-lockfile`).

The server uses port 3000 by default and accepts an optional process-level `PORT`. The development proxy targets port 3000. Start the production server from the project root so `dist/client` can be resolved.

API routes take priority; unknown `/api` routes return JSON with status 404. Existing static files are served directly. Other GET requests accepting `text/html` receive the SPA entry point, allowing client-side routes to load directly. Missing built assets return 404.

## Structure

```text
server/index.ts              Hono API and production static/SPA server
server/auth.ts               GitHub App authorization, encrypted SQLite sessions and API origin checks
src/App.tsx                 GitHub sign-in, session restoration and logout
src/main.tsx                React entry point
src/index.css               Tailwind and shadcn/ui theme variables
src/components/ui/button.tsx Local shadcn/ui Button, limited to used variants
src/lib/utils.ts            shadcn/ui class merging utility
components.json             shadcn/ui configuration
vite.config.ts              React, Tailwind, alias, API proxy and client build
tsconfig.json               Frontend and Vite configuration typechecking
tsconfig.server.json        Backend typechecking and compilation
eslint.config.js            TypeScript, React Hooks and refresh checks
```

The `@/` import alias points to `src/`. The design foundation follows the [shadcn/ui manual setup](https://ui.shadcn.com/docs/installation/manual): components live in this repository, using Tailwind theme variables, `cn`, and class variants. The Button is adapted to the native button behavior and variants currently used; no component CLI is needed to run the app.

## GitHub App setup

Register a **GitHub App**, not an OAuth App. Use its **Client ID** and **Client secret**; neither an App private key nor a personal access token is needed for this phase.

1. Open [New GitHub App](https://github.com/settings/apps/new), choose a globally unique App name, and use these settings for local development:

   | Field | Local development setting |
   | --- | --- |
   | Homepage URL | `http://localhost:5173` |
   | Callback URL | `http://localhost:5173/api/auth/callback` |
   | Expire user authorization tokens | Selected |
   | Request user authorization (OAuth) during installation | Unselected |
   | Enable Device Flow | Unselected |
   | Setup URL | Empty |
   | Webhook: Active | Unselected |
   | Where can this GitHub App be installed? | Only on this account |

2. Set repository permissions **Issues: Read and write** and **Contents: Read and write** for the later repository features; Metadata read access is implicit. Leave other permissions at No access, then click **Create GitHub App**.
3. In the App's **General** page, copy the **Client ID** and use **Generate a new client secret** under **Client secrets**. Copy `.env.example` to `.env` locally and fill in `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`. Keep the example's local callback and cookie settings. Never commit or share the real credentials.
4. Generate a session encryption key with this PowerShell command, which copies it to the clipboard without displaying it. Paste it into `SESSION_ENCRYPTION_KEY` in `.env`, and retain the same key across restarts:

   ```powershell
   node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('hex'))" | Set-Clipboard
   ```

5. In the App settings, select **Install App**, choose the owning account, select **Only select repositories**, choose a test repository, and click **Install**. User authorization and repository installation are separate: this phase authenticates a user and does not list repositories or install the App.
6. Run `pnpm dev`, open **http://localhost:5173**, and click **Connect GitHub**. Complete authorization and confirm that the page displays your GitHub identity. Start authorization from this button so the backend can create browser-bound state and PKCE; unsolicited installation callbacks are rejected.

Keep user token expiration enabled; authorization also requests `scope=offline_access` to require expiring tokens. Repository permissions come from the App registration, not OAuth scopes. No webhook receiver or device flow is implemented for this phase. For production, register an exact HTTPS callback such as `https://YOUR_HOST/api/auth/callback` and follow the runtime settings below.

The implementation follows GitHub's [user access token web application flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) and [refresh token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens): PKCE uses S256, and code exchanges and refreshes send form bodies to GitHub over HTTPS. GitHub enforces the original PKCE verifier when redeeming a code. Tokens are never put into request URLs.

### Local login troubleshooting and verification

If `POST /api/auth/login` returns **403** with `{"error":"invalid_origin"}`, check that the browser page origin matches `GITHUB_OAUTH_CALLBACK_URL`'s origin, including scheme, hostname and port. With the development settings above, use **http://localhost:5173**, rather than the API server's port 3000. Set both the GitHub App's Callback URL and `GITHUB_OAUTH_CALLBACK_URL` to `http://localhost:5173/api/auth/callback`, then restart `pnpm dev` after changing `.env`. Do not disable the Origin check to resolve a configuration mismatch.

On 2026-10-24, the user confirmed successful real GitHub login after aligning the local origin as described above. This confirms the initial local login flow; real token refresh, session restoration after server restart, logout and production HTTPS behavior were not confirmed by that manual check. Follow the separate verification steps below for those scenarios.

## Authentication runtime configuration

In development, supply backend settings through `.env`; in production, use process-level settings from your shell or deployment secret manager. Never prefix secrets with `VITE_`, commit credentials, or expose them to the frontend build.

| Variable | Required / default | Purpose |
| --- | --- | --- |
| `GITHUB_APP_CLIENT_ID` | Required | GitHub App Client ID, not App ID |
| `GITHUB_APP_SLUG` | Required for an installation link before the user's first installation | Public URL name from `https://github.com/apps/<slug>`; verified against `GITHUB_APP_CLIENT_ID` |
| `GITHUB_APP_CLIENT_SECRET` | Required | GitHub App Client secret |
| `GITHUB_OAUTH_CALLBACK_URL` | Required | Exact `/api/auth/callback` URL on the browser-facing origin; no query, fragment or URL credentials |
| `SESSION_ENCRYPTION_KEY` | Required | 32 random bytes encoded as exactly 64 hexadecimal characters; retain across restarts |
| `SQLITE_DATABASE_PATH` | `./data/auth.sqlite` | Persistent auth database, relative to working directory or absolute; `:memory:` is rejected |
| `SESSION_COOKIE_SECURE` | `true` | Set `false` only for local HTTP development with a loopback callback host |
| `NODE_ENV` | Deployment-defined | Set `production` in production; insecure cookies and HTTP callbacks are then rejected |
| `PORT` | `3000` | API / production server port; development proxy expects 3000 |

For local development use callback `http://localhost:5173/api/auth/callback` and `SESSION_COOKIE_SECURE=false`; always browse through `http://localhost:5173`. For a local production build preview, use callback `http://localhost:3000/api/auth/callback` with the same explicit insecure-cookie setting and without `NODE_ENV=production`. In deployment use HTTPS, `SESSION_COOKIE_SECURE=true`, and `NODE_ENV=production`. Origin checks use the configured callback origin, including port, rather than trusting forwarded headers. Configure TLS termination to expose the frontend and `/api` on that same origin. No CORS allowlist is needed.

Generate the encryption key inside the secret manager, or assign it without printing it in PowerShell:

```powershell
$env:SESSION_ENCRYPTION_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Persist that value securely before relying on sessions across restarts; do not regenerate it on each launch. Changing the key makes existing encrypted tokens and pending authorization flows unreadable. Key rotation with re-encryption is not implemented; rotating the key requires revoking existing local sessions and signing in again.

## Authentication endpoints and security

| Endpoint | Behavior |
| --- | --- |
| `POST /api/auth/login` | Requires exact same `Origin`; creates a 10-minute browser-bound flow and redirects to GitHub |
| `GET /api/auth/callback` | Atomically consumes valid state, decrypts and redeems its PKCE verifier, verifies `/user`, and creates a fresh session |
| `GET /api/auth/session` | Returns `{ user: { id, login, name }, expiresAt }`; refreshes expiring tokens and verifies identity with GitHub; 401 if unauthenticated |
| `POST /api/auth/logout` | Requires exact same `Origin`; revokes the local session and pending flow, expires both cookies, and returns 204 |
| `GET /api/health` | Remains available without auth configuration or GitHub connectivity |

Session IDs and flow-cookie IDs contain 256 random bits. SQLite stores only their SHA-256 hashes. Cookies are HttpOnly, SameSite=Lax, host-only, Path=/, with explicit expiration. HTTPS cookies use the `__Host-` prefix and Secure. A new login replaces the browser's previous session only after successful authorization; IDs are never reused. State is random, stored as a hash, bound to a separate browser cookie, and deleted before code exchange. Replay, expiry, duplicate state/code parameters and missing browser binding are rejected. Redirects carry only fixed error codes; callback responses set `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

All unsafe `/api` requests (POST/PUT/PATCH/DELETE and other non-safe methods) require the exact configured `Origin` and reject `Sec-Fetch-Site: cross-site`. Missing or `null` Origin is rejected; command-line clients must explicitly provide the correct Origin. Register future API routes **after** the auth mount so they inherit this guard. Future protected resource routes must also enforce session authentication; the Origin guard alone is not authorization. No route changes state through GET except the browser-bound OAuth callback and internal authentication maintenance.

### SQLite and encryption

Uses Node.js 24's built-in `node:sqlite` `DatabaseSync` and `node:crypto`; no additional dependencies, ORM, issue tables or auth server.

- `oauth_flows`: `state_hash` primary key, `browser_hash`, encrypted `verifier`, `expires_at`.
- `sessions`: `id_hash` primary key, `github_user_id`, encrypted `access_token` and `refresh_token`, `access_expires_at`, `refresh_expires_at`, `expires_at`, nullable `refresh_started_at` rotation claim.
- Times are Unix milliseconds. Sessions have a fixed maximum lifetime of 30 days, capped at the initial refresh-token expiry. Expired rows are removed during auth activity; no background scheduler is needed.
- Each encrypted value uses AES-256-GCM with a fresh random 12-byte nonce and a 16-byte authentication tag. Row hash and field purpose are authenticated as additional data, preventing ciphertext substitution between rows or between access/refresh/PKCE fields. Packed ciphertext contains nonce, tag and ciphertext in base64url. The encryption key is never stored in SQLite.
- WAL and `synchronous=FULL` persist rotations; access token, refresh token and expirations update together in one SQL statement. The database and key must both survive restart. Database file mode is restricted to 0600 and newly created directories to 0700 where supported. On Windows, apply an OS ACL restricting the directory to the service account; POSIX mode bits do not provide an equivalent Windows ACL.

Access tokens refresh on session access when less than 60 seconds remain. An atomic SQLite compare-and-set claim allows one refresh per session, including across processes sharing the local database. Other requests receive 503 `refresh_in_progress` with Retry-After. General upstream failures return sanitized 503 errors and preserve the session. Definitively invalid refresh tokens or GitHub `/user` 401 responses for the current token invalidate the local session and return 401. A stale request's 401 during or after another request's rotation returns temporary 503 without deleting the updated session. Tokens and provider response bodies are never logged or returned to React.

If a process dies after claiming a rotation, requests return temporary 503 for up to 60 seconds, then invalidate the abandoned session and require login. This deliberately avoids replaying a possibly consumed refresh token. A provider rotation followed by a lost network response can likewise require reauthorization on the next attempt; atomic transactions cannot span GitHub and SQLite. A successful rotation whose local save fails keeps the claim for the same recovery behavior. Logout cannot recreate a session even if a refresh request is in flight.

### Deployment limits and manual verification

Use a persistent local volume, not ephemeral container storage or a network filesystem. This phase targets one application deployment with SQLite; it does not provide multi-host shared sessions. Restrict and back up the database directory (including WAL files) and encryption key separately. Never enable SQL parameter tracing or log authorization bodies, Cookie/Set-Cookie headers, or OAuth callback query strings in a reverse proxy or monitoring service. HTTPS and proxy log redaction are deployment responsibilities.

Logout invalidates Issuel's local session; it does not revoke the GitHub App authorization. Revocation webhooks, remote logout, automated key rotation, rate limiting and an idle-session timeout are outside this phase. `/session` checks GitHub identity on every request, so a temporary GitHub outage shows an error while retaining the stored session. Revocation is detected on the next GitHub request, not pushed immediately by webhook.

Real OAuth end-to-end and refresh-rotation verification requires an actual GitHub App registration, Client ID/secret, correctly registered callback, and a user installing/authorizing it. Local provider mocks verify application behavior only, not GitHub's acceptance of those credentials or browser integration. To verify with your App:

1. Set runtime configuration securely and start `pnpm dev`. Connect GitHub, authorize, and confirm your identity appears.
2. Reload the page and restart the server with the same database path and encryption key. Confirm the identity restores.
3. Confirm the browser has only HttpOnly session/flow cookies, no GitHub tokens in responses, URLs or browser storage. Verify cookie attributes in DevTools, including Secure on HTTPS.
4. Cancel authorization and replay an already-used callback; confirm safe errors and no new session. Reject POST logout with missing or foreign Origin.
5. After the real access-token expiration window, access the session concurrently, confirm rotation persists, then reload/restart. Test a revoked GitHub authorization separately.
6. Logout, reload, and confirm `/api/auth/session` returns 401. Unset runtime configuration in an isolated process; confirm auth returns sanitized 503 while `/api/health` and the SPA remain available.

Issue operations, testing frameworks, Docker, and CI/CD remain outside this phase.

## Repository workspaces (ISL-3)

After login, choose a repository in **Choose a repository**. Search by owner/name, select a workspace, or use **Switch workspace**. Private/public visibility is displayed for each repository. Each repository is an independent workspace; this phase does not fetch issues, comments or labels.

`GET /api/repositories` uses the current server-side session and its GitHub App user access token. It fetches every page of `GET /user/installations` and `GET /user/installations/{installation_id}/repositories` with `per_page=100`, following the presence of `rel="next"` in Link headers. It excludes suspended installations, deduplicates by stable numeric repository ID, and returns only repository ID, name, full_name, owner login, visibility, repository permissions and installation IDs/permissions. It never falls back to `/user/repos` or includes upstream credential fields. Repository permissions describe the user's access; installation permissions describe the App's grant, and neither alone authorizes a future operation.

GitHub documents no additional permissions for listing user installations, and **Metadata: read** repository permission for listing their repositories. Both use GitHub App user access tokens, including for private repositories. See the [installation API reference](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token) and [pagination reference](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api).

The endpoint returns `401` for missing/expired sessions or revoked authentication, `403 github_forbidden` for denied access, `404 github_not_found` for an inaccessible installation, `429 github_rate_limited` with a safe `retryAfter` value and `Retry-After` header for primary/secondary limits, and `502/503` for malformed responses or provider/service failures. An installation failure rejects the entire discovery rather than presenting a partial list as complete. Responses use `Cache-Control: no-store`; transient errors retain the last preference but hide the unverified workspace and picker until retry succeeds.

Only the selected repository ID is saved under `issuel:workspace:<github-user-id>` in localStorage. Logout preserves this preference for the next login. Every mount, retry, switch-picker opening and window focus reloads access from the server. A successful discovery that no longer contains the saved ID clears it and displays the access-revoked state. Browser storage failures leave selection usable for the current visit with a warning. This is a preference, never an authorization record: future repository-specific endpoints must freshly verify the session user's access before reading or writing repository data.

### GitHub App installation link

GitHub sign-in authorizes the App to act for the user; it does **not** install the App on an account or grant it access to that account's repositories. Configuring `GITHUB_APP_SLUG` enables an installation link; it does **not** grant repository access either.

For users with an installation, GitHub's `app_slug` determines the installation link. For a user with **zero installations**, set the public server runtime variable **`GITHUB_APP_SLUG`** to the URL-friendly name shown in the App's GitHub settings/public-page URL. No new secret is required. Before offering this configured link, the server calls `GET /apps/{app_slug}` and checks that its `client_id` matches the existing `GITHUB_APP_CLIENT_ID`; a mismatch, missing setting, invalid slug or lookup failure never produces a guessed link. Runtime configuration is read by the backend only; no environment files are changed by this feature.

The installation URL follows GitHub's documented `https://github.com/apps/APP-NAME/installations/new` form. See [Get an app](https://docs.github.com/en/rest/apps/apps#get-an-app) and [sharing an installation link](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app#sharing-your-github-app-via-an-install-link). Private Apps and organization policies may require their owner or an organization administrator to install/approve access. The link opens in another tab; return to Issuel or click **Refresh repositories** after installation.

### First repository setup and empty-list troubleshooting

1. As the App owner, open the owning personal account or organization's **Settings → Developer settings → GitHub Apps**, edit the same App used by `GITHUB_APP_CLIENT_ID`, and choose **Install App**. App users can instead use Issuel's installation link or request one from the App owner. See GitHub's [installation instructions](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).
2. Install on the account that **owns the repository**. Select **Only select repositories** and add the repositories you want to use, or choose **All repositories** if that scope is intended. Complete installation or obtain organization approval. The signed-in user must also have access to those repositories.
3. If already installed, open **Configure → Repository access**, add the missing repositories and save. Personal installations are under **Settings → Applications → Installed GitHub Apps**; organization installations are under **Organization Settings → GitHub Apps**. Confirm the installation is not suspended. See [modifying installed Apps](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).
4. Set `GITHUB_APP_SLUG` in the backend runtime settings to the final segment of this App's public-page URL (for example, `my-app` from `https://github.com/apps/my-app`). Restart the API; when using `pnpm dev`, stop and restart it after changing runtime settings. This setting is public metadata, not the Client ID, display name, Client secret or private key.
5. Return to Issuel and click **Refresh repositories**, then select a workspace. Updating installation access does not require logging out or repeating OAuth.

If `/api/repositories` succeeds with `repositories: []`, `installationUrl: null` and `installationNotice: "app_slug_not_configured"`, GitHub returned no installations visible to the current user token, and the server could not produce a verified installation link. Check installation and repository access first, then check that `GITHUB_APP_SLUG` is present, valid and belongs to the configured Client ID. The notice does not by itself indicate a bad Client secret or failed sign-in. If installation is complete but the list remains empty, verify that it is the same GitHub App used for login and that the signed-in user can access the selected repositories.

### Browser acceptance checks

Use an already configured running server and an actual GitHub App session:

1. Login and inspect `/api/repositories` in DevTools. Compare the list against this App's granted repositories across personal and organization installations, including a private repository. Confirm an accessible repository outside the App grant is absent. Inspect responses/storage for absence of GitHub tokens.
2. Search by repository name/owner, select A, then switch to B. Confirm owner and visibility labels, and confirm no OAuth redirect occurs when switching.
3. Reload, then logout/login as the same user: B should restore after fresh discovery. Login as another GitHub user: preferences must remain separate. With localStorage disabled, verify selection works and a storage warning appears.
4. Remove B from the App's grant (or revoke the user's repository access), then return to Issuel/reload. Confirm B disappears, its saved preference is cleared after successful discovery, and the revoked message asks for another choice. A temporary GitHub failure must hide the workspace without erasing its preference.
5. With zero installations, verify the empty state and the installation link for the configured App. Complete installation in the new tab, return, and refresh. An incorrect `GITHUB_APP_SLUG` must not link to another App.
6. Logout, then open `/api/repositories`: expect 401. With the page open, expire/remove the Issuel session or revoke GitHub authorization, then focus/retry discovery: expect the login prompt with a session-expired message. Inspect denied/removed installation and rate-limit responses where reproducible; retry only after the indicated delay.
7. With accounts exceeding 100 installations or 100 repositories in one installation, confirm later pages appear. Without such real accounts, pagination can only be checked using a local mock; do not treat that as live GitHub acceptance.

Access changes are discovered on a fresh request, not pushed by webhook. There is no periodic background polling, permanent repository cache, workspace database table, or repository-specific data endpoint in this phase.
