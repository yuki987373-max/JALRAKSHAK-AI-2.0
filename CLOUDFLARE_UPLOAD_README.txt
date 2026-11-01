JALRAKSHAK AI v3.0 — CLOUDFLARE PAGES DEPLOYMENT

This ZIP contains the website source code, not a prebuilt dist/ folder.
Cloudflare Pages will install dependencies and build the website in its build environment.

1. Extract this ZIP.
2. Upload the extracted project contents to a GitHub repository named jalrakshak-ai.
   The repository root must contain package.json, index.html, src/ and public/.
3. In Cloudflare Dashboard, open Workers & Pages > Create application > Pages > Connect to Git.
4. Select the repository and use:
   Framework preset: Vite
   Production branch: main (or your repository's default branch)
   Build command: npm run build
   Build output directory: dist
   Root directory: /
5. Click Save and Deploy. Cloudflare will assign a pages.dev address.

The public/_redirects file enables SPA fallback routing. public/_headers adds basic browser security headers.

Important limitations:
- This package has not been published. No Cloudflare account or domain is connected here.
- A production build could not be run in this environment because npm dependency installation timed out.
  Cloudflare's build environment will need to install the dependencies before deployment.
- The static site does not provide persistent multi-user sensor storage. The optional Vite sensor gateway
  is not a production API on static Pages hosting.
- Public map/address/Overpass services are third-party best-effort services and may be rate-limited.
- Do not upload private lab records to a public demo without access controls.
