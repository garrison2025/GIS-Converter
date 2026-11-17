# P49 — DBF date, logical, blank/null and field-name semantics

## Baseline
P48 main commit 10f4590e passed the full hosted and exact-SHA public acceptance. P49 keeps all 19 routes, browser-local GDAL/WASM, DATA_LOSS protection, input and output budgets, engineering-preview noindex, and unactivated payments/production SEO.

## Fixes
1. Valid DBF D fields (YYYYMMDD) and L fields (T/F/Y/N) used to be classified unsupported. P49 checks Gregorian dates and Boolean values against emitted GeoJSON. Invalid and blank source cells remain unavailable, never guessed.
2. A GeoJSON Boolean written as DBF N/F/C is a confirmed field-type change, not a safe Boolean. The output is withheld through the existing DATA_LOSS gate. True native L values are independently comparable. Valid ISO date-only strings in D cells may be compared as dates, and C strings remain compared literally.
3. A blank DBF C cell may represent empty text or NULL. GeoJSON empty strings are never certified as preserved solely because a blank DBF decodes to an empty string; explicit nulls and blank source cells remain unavailable.
4. DBF field descriptors differing only by case are ambiguous for downstream GIS; both converters avoid false pass for these columns. If GDAL actually renames or drops an otherwise comparable short source field, the known missing field remains a confirmed mismatch, triggering DATA_LOSS.
5. Risk JSON adds counts for Boolean, blank-string and case-insensitive collision issues only. No raw user attribute field names, values or source coordinates are emitted.

## Evidence
- npm run smoke:dbf-semantics synthesizes DBF/CPG ZIP bytes, checks date leap years, logical flags, blank vs null, casefold ambiguity, field renames and the DATA_LOSS gate.
- npm run smoke:semantics-browser runs four real Chromium + GDAL/WASM scenarios: dates, booleans, name collisions and nullable/blank strings; only verified output or safe withholding is accepted.
- Existing P48 tests and the full CI matrix remain mandatory.
- P49 exact-main-SHA public workflow waits for Cloudflare deployment and reruns P49 and 19 real routes and previews.

## Limits
Format conversion does not certify all schema semantics, null provenance, time zones, unsupported property types, arbitrary decimals, or field order. Physical low-memory mobile testing and QGIS desktop GUI acceptance remain separate.