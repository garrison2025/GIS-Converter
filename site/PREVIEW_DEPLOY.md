# GIS Converter — Cloudflare Pages PREVIEW ONLY

Status: development staging. No production merge, checkout, AdSense, subscription, or paid service is authorized.

1. In your own Cloudflare dashboard create a **separate Cloudflare Pages project** for GIS Converter (e.g. `gis-converter-preview`). **Do not bind any production domain or connect the main branch for automatic production deploys.**
2. In GitHub repository Settings → Secrets and variables → Actions create `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped to Pages deployment for the intended account). **Never share these secrets in chat or source code.**
3. Optionally configure approvals on the GitHub environment `gis-converter-preview`.
4. **Important GitHub UI limitation:** `workflow_dispatch` cannot appear in GitHub Actions until the workflow exists on the default branch. We deliberately do not merge application code into `main` yet. To manually request a preview **from the development branch only**, edit `site/.preview-request` so its entire contents are the existing project name (`gis-converter-preview`), and commit that one file to `dev/p10-integration-ci` using the exact commit message `manual: gis preview`. This deliberate commit triggers the preview workflow. It will fail closed unless Cloudflare secrets are present, the project name starts `gis-converter-`, and the requested branch is not Cloudflare's production branch.
5. Alternatively, once a minimal authorized dispatch workflow exists on `main`: GitHub Actions → `GIS Converter — manually approved Cloudflare Pages preview` → Run workflow, select `dev/p10-integration-ci`, supply the **existing** project name and confirmation `PREVIEW_ONLY`.
6. The workflow re-runs GIS/Worker security tests, strips the raw 28MB WASM, then deploys a **preview branch**. The project will still have a public preview URL; all pages include noindex and robots disallow.
7. Independently verify on the actual Pages preview: response headers, `/engine/gdal3/gdal3WebAssembly.wasm` Content-Encoding:gzip, wasm instantiation, file conversion/download, mobile browsers, CPU/memory, and caching. Local Wrangler success is NOT a remote Cloudflare acceptance.
8. Do NOT merge the draft PR or enable indexing, advertising, Pancake billing or production domains until all remaining gates are passed.

All non-payment conversion is browser-local; the Pages Function serves only compressed WebAssembly. The paid backend is simulated and disabled.
