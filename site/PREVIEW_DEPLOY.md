# GIS Converter — Cloudflare Pages PREVIEW ONLY

Status: development staging. No production merge, checkout, AdSense, subscription, or paid service is authorized.

1. In your own Cloudflare dashboard create a **separate Cloudflare Pages project** for GIS Converter (e.g. `gis-converter-preview`). **Do not bind any production domain or connect the main branch for automatic production deploys.**
2. In GitHub repository Settings → Secrets and variables → Actions create `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped to Pages deployment for the intended account). **Never share these secrets in chat or source code.**
3. Optionally configure approvals on the GitHub environment `gis-converter-preview`.
4. GitHub Actions → `GIS Converter — manually approved Cloudflare Pages preview` → Run workflow, select `dev/p10-integration-ci`, supply the **existing** project name and confirmation `PREVIEW_ONLY`.
5. The workflow re-runs GIS/Worker security tests, strips the raw 28MB WASM, then deploys a **preview branch**. The project will still have a public preview URL; all pages include noindex and robots disallow.
6. Independently verify on the actual Pages preview: response headers, `/engine/gdal3/gdal3WebAssembly.wasm` Content-Encoding:gzip, wasm instantiation, file conversion/download, mobile browsers, CPU/memory, and caching. Local Wrangler success is NOT a remote Cloudflare acceptance.
7. Do NOT merge the draft PR or enable indexing, advertising, Pancake billing or production domains until all remaining gates are passed.

All non-payment conversion is browser-local; the Pages Function serves only compressed WebAssembly. The paid backend is simulated and disabled.
