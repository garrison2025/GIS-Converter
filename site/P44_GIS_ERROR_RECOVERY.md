# P44 — Actionable, privacy-safe GIS conversion failure recovery

## Problem

P43 independently validated actual QGIS Qt map rendering and 19 public
conversion routes, but a rejected or failed file could still produce a raw
GDAL/WASM exception in the converter UI. These exceptions may include local
paths, source coordinates, filenames or GIS attributes. The browser had no
format-specific recovery steps, so users might guess a CRS, bypass data-loss
guards, or repeatedly retry an invalid file without guidance.

## Changes

- Introduce `site/src/lib/gis-error-guidance.mjs` with **21 curated
  non-exhaustive failure categories**: critical geometry/attribute loss,
  missing/unknown CRS, mixed/null/unsupported/invalid geometry, CSV WGS84
  bounds/columns/UTF-8, legacy Shapefile DBF encoding, broken/missing/unsafe
  ZIP components, XML directives, invalid GeoJSON, wrong format, file limits,
  timeouts, memory pressure, GDAL open errors and unknown failures.
- All remediation text is **constant, curated wording**, chosen using a
  bounded classification of the worker error. Raw GDAL exceptions, feature
  values, user filenames, local paths and coordinates are not reflected into
  the page. No user input is interpolated into actionable instructions.
- A visible, accessible `#recovery-panel` displays a descriptive heading,
  **three concrete manual recovery steps** and a stable guidance code/route.
  The route is one of the website's known converter names, not a user path.
- The recovery panel is hidden when the selected file changes or a safe retry
  succeeds. Existing downloaded Blob links are revoked on file replacement;
  a rejected conversion never exposes a partial output. Cancel/timeout
  handling and isolated-worker termination remain unchanged.
- Each case recommends a **verified** path (for example, exporting a
  missing Shapefile `.prj` with the *actual* CRS, separating mixed geometry
  families into layers, exporting DBF as UTF-8 and validating CSV geographic
  coordinates). The site never guesses EPSG:4326, drops unknown geometries,
  silently coerces untrusted data, or allows bypass of a confirmed
  `DATA_LOSS` guard.
- A secondary quality-inspector error is now summarized without copying
  its raw exception into downloadable JSON. Critical data-loss failures
  still withhold the resulting converted file, not merely show advice.

## Explicit limitation

This is an improved **human workflow / error interpretation** feature,
not an automatic GIS geometry repair, CRS detection, all-encoding parser
or guarantee that QGIS exports preserve arbitrary metadata.
Recovering input files always requires the user to check the real CRS and
geometry in their GIS editor. There is no new remote upload, cloud
conversion, map tile service or new fixed operating cost.

## Verification

- `npm run smoke:recovery-unit` checks **26 synthetic failure messages**,
  21 controlled categories, no raw path/coordinates/attributes in guidance,
  and strict no-bypass instructions.
- `npm run smoke:recovery-browser` checks **eight actual Chromium cases**,
  including pre-WASM invalid KMZ, missing Shapefile `.prj`, real mixed
  GeoJSON rejection followed by a successful GDAL/WASM Shapefile retry and
  downloadable quality report, CSV out-of-range/missing-columns rejection,
  malformed GeoJSON, and two deliberately injected Worker-only failures to
  test private data redaction and resource guidance. The injected cases do
  not claim actual GDAL conversion.
- The original 45 preflight security browser tests, P29 mixed-geometry
  rejection, P43 QGIS desktop tests, 19 conversion routes, 19 existing
  preview/quality-browser cases and SEO/billing offline checks continue
  as regression gates.
- A P44 one-shot public workflow waits until `release.json` reports the
  **exact merged main SHA**, then tests live failure guidance, 19 real GIS
  download routes and 19 preview/quality cases. It does not activate SEO.

## Release state

Engineering preview `noindex` and `robots.txt Disallow: /` remain in force.
Pancake/Waffo billing is not enabled. The physically operated handset and
human-driven QGIS GUI checklist from P43 remains outside automated CI.
