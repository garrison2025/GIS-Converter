# GIS Converter P31 — mobile and keyboard UX, safe result lifecycle

## Why this was necessary

The existing 19-route preview had real browser conversion tests, but after a user successfully converted File A, selecting File B could leave File A's download button and quality report visible. This was especially misleading when File B was too large (>15 MiB), because the old artifact could still be downloaded after a failed attempt. The issue was a client-side state lifecycle bug, not an error in the GDAL output or a Cloudflare server-side upload.

P31 fixes that behavior **on all 19 converter pages** without adding an account, database, server upload or fee.

## Client behavior now

- Any file selection change immediately hides the previous result and quality report, revokes **both** prior Blob object URLs, clears expired error messages and resets the ready status.
- The submit handler also clears prior artifacts **before** unsupported-route / oversized-file rejection, defending against stale downloads even if selection events are bypassed.
- Files over 15 MiB show a clear limit error at selection and on submission. They do **not** start another Web Worker.
- After conversion, keyboard focus moves to the exposed result section so a keyboard or screen-reader user can inspect warnings and activate the output and JSON quality-report downloads deliberately.
- The file picker has an accessible relationship to the format requirements; a visible-on-focus skip link leads past repetitive navigation; the output can be focused without causing an automatic download.
- Small-width content uses overflow-safe text wrapping; the 20-page site's footer/header copy no longer misrepresents itself as an engineering preview if a *future, separately approved* production SEO build is activated.
- The existing free browser-only format conversions, cancellation behavior, GDPR-relevant local processing statement, P30 noindex protection and optional future Pancake/Waffo payment decision are unchanged.

## Actual automated evidence

The **same Playwright/real Chromium + GDAL/WASM tests** can run locally or against the actual public Pages URL.

| Case | Assertions |
| --- | --- |
| Responsive layout | 320, 360, 390 and 768 CSS pixel viewport widths across homepage, KML → GeoJSON and GPX → KMZ. No horizontal scrolling; preview remains noindex; keyboard skip links render |
| Keyboard end-to-end | First Tab lands on skip link; Enter moves to conversion content; keyboard submits real KML; output focuses; actual GeoJSON and quality JSON browser downloads are independently parsed |
| Old-Blob invalidation | Real first KML conversion creates two Blob URLs. Selecting an oversized File B immediately hides all prior downloads, removes old hrefs and revokes both URLs. Too-large submission starts no worker; selecting a third valid KML and retrying downloads new coordinates, not old data |
| Invalid file / recovery | Malformed KML triggers an error, shows no download and leaves the form usable. Selecting valid KML clears the error; retry produces a valid downloaded GeoJSON without reloading |

Records are saved as `p31-mobile-local-results.json` in the required hosted CI artifacts and `p31-mobile-live-results.json` in the one-shot public Pages acceptance. Hashes are of synthesized sample outputs. No user file names, GPS coordinate histories, or upload data are sent to an analytics service.

**Evidence boundary:** 320/360/390/768 pixel measurements emulate mobile viewports in headless **Chromium**. They do **not** certify physical iPhone/Android hardware, Safari WebKit/iOS file picker behavior, memory usage, screen readers VoiceOver/NVDA/TalkBack or actual Google Earth Pro playback.

## Release / deploy verification

1. Require full green CI of both `astro-and-gdal`, `billing-ledger-offline`, and P30 isolated SEO rehearsal jobs.
2. Merge P31 to `main` only after success.
3. The one-shot `site/.p31-live-acceptance` trigger starts `p31-one-shot-live-mobile.yml`. It compares actual `https://gis-converter.pages.dev/release.json` with the **exact new merged main SHA** before running the real public mobile UX test and all 19 basic upload/download routes.
4. Read the separately reported public P31 mobile results and 19-route matrix before claiming live acceptance. If Cloudflare has not deployed, report "pending", not success.
5. Keep the current SEO mode `engineering-preview/noindex`. No domain purchase, DNS change, Google Search Console indexing, ads or checkout activation occurs in P31.

Future real-device acceptance should sample mobile Safari and Chrome on physical phones and VoiceOver/TalkBack as distinct human tests; these cannot be inferred from Playwright browser emulation.
