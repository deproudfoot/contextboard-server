## Contextboard

This repo contains a Node API in `api/` and a Vite React app in `web/`.

### Render deploy

1. Create a new Render Blueprint and point it at this repo.
2. Render will read `render.yaml` and create:
   - `contextboard-api` (Node API)
   - `contextboard-web` (static site)
   - `contextboard-db` (Postgres)
3. In the Render dashboard, add any optional object storage env vars
   to `contextboard-api` if you want uploads (S3/R2).

### Local dev

1. Copy env templates:
   - `cp api/.env.example api/.env`
   - `cp web/.env.example web/.env`
2. Start the API:
   - `cd api && npm install`
   - `npx prisma migrate dev`
   - `npm run dev`
3. Start the web app:
   - `cd web && npm install`
   - `npm run dev`
