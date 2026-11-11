# GIS Converter

Browser-first GIS conversion tools built with **Astro + gdal3.js (real GDAL/WebAssembly)**.

## Current implementation
- **19 GIS conversion routes** covering KML, KMZ, SHP ZIP, GPX, GeoJSON and CSV.
- Dedicated cancellable Web Worker per conversion; browser-only file processing.
- Input safety preflight, explicit size limits, topology/CRS test suites, real browser downloads, and 12,000-point synthetic stress test.
- Cloudflare Pages function serves the oversized WASM as a compressed asset.
- `billing/` includes a **non-production** D1-style order/credits ledger with local tests only. **No real payment processing, user authentication, signed Pancake webhooks, or subscriptions.**

## Deploy from main with Cloudflare Pages

**Read [Cloudflare Pages Git deployment settings](site/CLOUDFLARE_GIT_DEPLOY.md).**

**Build settings:** root directory `site`, branch `main`, build command
`npm run stage:gdal && npm run pack:gdal && npm run build && npm run prepare:pages`,
output directory `dist`, environment `NODE_VERSION=22.23.4`.

## Engineering and release state

**Pre-release / noindex.** The `main` branch is a deployable **test version**, not production-certified GIS software. The public Pages test URL must stay noindex with no ads or live payment. Real Cloudflare deployment, full-feature GIS reliability, storage/memory profiling, login, real D1 and Pancake payments require separate verification.

The `dev/p10-integration-ci` branch remains available for subsequent changes; all new code should be tested there and promoted to `main` after CI passes.
