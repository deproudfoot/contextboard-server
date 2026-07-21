## Contextboard

This repo contains a Node API in `api/` and a Vite React app in `web/`.

### Quick start (Docker)

The fastest way to get everything running:

```bash
docker compose up
```

This starts PostgreSQL, runs migrations, and launches both services:
- API: http://localhost:3000
- Web: http://localhost:5173

### Local dev (without Docker)

1. Copy env templates:
   - `cp api/.env.example api/.env`
   - `cp web/.env.example web/.env`
2. Edit `api/.env` with your PostgreSQL connection string and a JWT secret.
3. Start the API:
   - `cd api && npm install`
   - `npx prisma migrate dev`
   - `npm run dev`
4. Start the web app:
   - `cd web && npm install`
   - `npm run dev`

### Testing

```bash
# API integration tests (requires PostgreSQL)
cd api && npm test

# Web component tests
cd web && npm test
```

### Linting

```bash
cd web && npm run lint
```

### CI

GitHub Actions runs lint, tests, and build on every push/PR to `main`. See `.github/workflows/ci.yml`.

### Render deploy

1. Create a new Render Blueprint and point it at this repo.
2. Render will read `render.yaml` and create:
   - `contextboard-api` (Node API)
   - `contextboard-web` (static site)
   - `contextboard-db` (Postgres)
3. In the Render dashboard, add any optional object storage env vars
   to `contextboard-api` if you want uploads (S3/R2).
