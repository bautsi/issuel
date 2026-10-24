# Issuel

A minimal GitHub Issues client foundation: React + TypeScript SPA built with Vite, Hono on Node.js, Tailwind CSS, and local shadcn/ui components. One repository and one pnpm package.

## Requirements and installation

- Node.js 24 or newer
- pnpm 12.11.2 (declared in `packageManager`)

Run all commands from the project root:

```sh
pnpm install
```

No environment files or credentials are required.

## Development

```sh
pnpm dev
```

- Frontend: http://localhost:5173 (Vite, with hot reload).
- API: http://localhost:3000 (Hono, with automatic restarts).
- Vite forwards `/api` requests to `http://127.0.0.1:3000`. The frontend uses relative URLs, so no CORS setup is needed.
- Click **Check connection** to call `GET /api/health` and display the result.
- Stop both processes with Ctrl+C. `pnpm dev:web` and `pnpm dev:api` also run them individually.

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
src/App.tsx                 Landing page and API connectivity check
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

GitHub authentication, sessions, databases, issue operations, testing frameworks, Docker, and CI/CD are outside this foundation.
