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

### Basic request logging

The API writes JSON lines to stdout (the API terminal during `pnpm dev`). `http.request` and `http.response` share a server-generated `requestId`, also returned as `X-Request-ID`. Response logs include the HTTP status, total `durationMs`, `githubAccessed` and `githubRequests`. Each attempted GitHub call adds `github.request` followed by `github.response` (HTTP status and time to response headers) or `github.error` (a sanitized network failure), using the same request ID. This covers authentication/token exchange, repository discovery and issue pages, including manually followed GitHub redirects.

Only method, host/path and validated issue pagination/category values are recorded. Logs omit request/response bodies, authorization/cookie headers, OAuth query values and raw error messages. There is no file logger, external logging service or new logging dependency. `githubAccessed: false` means that API request attempted no GitHub fetch; it does not mean the frontend used its cache. A frontend cache hit that sends no API request produces no server log. Vite-served pages and assets are outside these API logs.

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

## Interface language

The globe menu beside the account actions switches between English (default) and Traditional Chinese. `i18next` and `react-i18next` use bundled dictionaries in `src/locales/`, with no translation service or extra network requests. The selection is saved as the browser preference `issuel:language` and updates the document language and issue date formatting. When browser storage is unavailable, switching still works for the current visit. GitHub titles, labels, repository names and identities retain their original content. Language changes preserve the mounted workspace, issue cache and pagination.

## GitHub App setup

Register a **GitHub App**, not an OAuth App. Use its **Client ID** and **Client secret**; neither an App private key nor a personal access token is needed for this phase.

