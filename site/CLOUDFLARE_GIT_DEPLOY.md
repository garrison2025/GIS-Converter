# GIS Converter — Cloudflare Pages Git deployment from main

This repository's **main branch contains all currently implemented code**:
`site/` (Astro pages and real GDAL/WASM client workers), `billing/` (non-live D1 ledger sandbox), and CI workflows.
This is an **engineering preview**; subscription, authentication, Pancake/Waffo payments and AdSense are not live. All routes intentionally use `noindex`.

## Cloudflare setup

Select **Workers & Pages → Create application → Pages → Connect to Git → garrison2025/GIS-Converter**.

| Field | Value |
| --- | --- |
| Project name | `gis-converter` (or any available project name) |
| Production branch | `main` |
| Framework preset | `None` (build command below is authoritative) |
| Root directory (advanced) | `site` |
| Build command | `npm run stage:gdal && npm run pack:gdal && npm run build && npm run prepare:pages` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=22.23.4` |

Cloudflare automatically installs package dependencies before build; `site/package-lock.json` pins their versions. The build stages real `gdal3.js` binaries, builds Astro, gzips oversized WASM, and deletes the raw 26.91 MiB WASM from the final `dist` tree. The Pages Function under `site/functions/engine/gdal3/[asset].js` provides the gzip asset to the browser, subject to validation on the real Pages deployment. No payment keys are required to build the free conversion test site.

## Safety and next checks

- A Git-integrated Pages project serves `main` at its default `*.pages.dev` hostname, which is **public** despite `noindex`. Do not bind a custom domain or enable indexing/AdSense yet.
- Disable automatic preview branch builds if unnecessary in **Settings → Builds → Branch control**, because we maintain a separate development branch.
- After deployment, inspect `/robots.txt`, `X-Robots-Tag`, `/engine/gdal3/gdal3WebAssembly.wasm` (gzip header/actual decode), SHP ZIP outputs, KMZ imports, and browser/phone errors.
- The WASM size and gzip strategy have been proven under Wrangler but **not yet verified on a real Cloudflare Pages deployment**.
- The original `site/PREVIEW_DEPLOY.md` documents a distinct *manual Wrangler preview* path. It is not required for this Git-integrated `main` workflow.
- Real D1, user login, signed Pancake/Waffo webhooks, payment tests, SEO launch and broader mobile GIS quality testing remain blocked until independently validated.

## Source and tests

- `site/src/lib/gdal-matrix.mjs`: 19 real GDAL route definitions.
- `site/src/lib/input-preflight.mjs`: input preflight guard.
- `site/src/lib/isolated-task.mjs`: cancellable/terminable conversion jobs.
- `site/src/workers/`: isolated browser conversion worker.
- `site/scripts/`: Chromium/Wrangler validation and packaging scripts.
- `billing/`: local D1 ledger simulation, **not** live billing.

See GitHub Actions for the most recent CI status; a passing CI is not a Cloudflare live-deployment acceptance.
