# Deploy JalRakshak AI on Render

This project is configured as a Render **Web Service** (not a Static Site), because the Vite preview server also mounts the `/api/*` sensor and data endpoints.

## Deploy with Render Blueprint

1. Push the complete contents of this project folder to a GitHub repository. Keep `render.yaml` at the repository root.
2. Sign in to Render: https://dashboard.render.com/
3. Choose **New** → **Blueprint**.
4. Connect GitHub and select the repository containing this project.
5. Render reads `render.yaml`. Confirm the service `jalrakshak-ai` and create the service.
6. Wait for the build and deploy to finish. Render will show a public `https://...onrender.com` address.
7. Open the public address and verify the dashboard and map. Then open `https://YOUR-SERVICE.onrender.com/api/health`; it should return JSON with `ok: true`.

## Build settings (already in render.yaml)

- Runtime: Node
- Plan: Free
- Build command: `npm install --no-audit --no-fund && npm run build`
- Start command: `npm run preview -- --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`
- Auto deploy: enabled

## Important limitations and safety

- A free Render web service sleeps after a period without traffic and may take time to wake up.
- Free service filesystems are ephemeral. JSON records written locally can be lost after restarts, redeploys, or sleep. Do not treat this as durable production storage.
- The current `/api/*` endpoints do not implement user authentication or per-user authorization. Anyone who can reach the service may be able to interact with exposed API routes. Deploy with demo/test data only until authentication and durable database storage are implemented.
- Do not upload personal, private, or sensitive laboratory records to this public demo.
- Maps and location analysis depend on public third-party map/geocoding/Overpass services. They may be rate-limited or unavailable; missing mapped data is not proof that a waterbody or structure does not exist.

## Before public production use

Add authentication, authorization, rate limiting, input auditing, and a durable database (for example, managed PostgreSQL). Review data retention and privacy requirements. The current free deployment is suitable for a public prototype/demo, not sensitive or regulated records.