1. Open [New GitHub App](https://github.com/settings/apps/new), choose a globally unique App name, and use these settings for local development:

   | Field                                                  | Local development setting                 |
   | ------------------------------------------------------ | ----------------------------------------- |
   | Homepage URL                                           | `http://localhost:5173`                   |
   | Callback URL                                           | `http://localhost:5173/api/auth/callback` |
   | Expire user authorization tokens                       | Selected                                  |
   | Request user authorization (OAuth) during installation | Unselected                                |
   | Enable Device Flow                                     | Unselected                                |
   | Setup URL                                              | Empty                                     |
   | Webhook: Active                                        | Unselected                                |
   | Where can this GitHub App be installed?                | Only on this account                      |

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

| Variable                    | Required / default                                                     | Purpose                                                                                            |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`      | Required                                                               | GitHub App Client ID, not App ID                                                                   |
| `GITHUB_APP_SLUG`           | Required for an installation link before the user's first installation | Public URL name from `https://github.com/apps/<slug>`; verified against `GITHUB_APP_CLIENT_ID`     |
| `GITHUB_APP_CLIENT_SECRET`  | Required                                                               | GitHub App Client secret                                                                           |
| `GITHUB_OAUTH_CALLBACK_URL` | Required                                                               | Exact `/api/auth/callback` URL on the browser-facing origin; no query, fragment or URL credentials |
| `SESSION_ENCRYPTION_KEY`    | Required                                                               | 32 random bytes encoded as exactly 64 hexadecimal characters; retain across restarts               |
| `SQLITE_DATABASE_PATH`      | `./data/auth.sqlite`                                                   | Persistent auth database, relative to working directory or absolute; `:memory:` is rejected        |
| `SESSION_COOKIE_SECURE`     | `true`                                                                 | Set `false` only for local HTTP development with a loopback callback host                          |
| `NODE_ENV`                  | Deployment-defined                                                     | Set `production` in production; insecure cookies and HTTP callbacks are then rejected              |
| `PORT`                      | `3000`                                                                 | API / production server port; development proxy expects 3000                                       |

For local development use callback `http://localhost:5173/api/auth/callback` and `SESSION_COOKIE_SECURE=false`; always browse through `http://localhost:5173`. For a local production build preview, use callback `http://localhost:3000/api/auth/callback` with the same explicit insecure-cookie setting and without `NODE_ENV=production`. In deployment use HTTPS, `SESSION_COOKIE_SECURE=true`, and `NODE_ENV=production`. Origin checks use the configured callback origin, including port, rather than trusting forwarded headers. Configure TLS termination to expose the frontend and `/api` on that same origin. No CORS allowlist is needed.

Generate the encryption key inside the secret manager, or assign it without printing it in PowerShell:

```powershell
$env:SESSION_ENCRYPTION_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Persist that value securely before relying on sessions across restarts; do not regenerate it on each launch. Changing the key makes existing encrypted tokens and pending authorization flows unreadable. Key rotation with re-encryption is not implemented; rotating the key requires revoking existing local sessions and signing in again.

## Authentication endpoints and security

| Endpoint                 | Behavior                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`   | Requires exact same `Origin`; creates a 10-minute browser-bound flow and redirects to GitHub                                            |
| `GET /api/auth/callback` | Atomically consumes valid state, decrypts and redeems its PKCE verifier, verifies `/user`, and creates a fresh session                  |
| `GET /api/auth/session`  | Returns `{ user: { id, login, name }, expiresAt }`; refreshes expiring tokens and verifies identity with GitHub; 401 if unauthenticated |
| `POST /api/auth/logout`  | Requires exact same `Origin`; revokes the local session and pending flow, expires both cookies, and returns 204                         |
| `GET /api/health`        | Remains available without auth configuration or GitHub connectivity                                                                     |

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

After login, choose a repository directly from the compact, persistent left sidebar. Search by owner/name, click another repository to switch, or use the refresh icon to reload available repositories. A lock icon identifies private repositories. Each repository is an independent workspace; this phase does not fetch issues, comments or labels.

`GET /api/repositories` uses the current server-side session and its GitHub App user access token. It fetches every page of `GET /user/installations` and `GET /user/installations/{installation_id}/repositories` with `per_page=100`, following the presence of `rel="next"` in Link headers. It excludes suspended installations, deduplicates by stable numeric repository ID, and returns only repository ID, name, full_name, owner login, visibility, repository permissions and installation IDs/permissions. It never falls back to `/user/repos` or includes upstream credential fields. Repository permissions describe the user's access; installation permissions describe the App's grant, and neither alone authorizes a future operation.

GitHub documents no additional permissions for listing user installations, and **Metadata: read** repository permission for listing their repositories. Both use GitHub App user access tokens, including for private repositories. See the [installation API reference](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token) and [pagination reference](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api).

The endpoint returns `401` for missing/expired sessions or revoked authentication, `403 github_forbidden` for denied access, `404 github_not_found` for an inaccessible installation, `429 github_rate_limited` with a safe `retryAfter` value and `Retry-After` header for primary/secondary limits, and `502/503` for malformed responses or provider/service failures. An installation failure rejects the entire discovery rather than presenting a partial list as complete. Responses use `Cache-Control: no-store`; transient errors retain the last preference but hide the unverified workspace and picker until retry succeeds.

Only the selected repository ID is saved under `issuel:workspace:<github-user-id>` in localStorage. Logout preserves this preference for the next login. Every mount, navigation and explicit repository-list refresh reloads access from the server. Returning focus to the window preserves the current workspace without another discovery request. A successful discovery that no longer contains the saved ID clears it and displays the access-revoked state. Browser storage failures leave selection usable for the current visit with a warning. This is a preference, never an authorization record: future repository-specific endpoints must freshly verify the session user's access before reading or writing repository data.

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
6. Logout, then open `/api/repositories`: expect 401. With the page open, expire/remove the Issuel session or revoke GitHub authorization, then explicitly retry discovery: expect the login prompt with a session-expired message. Inspect denied/removed installation and rate-limit responses where reproducible; retry only after the indicated delay.
7. With accounts exceeding 100 installations or 100 repositories in one installation, confirm later pages appear. Without such real accounts, pagination can only be checked using a local mock; do not treat that as live GitHub acceptance.

Access changes are discovered on a fresh request, not pushed by webhook. There is no periodic background polling, permanent repository cache, workspace database table, or repository-specific data endpoint in this phase.

## Isolated repository workspaces (ISL-4)

React Router opens repositories at `/workspace/:owner/:repo`. Selecting a repository adds a browser-history entry; Back/Forward, direct links and refresh restore the corresponding workspace. Opening `/` restores the last accessible repository ID after discovery. The existing Vite development fallback and Hono production HTML fallback serve direct workspace links.

`GET /api/workspaces/:owner/:repo` reuses the existing authenticated session, token refresh and complete repository discovery. It returns the accessible repository list and the verified `repository`, or `404 workspace_not_found` with `repository: null`. Missing/expired sessions return 401. Browser storage and history cannot authorize access. Each route change, retry and explicit repository-list refresh checks current GitHub access; the previous workspace is hidden immediately during verification. A failed request never displays a stale workspace. Logout unmounts the workspace and invalidates the existing server session.

Names are mutable routing labels; GitHub user ID and numeric repository ID determine workspace identity. Browser history stores both IDs as an untrusted identity hint, so an existing history entry follows a renamed repository even if its old name is reused. The server always matches that hint against fresh access. Direct links use the current owner/name; an old link can follow GitHub's rename redirect, with at most three redirects restricted to `https://api.github.com`. The browser replaces the old URL with the current canonical owner/name. If GitHub no longer redirects an old name, an old name-only link cannot recover the original repository; choose its current name from the selector. See [GitHub repository renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

The workspace component is keyed by user ID and repository ID. Local UI preferences use `issuel:preferences:<github-user-id>:<repository-id>`, separately from the existing last-selection key `issuel:workspace:<github-user-id>`. Defaults are Backlog/Todo/In Progress/In Review expanded, Done/Canceled/Duplicate collapsed, Last Updated sort and empty filters. Only default sorting has a control in this phase; group/filter controls belong to the future issues UI. Invalid stored values fall back to defaults, and blocked storage keeps preferences usable in memory for the current mounted workspace with a warning. Logout preserves local preferences. No preferences are stored in SQLite or GitHub.

There is no issue request or query cache yet. Future repository query keys must follow `['github', userId, repositoryId, resourceType, ...identifiers]`; never use owner/name alone or omit the user. No TanStack Query dependency, unused queries, issue data, business tables, polling or synchronization service were added.

### Workspace acceptance checks

With your configured server and real GitHub App session:

1. Select A, change the issue sort menu to Title, switch to B and confirm its URL and default Last Updated sort. Change B to Created, then switch back to A: Title must restore. Repeat with another GitHub user to confirm independent preferences.
2. Use Back/Forward between A and B. Paste either canonical URL in a new tab and refresh. Confirm the correct repository appears only after access verification, without another OAuth flow.
3. Open a nonexistent repository URL and a real repository outside the App grant. Both must show the unavailable/not-authorized screen without rendering repository content. Remove access to the current repository, return to the tab or refresh, and confirm it is rejected. Local preference/history edits must not bypass this check.
4. Rename A, then revisit its existing history entry or refresh it. Confirm the canonical URL changes while repository ID and sort remain unchanged. Repeat with an old name-only link while GitHub still redirects it. A newly created repository reusing the old name must have its own ID/preferences.
5. Logout and revisit a workspace URL: only the login screen should remain. Verify `/api/workspaces/owner/repo` returns 401 without a session. Recheck existing login, session restoration, token refresh and logout with your real GitHub App.
6. Block localStorage or insert malformed preference JSON. Confirm safe defaults and a usable workspace. Group expansion and filter defaults are storage foundations only; there is no Issues List to exercise them yet.

Real authorization, removal of GitHub permissions, repository renaming and OAuth/token-refresh acceptance require a configured GitHub App; static checks or an unauthenticated preview do not confirm those external scenarios.

## Grouped GitHub Issues (ISL-5)

Startup first shows a quiet Issuel wordmark with a subtle loading line. A confirmed signed-in session opens the workspace shell with header/sidebar placeholders and a single loading region. Status groups and actual rows appear together after the first successful Open page, without assuming three rows per group; empty-group messages stay visible during later pagination. A stable scrollbar gutter prevents width changes when the list becomes scrollable. Only a confirmed unauthenticated session shows the login introduction; a session-check outage shows a retryable error page. The desktop sidebar is 216px wide and always lists available repositories. Sorting uses the local shadcn New York Select built on Radix, with keyboard navigation and a styled popup.

The workspace now incrementally loads Open issues and presents **In Progress**, **In Review**, **Todo**, **Backlog**, **Done**, **Canceled**, and **Duplicate**. Open groups default to expanded; all three Closed groups default to collapsed. Expansion and the existing sort preference are saved in the ISL-4 user/repository preference record. Status icons, GitHub issue numbers, titles, ordinary labels, assignees and last-update dates appear in compact rows. The default sort is Last Updated descending. Created and Title preferences sort only the currently loaded results; GitHub pagination always uses Last Updated descending.

### Read API and permissions

`GET /api/repositories/:repositoryId/issues?state=open&page=1&per_page=100`

- `state`: `open` (default) or `closed`; `page`: positive safe integer (default 1); `per_page`: 1–100 (default 100 for Open, 10 for Closed). Closed accepts `category=done|canceled|duplicate` (default `done`); Open rejects `category`. Invalid or repeated parameters, or a Closed page starting beyond Search's first 1,000 results, return `400 invalid_issue_parameters`.
- Every page uses the server-side GitHub App **user access token**, existing session refresh and a complete App-and-user repository discovery. Complete discovery snapshots and concurrent discovery requests are reused within the same session and token generation for up to 30 seconds (at most 100 in-memory entries). Failed discovery is never retained; GitHub 401/403/404 clears the snapshot, and **Refresh repositories** bypasses a completed snapshot. A numeric ID, URL or browser preference never grants access. The repository must belong to the discovery result and an active installation must grant **Issues: read** or **Issues: write**. GitHub also authorizes every actual issue read; there is no anonymous/public-repository fallback. Installation-grant changes can take up to 30 seconds to appear in this snapshot.
- Open uses `GET /repositories/{verified-id}/issues` with `state=open`, `page`, `per_page`, `sort=updated` and `direction=desc`. Closed uses `GET /search/issues` with the freshly authorized repository's canonical `full_name`, `sort=updated`, `order=desc`, `page`, `per_page`, and exactly one of the queries below. Closed results must match both the requested repository URL and `state_reason`; unexpected reasons or PRs reject the entire page with `github_search_mismatch`, rather than silently dropping records or filling other groups. The response contains `userId`, `repositoryId`, `state`, `category` (null for Open), `page`, `perPage`, `nextPage` (number or null), `searchLimited` and `issues`.
- Each issue contains `id`, `number`, `title`, `state`, `state_reason`, `labels` (ID/name/color), `created_at`, `updated_at`, `closed_at`, author identity, assignee identities and comment count. Provider bodies, tokens and issue descriptions are not forwarded. SQLite remains authentication-only; issues are never persisted to a database, browser storage or disk cache.
- Open objects with a `pull_request` field are discarded before projection. Open's `nextPage` comes from GitHub's `Link` header independently of the remaining issue count: even an all-PR page can have a next page. Closed's `nextPage` uses Search's validated `total_count` and the 1,000-result ceiling. Requests are reconstructed server-side; no caller-provided pagination URL is followed.
- Missing/expired/revoked sessions return 401; denied Issues permission returns 403; repositories outside current access return 404 without issue data. GitHub primary/secondary limits return 429 with `Retry-After`; malformed provider data returns 502; network/provider/service failures return a sanitized 503. The session is checked again after upstream reads, so logout/expiry cannot expose a late successful response. All API responses remain `Cache-Control: no-store`.

GitHub documents that the [repository Issues API](https://docs.github.com/en/rest/issues/issues#list-repository-issues) includes PRs and supports GitHub App user tokens with **Issues: read**. See the [pagination reference](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) and [rate-limit/error guidance](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api).

The three Closed queries are independent:

| Group     | GitHub Search query                                          |
| --------- | ------------------------------------------------------------ |
| Done      | `repo:OWNER/REPO is:issue state:closed reason:completed`     |
| Canceled  | `repo:OWNER/REPO is:issue state:closed reason:"not planned"` |
| Duplicate | `repo:OWNER/REPO is:issue state:closed reason:duplicate`     |

GitHub's [Search documentation](https://docs.github.com/en/rest/search/search#about-search) limits each query to 1,000 retrievable results and has a separate search rate limit. A larger `total_count` sets `searchLimited: true`: the UI shows an explicit warning and partial counts even after the last retrievable page. `incomplete_results: true` rejects that page with `github_search_incomplete`; previously accepted pages remain visible and retry targets the same failed page. No automatic retries, silent truncation, merged Closed download or client-side repartitioning is used.

On 2026-10-25, live Search calls through the connected GitHub account returned three matching issues for each reason in `microsoft/vscode`. Individual Issue reads independently confirmed `state_reason` for [Done #341705](https://github.com/microsoft/vscode/issues/341705) (`completed`), [Canceled #332105](https://github.com/microsoft/vscode/issues/332105) (`not_planned`) and [Duplicate #295363](https://github.com/microsoft/vscode/issues/295363) (`duplicate`). Each issue also appeared in its reason query when its number was added. The Duplicate issue was absent from the completed/not-planned control results; the completed issue was absent from the duplicate control. This establishes actual Duplicate semantics beyond HTTP 200, even though the general search-qualifier documentation currently lists only completed/not-planned. These connector checks do not verify the application's private-repository session, App permissions or UI end to end.

### Status mapping

These are **Issuel product defaults**, not a fixed status list for every Linear workspace. The pure `server/issue-status.ts` module centralizes names, GitHub state/label mappings and initial expansion for both API and UI. The `getIssueStatus` function resolves them case-insensitively:

| UI status   | GitHub source                             |
| ----------- | ----------------------------------------- |
| Backlog     | Open + `status:backlog`, or Open fallback |
| Todo        | Open + `status:todo`                      |
| In Progress | Open + `status:in-progress`               |
| In Review   | Open + `status:in-review`                 |
| Done        | Closed + `state_reason=completed`         |
| Canceled    | Closed + `state_reason=not_planned`       |
| Duplicate   | Closed + `state_reason=duplicate`         |

GitHub state is authoritative. Closed groups use the native `state_reason`; labels cannot change a Closed issue's group, and missing/unknown reasons are not guessed to mean Done. A single residual Canceled/Duplicate status label on an Open issue cannot make it Closed and falls back to Backlog. Multiple distinct mapped labels on Open remain conflicts, including a residual Closed marker together with another mapped label.

Conflicting Open issues remain visible in **Mapping conflicts**, with every conflicting label named, and are excluded from the status groups. The conflict count always says loaded. Closed search responses are already separated by reason and are rendered directly from their own query pages. Unmapped labels, including unknown `status:*` names, remain ordinary labels. Recognized mapped labels are omitted from ordinary badges. No labels or issues are mutated.

Existing per-workspace expansion choices are retained; newly added statuses receive their product defaults. Repository config reads/writes, manual mapping UI and saving `.github/linear-client.yml` remain ISL-14 work. This phase adds no workflow engine, issue database or config write.

### Incremental loading and cache

TanStack Query's infinite queries keep successfully loaded pages in memory. Keys are `['github', userId, repositoryId, 'issues', state, { category, reason, perPage, sort: 'updated', direction: 'desc' }]`, where `category`/`reason` are null for Open or identify the requested Closed reason. Including the native reason prevents reuse of the earlier label-based cache. `perPage` is 100 for Open and 10 per Closed category; each page number is retained in `pageParams`. There is no cross-repository or cross-category placeholder data. Fetches consume the query AbortSignal, so unmounting a workspace cancels its browser request. Logout/session rejection clears the cache; local UI preferences remain separate.

Open's first page renders immediately, then subsequent pages load sequentially. Only a successful terminal page marks the list complete. Partial counts say **loaded**, and empty partial groups say no matching issues have loaded yet. Failures retain earlier pages and show **Incomplete results** plus **Retry failed page**. Retry resumes the failed page, without restarting all successful pages. Retries are explicit, and rate-limit/service retry delays prevent an early retry from sending another request for that query. There is no scheduler or unlimited retry loop.

Done, Canceled and Duplicate each have an independent Closed Search query, Loading, Error and pagination state. Expanding a group requests only that reason's first page, including a previously saved expanded preference. Its full-width **Load more…** row appends only that group's next 10 results; loading, failures and retries do not advance another group. Collapsing/reopening keeps its cached pages. No extra pages are drained automatically. Counts remain partial until the category's successful terminal page, and always remain partial if Search's result ceiling was reached. Each query can have at most one page request in flight. No polling, focus refetch, reconnect refetch or timed refresh is configured. Cached pages remain available for the signed-in browser session across workspace UI remounts. Returning from another tab/window leaves the workspace mounted without a discovery request or loading screen. Browser reload starts a new in-memory cache.

### Cache-first navigation and manual refresh (ISL-6)

The existing app-wide `QueryClient` survives repository navigation. Discovery uses `['github', userId, 'repositories']`; normal routes resolve names and history repository IDs against that cached list. Unknown name-only links still use the server's authorized rename resolution. Initial discovery, canonical URL redirects, repository switches and Back/Forward reuse discovery instead of requesting the same access list again. Stable issue keys and `pageParams` keep users, repositories, reasons and pagination isolated. The query function yields one microtask before consuming its abort signal so React StrictMode's immediate development remount shares the initial request; later unmounts and explicit cancellations still abort requests. Logout/session rejection clears private caches. Cached lists remain available until explicit refresh or browser reload; their contents can be outdated.

**Refresh issues** starts a new Open read from page one and follows its new `nextPage` chain to completion, even if the refreshed list has more or fewer pages than before. Only currently expanded Closed groups with accepted pages are also refreshed, each through its previously loaded depth; collapsed/unloaded groups are untouched. Only the refresh icon changes to a spinner during refresh; no progress banner is inserted. Existing rows remain visible. New pages are staged separately and replace the accepted query only after that refresh succeeds. A failed refresh shows **Issue refresh failed. Please retry.** beside the refresh icon, preserving that group's old data, completeness/counts, pagination errors and next page. After refresh settles, **Load more…** still loads the original next page; it never retries the whole refresh. Retrying with the toolbar icon starts again from page one, while a failed ordinary pagination request remains a group-level error and retries only its failed page. Older pagination is cancelled before refresh and again before committing successful new data, so superseded responses cannot overwrite it even after a workspace remount. Other repositories' caches remain untouched.

To compare requests, use the browser Network panel and the existing request logs: returning to a fully loaded repository should send no discovery/Issues request; sorting, group toggles and rerenders should not repeat accepted pages. First expanding Done should request only `category=done`. Refresh should send Open pages 1 through the terminal page and only the eligible Closed pages. During the 30-second authorization reuse window, pages still call GitHub's Issues/Search endpoint, but omit repeated installation/repository enumeration. Explicit sidebar discovery refresh still fetches fresh access metadata.

For manual acceptance, load repositories A and B and use Back/Forward to return to A; verify cached rows and request counts. Change an issue on GitHub and use **Refresh issues** to verify its title/status/count updates. Expand and paginate only Done, refresh, and confirm Canceled/Duplicate are not requested; collapse Done and refresh to confirm it is skipped. Simulate network failure or 429 with `Retry-After` during a later refresh page: the previous snapshot must retain its completeness/counts, the error must appear only beside the refresh icon, and an early refresh retry must not send another GitHub request. After a failed refresh, confirm Done's **Load more…** still loads its original next page instead of retrying the refresh. Delay an ordinary pagination response, refresh, then release the old response and confirm it cannot replace the refreshed rows. Also check an empty Open list, independent Closed pagination failures, session expiry, revoked repository/App Issues access, and tab focus without refetch. These are manual acceptance steps, not a claim of live GitHub/browser verification.

GitHub page-based pagination is not an atomic snapshot. Issue IDs are deduplicated across loaded pages, but concurrent GitHub changes can shift records between pages. No live synchronization is attempted in this phase.

### Manual acceptance

Use a configured running server with a valid GitHub App session; the App installation must have Issues read permission. Do not use `open_issues_count` as an issue-only total, since GitHub includes PRs there too.

1. Open a repository with more than 100 Open issue/PR records. In DevTools Network, confirm page 1 renders before later sequential pages finish. Counts must remain partial until the last page, including when an intermediate page contains only PRs. Compare the completed issue numbers against GitHub with PRs excluded.
2. Check Open issues with `status:in-review`, `status:in-progress`, `status:todo`, `status:backlog`, no status label and ordinary/unmapped labels. A single stale Canceled/Duplicate label on Open falls back to Backlog; multiple mapped labels show Mapping conflicts. Verify Closed `completed` maps to Done, `not_planned` to Canceled and `duplicate` to Duplicate regardless of residual status labels. Mapped labels never repeat as ordinary badges.
3. With a new workspace preference record, confirm no `state=closed` request occurs initially. Expand Canceled: only `category=canceled&page=1&per_page=10` should load. Expand Done and Duplicate: each requests its own reason's first page. Click Canceled's **Load more…** row: only Canceled page 2 should load, and Done/Duplicate rows and counts must stay unchanged. Repeat for Done and Duplicate. Simulate Search timeouts, a mismatched reason and more than 1,000 results: earlier pages must remain, unsafe pages must not be accepted and limited results must never be marked complete. Switch to another browser tab or app and return: no workspace discovery request, loading screen or issue refetch should occur. Collapse/reopen and switch away/back: cached pages should remain without refetching all issues. Counts must say loaded while another page exists or Search's ceiling applies.
4. Start loading A and switch to B before a response finishes. Only B's issues may render. Change sorting/group expansion in each workspace, switch back and confirm independent preferences. Logout and verify private query data is cleared; another GitHub user's cache keys must differ.
5. Force a later Open/Done page to fail or go offline after page 1. Earlier rows must remain, the list must say incomplete, and retry must target the failed page. Exercise a 429 response with `Retry-After`, ensuring no automatic request loop and no early retry request for that query. Reconnect may resume an already paused request; it must not refetch completed lists.
6. Request the API without a session (401), with an inaccessible/nonexistent repository (404), and with an App installation lacking Issues permission (403). Removing repository access must prevent every later page from returning issues. Check actual GitHub 403/404, 5xx/network failure and session expiry/logout during a request where reproducible; raw GitHub error bodies must never appear in the API/UI.
7. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`. No automated test framework or tests were added. Real pagination, session, permission and rate-limit acceptance still requires the configured App and suitable repository data.
