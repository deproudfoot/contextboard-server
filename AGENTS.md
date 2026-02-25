# Agents

## Cursor Cloud specific instructions

### Architecture

Contextboard is a two-service monorepo:
- **`api/`** — Node.js Express REST API + WebSocket server (port 3000)
- **`web/`** — Vite React SPA (port 5173)

PostgreSQL is required (Prisma ORM). S3/R2 object storage is optional (only for file uploads).

### Prerequisites

- PostgreSQL must be running locally. Start it with `sudo pg_ctlcluster 16 main start`.
- The database `contextboard` must exist with a user that has access. Create with: `sudo -u postgres createdb contextboard`.
- `api/.env` must have `DATABASE_URL`, `JWT_SECRET`, and optionally `INVITE_ALLOWLIST`. See the README "Local dev" section.
- `web/.env` needs `VITE_API_BASE=http://localhost:3000`.

### Running services

- **API**: `cd api && npm run dev` (uses nodemon for hot reload)
- **Web**: `cd web && npm run dev` (Vite dev server)
- Run `npx prisma migrate dev` in `api/` after schema changes.

### Lint / Build / Test

- **Lint (web)**: `cd web && npm run lint` — note: the repo has 4 pre-existing ESLint errors (unused vars) that are not regressions.
- **Build (web)**: `cd web && npm run build`
- **No automated test suite** exists in this repo. Testing is done via API curl commands and manual browser interaction.

### Gotchas

- Registration requires the email to be in `INVITE_ALLOWLIST` env var (comma-separated). Default dev config includes `test@example.com`.
- The API throws on startup if `JWT_SECRET` is missing.
- `.env.example` files referenced in README do not exist in the repo; create `.env` files manually.
