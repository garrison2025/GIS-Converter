# Cloudflare Pages Preview — alternate manual workflow

**Current primary deployment:** Full GIS Converter source is on the `main` branch. If you are using Cloudflare's **Connect to Git** setup screen, use the values in [CLOUDFLARE_GIT_DEPLOY.md](./CLOUDFLARE_GIT_DEPLOY.md), including production branch `main`. **Do not follow this manual Wrangler guide for the same project.**

## Optional isolated preview via GitHub Actions / Wrangler

The separate workflow `.github/workflows/preview-cloudflare-pages.yml` exists for an additional preview-only project and is not needed for the Git-integrated `main` site.

1. Create an **existing, separate** Cloudflare Pages project named `gis-converter-preview` (or another project prefixed `gis-converter-`) using an appropriate Cloudflare setup. Do not connect any production domain.
2. Under GitHub repository Settings → Secrets and variables → Actions, configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with the minimum Pages permissions. Never paste tokens in chat or source.
3. Optional approval protection is available in the GitHub environment `gis-converter-preview`.
4. To trigger from the development branch only, edit `site/.preview-request` with your existing project name; commit **only that file** to `dev/p10-integration-ci` with the exact commit message `manual: gis preview`. Normal changes on development branches do not cause this Wrangler workflow to deploy.
5. The workflow validates the input, re-runs tests, strips the oversized WASM, and deploys to the dedicated Pages preview branch. It refuses to deploy when the target branch is configured as Cloudflare production.
6. Inspect the **actual** Cloudflare preview headers, WASM content encoding, browser conversion/download, mobile behavior and caching. Passing local Wrangler tests does not certify a live Cloudflare deployment.

**All current deployments are still non-production GIS engineering previews:** noindex, no AdSense, no active D1 login, no Pancake/Waffo payments, and no subscription entitlements. Do not enable these without separate acceptance.
