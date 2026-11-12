# GIS Converter P32 — independent browser-engine compatibility

## Goal and scope

The GIS Converter free browser tools rely on **Web Workers, GDAL/WebAssembly, Blob URLs, local-file download and GIS parser behavior**, all of which may differ between browser engines. P31 passed responsive checks in Chromium emulation, but did not demonstrate conversions in Firefox or Safari's WebKit engine.

P32 tests **actual Chromium, Firefox and WebKit browser engines** and a *simulated iPhone 13 viewport running Playwright WebKit*. These are software emulations on Linux CI, not physical iPhone hardware, native iOS Safari or macOS Safari compatibility certification.

The same P32 script `site/scripts/live-crossbrowser-qa.mjs` works against:
- **Local Cloudflare Pages emulation**: `npm run smoke:crossbrowser-local` launches Wrangler Pages, ensures the uncompressed 28 MB GDAL WASM is absent from `dist`, fetches/decompresses the *actual* Cloudflare Pages Function's gzip WASM and then launches browser tests.
- **Public Cloudflare Pages**: `GIS_BASE_URL=https://gis-converter.pages.dev npm run smoke:crossbrowser-live` uses the same browser and fixtures. For a verified claim, the public test must be preceded by `/release.json` exact main SHA checking and succeed.

## Browser matrix (the test must pass each independently)

| Engine | Context | Real user-facing acceptance |
| --- | --- | --- |
| Chromium | Desktop, 1280 × 800 | Full run |
| Firefox | Desktop, 1280 × 800 | Full run |
| WebKit | Desktop, 1280 × 800 | Full run |
| WebKit | Simulated iPhone 13 | Full run + mobile overflow |

Every context tests:
1. Homepage 19 links, search filter and clear, responsive overflow, and preview noindex.
2. KML → GeoJSON **real GDAL worker conversion**, browser download and independent coordinate/feature JSON inspection; download quality report JSON and verify its structure.
3. Changing the input removes the previous output/quality downloads and revokes both Blob URLs.
4. Malformed KML produces a visible error and no file output; a second valid KML input recovers **without a page reload**, with new coordinates.
5. Real-worker lifecycle: 3 conversions (success, failure, recovered success) must start and terminate **3 isolated Workers**, no uncaught page errors.
6. CSV → KMZ real browser download, ZIP integrity with `doc.kml`, and extracted geographic coordinate inspection.
7. Browser HTTP asset loading failures are recorded; no fictional conversion or external payment service is involved.

No user files, identifiers, location, payment credentials, or private GPS tracks are uploaded. These tests use synthetic KML/CSV points and write only output hashes, lengths and status to evidence.

## Status boundaries

- A green local Wrangler cross-browser run proves the code and *local Pages Function model* work under that CI browser environment. It is not public deployment verification.
- A green public run proves the **deployed Pages URL** worked for those selected conversions in three Playwright browser engines. It does not prove universal browser or all GIS data support.
- Google Earth Pro `gx:Track` desktop playback, physical iPhone/Android downloads and memory behavior, assistive screen readers (NVDA/VoiceOver/TalkBack), Safari desktop on real macOS, older browsers and restricted-data enterprise networks remain separate follow-up acceptance tests.
- P30 custom-domain SEO launch is still **off/noindex** by default. No domain was purchased, no Google sitemap was submitted, and Pancake/Waffo checkout remains disabled.

## Evidence

- Required branch/main hosted GitHub CI: `astro-and-gdal` now installs Playwright Chromium, Firefox and WebKit, then runs the P32 local Wrangler smoke *after* the Pages bundle is built and the raw oversized WASM removed. Evidence: `p32-wrangler-preflight.json` and `p32-crossbrowser-local-results.json`.
- One-shot read-only main-merge public test: `p32-one-shot-public-crossbrowser.yml` after deployment SHA equality, writing `p32-crossbrowser-live-results.json`, `p32-live-deployment-wait.json` and `live-release-gate.json`.
- Still do not label the public build "cross-browser verified" until the entire public job is successful and each engine result is `PASSED`.
