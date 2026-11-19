# P50 — CSV / KML / KMZ / GeoJSON point attribute integrity

## Proven baseline

P49 `fd50c90cdbebac4bd82c6d38785fe1bc7c402f33` passed hosted and exact-main-SHA public acceptance. P50 preserves all 19 conversion routes, the browser-only GDAL worker, engineering 15 MiB upload cap, 19 route smoke, preview settings and noindex/robots.txt. No payment or backend uploads are added.

## Correctness gap

Previous quality checks independently compared Shapefile DBF fields but **not** named attributes between CSV, KML, KMZ and GeoJSON. A successful conversion with correct counts/coordinates could still have omitted or rewritten a textual identifier or an ExtendedData column. This is a defect in quality detection, not proof that every GDAL conversion loses fields.

## Implementation

- New `cross-format-attribute-fidelity.mjs` independently parses and compares original and downloaded UTF-8 bytes in at most 4,000 uniquely matchable WGS84 Point records, at most 64 fields, under 12 MiB. It handles properly escaped CSV quotes, comma/Unicode text, KML Placemark name, ExtendedData Data/value, SchemaData/SimpleData, GeoJSON scalars, and the KMZ KML component.
- Match source and target features by *unique* WGS84 point coordinates within a 0.000005° tolerance, not CSV row order. Duplicate/ambiguous or complex geometries are **unavailable**, not falsely certified.
- A missing comparable field, different nonempty string, or a detectable numeric value/lexical identifier change (including `00123` -> `123`) is a confirmed `review`, triggering existing critical `DATA_LOSS` withholding.
- Exact comparable plain UTF-8 string fields may `pass`. Null/blank values, unsafe integers, unknown XML/entity declarations, unsupported schema, or numeric/Boolean typing that a destination format cannot prove remain `unavailable`, not silently certified or arbitrary loss assertions.
- XML declarations with DTD/DOCTYPE, custom entities, or ambiguous markup are never interpreted as independently comparable. This is a conservative schema-inspection layer, not a general-purpose KML validator.
- Reports contain aggregate statuses/counts only; not private field names, text values, coordinates or file paths.
- Only the existing routes whose **both** ends are CSV, KML, KMZ or GeoJSON gain this independent attribute check. All 19 continue to receive their prior geometry and route quality checks.

## Automated acceptance

- `npm run smoke:cross-attributes`: hand-constructed CSV/KML/KMZ/GeoJSON fixtures, XML escapes, Unicode, CSV quoting, leading-zero ID, missing field, precise numeric drift, blank/null ambiguity, repeated coordinate ambiguity, and `DATA_LOSS` test.
- `npm run smoke:cross-browser`: real user-facing GDAL/WASM in Chromium on six scenarios (CSV->KML/KMZ, zero-padded CSV identifier, GeoJSON->KML high integer, KML->GeoJSON/CSV ExtendedData). Any confirmed loss must withhold output.
- Existing P29–P49 browser/native/stress/19-route checks remain required.
- On merge, the one-shot exact-main-SHA Cloudflare public workflow checks release SHA, P50 unit/real GDAL scenarios, 19 real public routes, output previews and noindex.

## Boundaries

No broad promise of losslessness: metadata, styles, CRS changes, polygon attributes, mixed geometry, dates/time zones, null vs empty semantics, display precision and arbitrary decimals still need independent GIS verification. Separate physical phone and manual QGIS GUI tests remain outstanding.