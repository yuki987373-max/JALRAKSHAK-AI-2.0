# Publish JalRakshak AI v3.0 on Cloudflare Pages (Free)

This guide publishes the browser application as a static Vite site. The application can use the public OpenFreeMap map style and public OpenStreetMap/Overpass geographic lookup without API keys. Public geographic services are best-effort and are not guaranteed to be online.

## Before you begin

- A GitHub account (free)
- A Cloudflare account (free)
- The JalRakshak AI v3.0 project folder
- Node.js LTS installed on your computer

## Step 1 — Create a GitHub repository

1. Sign in at https://github.com/
2. Create a new repository named `jalrakshak-ai`.
3. Keep it private if the source code should not be public.
4. Upload the contents of the `JalRakshak-AI-v3.0` folder (not the ZIP itself).
5. Confirm that `package.json`, `index.html`, `src/`, and `public/` appear at the repository root.

## Step 2 — Connect Cloudflare Pages

1. Sign in at https://dash.cloudflare.com/
2. Open **Workers & Pages**.
3. Choose **Create application** → **Pages** → **Connect to Git**.
4. Select the `jalrakshak-ai` repository.
5. Enter these build settings:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Production branch | `main` (or your repository's default branch) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

6. Choose **Save and Deploy**.
7. Wait for the build to finish. Cloudflare will provide a `*.pages.dev` address.

## Step 3 — Test the public site

Open the new `pages.dev` address and check:
- Dashboard loads.
- Manual coordinates and browser GPS permission flow.
- MapLibre/OpenFreeMap map.
- Waterbody and surrounding feature lookup.
- 3D hologram and zoom controls.
- Manual measurements and imported sample data.
- Sensor and laboratory import panels.

A public map or Overpass service can be rate-limited or unavailable at any particular moment. This must be shown as unavailable/partial data, not as proof that a waterbody does not exist.

## Important: static hosting and sensor history

Cloudflare Pages static hosting serves the frontend assets. The existing optional sensor gateway is implemented by the bundled Vite development/preview plugin; it is not automatically a persistent production API on a static Pages deployment. Therefore, treat sensor history/API persistence as a local-demo capability unless you separately configure a production backend.

Supabase Free can be considered for optional hosted records, but it is not required for the map or analysis interface. The current published Supabase Free plan includes a 500 MB database, 5 GB egress and 1 GB file storage, and free projects pause after one week of inactivity. Review current pricing and quotas before connecting it: https://supabase.com/pricing

## Current Cloudflare Pages Free limits

Cloudflare's documentation currently lists (check again before deployment):
- 500 builds per month
- One concurrent build
- 20,000 files per site
- 25 MiB maximum per individual uploaded asset
- Static asset requests are free and unlimited

Pages Functions are billed against Workers quotas; this project does not require Pages Functions for its static frontend. Official limits: https://developers.cloudflare.com/pages/platform/limits/

## Free-service notes

- OpenFreeMap public tiles are currently offered without API keys or per-request/view charges, but the service is provided without an uptime SLA. Respect its terms: https://openfreemap.org/tos/
- Overpass public servers are shared community resources. Keep lookups user-initiated, cache results, avoid repeated refreshes and do not treat them as a guaranteed production SLA. See https://wiki.openstreetmap.org/wiki/Overpass_API
- Keep visible OpenStreetMap attribution in the app.
- Do not upload private or sensitive laboratory records to a public demo without suitable access controls and privacy protections.

## Updating the website

When you update the source code, commit/push the changes to the connected GitHub branch. Cloudflare Pages automatically builds and deploys the new version.
