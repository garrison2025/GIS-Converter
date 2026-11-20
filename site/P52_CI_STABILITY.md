# P52 — Stable, release-safe GIS Converter CI

## Confirmed P51 baseline

- Main commit `8bd6f5b83ecc29dc6b252133982513f72eb4707a` has **successful** public P51 acceptance run [44645624965](https://github.com/garrison2025/GIS-Converter/actions/runs/44645624965), and successful complete hosted run [44645625041](https://github.com/garrison2025/GIS-Converter/actions/runs/44645625041).
- Those checks verified the exact Cloudflare release SHA, 9 complex feature attribute browser scenarios, 19 full public GIS routes, output previews, noindex, native OGR and cross-browser compatibility.
- Real job step timing: hosted Chromium/Firefox/WebKit installation **00:25:01–00:42:21 UTC (17m20s)**; P51 public browser installation **00:25:41–00:44:59 UTC (19m18s)**. Installing the browsers took vastly longer than executing the actual public GIS tests. No browser results were falsely called failures during the wait.
- Repeated dev commits triggered many separate full validation runs. Several older runs stayed active even when later commits already passed. Previous runs that started before the new concurrency configuration cannot be retroactively canceled by this YAML edit.

## P52 workflow changes

1. The complete hosted matrix now sets workflow-level concurrency. The group is per **development Git reference**, so subsequent dev *pushes* cancel obsolete in-progress dev checks, preserving runner capacity and reducing download contention. On `main`, the group contains the exact **commit SHA**, preventing both in-progress cancellation and replacement of pending main release checks. Manual non-push verification is not proactively canceled.
2. Cache Playwright 1.57.0 browser binary directory `~/.cache/ms-playwright` with `actions/cache@v4`, explicit Ubuntu 24.04, OS and architecture in the key. Both the complete hosted job and P50/P51 public workflows keep installing **Chromium, Firefox and WebKit**, and native desktop OGR remains independent.
3. Separate `npm ci` from public browser installation, and bound a stalled three-browser dependency install with a 1,500-second command timeout. Public workflows retain the wider 45-minute job budget for real GIS verification.
4. Add `npm run smoke:ci-policy` to verify the concurrency expression, versioned caches, no loss of the three browser engines, all 19 public conversion routes, multi-browser output previews, noindex release gates, and P51 geometry/attribute integrity checks.
5. Add a one-shot, exact-main-SHA P52 public acceptance workflow. Only a new marker on main triggers it automatically. It runs no deploy command and cannot enable paid plans, SEO indexing, remote file uploads, or change any of the 19 conversion routes.

## Important limitation

Caching binary browsers speeds **repeat runs when the cache is available**; it does not cache system APT dependencies, eliminate first-run downloads, or promise a fixed duration. Playwright is still installed with `--with-deps` to avoid missing native libraries. The CI suite remains deliberately substantive and may be slower during GitHub runner/network incidents.

## Verification gate

1. Latest development branch full CI: policy, 19 browser-GDAL routes, real polygon stress, Firefox/WebKit visual preview, native GDAL/OGR, isolated SEO build, billing tests.
2. Squash-merge only after all jobs succeed.
3. Exact deployed SHA P52 public workflow on Cloudflare, with real browser conversions, multi-engine previews and 19-route noindex checks.
4. The separate manual QGIS GUI and physical low-RAM phone checks remain pending.