# GIS Converter — development repository

Browser-first GIS file conversion tools + a future paid batch workflow.

**Status: pre-release.** This repository is intentionally not connected to a production Cloudflare deployment. The previous P0–P10 laboratory source and test package exists separately and has not yet been imported in full.

## Engineering rules
- Do not enable public indexing or deploy until actual GDAL/WASM browser conversions pass independent geometry, coordinates and attribute checks.
- Validate Astro build on hosted CI, not just script syntax.
- Cloudflare D1 billing is a simulation until live D1 migrations and permissions are verified.
- Pancake/Waffo checkout and webhook signature verification must be integrated and tested before granting paid entitlements.
- Never put payment secrets in the repository or front-end code.

Initial check: the repo existed empty on 2026-11-11. Further source migration is to be staged on a feature branch, reviewed and tested before any production release.
