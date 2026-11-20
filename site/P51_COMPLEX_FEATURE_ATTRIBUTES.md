# P51 — Complex line / polygon feature-to-attribute fidelity

## Baseline

P50 merged at `691515d28d2c42980ba6ddb40705c2bba6743c34`, with independent point attribute checking and passed exact-SHA public acceptance. P51 retains all 19 routes, isolated local Worker/GDAL, input budgets, 15 MiB limit, preview noindex, critical DATA_LOSS and no server-side upload/payment changes.

## Audited gap

P40 independently detects changed complex geometry, but says nothing about the mapping from that geometry to its original attribute row. P50 joins only distinct WGS84 Point records. An output with identical lines/polygons and swapped Name/Code attributes can evade a geometry-only test.

## Implementation

- Reuse P40's **actual geometry parser and exact shape matching** for WGS84 LineString, MultiLineString, Polygon with holes, MultiPolygon and 2D SHP PolyLine/Polygon. Expose only a bounded unique pair of source/output internal feature indices; never use bounding boxes or feature order alone to infer attributes.
- A hard 300-complex-feature bound preserves the existing P40 4,000-feature geometry stress capability without adding unbounded quadratic attribute matching. Duplicate identical shapes, unsupported geometry/CRS and changed or ambiguous features remain `unavailable`.
- Independently read UTF-8 GeoJSON properties, KML Placemark name / ExtendedData / SimpleData, KMZ doc.kml and UTF-8 Shapefile DBF C/N/F/D/L values with known sidecars. For each uniquely matched full geometry, compare its original named values against the target record using P50 conservative scalar rules.
- Confirmed swapped, missing or altered comparable values are `complex-feature-attributes: review` and are blocked by the existing `DATA_LOSS` gate before download.
- DBF name truncation, case-only collisions, null/blank fields, numeric-to-text typing, unsafe precision and unsupported values stay `unavailable`, not false pass or arbitrary errors. A comparable missing short original field remains a confirmed mismatch.
- Reports include only counts and safe status; never user field names, attribute contents or coordinates.
- P51 runs only on 2D, distinct, WGS84 complex features of supported GeoJSON/KML/KMZ/SHP routes. Point, GPX/CSV and large polygon stress retain their previous behaviour.

## Regression evidence

- `npm run smoke:complex-attributes`: synthetic reordered LineStrings, swapped fields without geometry changes, polygon holes, MultiLineString, MultiPolygon, duplicated geometry ambiguity, changed geometry ambiguity, and independently constructed binary SHP/SHX/DBF/CPG/PRJ with row order independent from source GeoJSON.
- `npm run smoke:complex-attr-browser`: nine actual Chromium GDAL/WASM line/polygon conversion cases, including SHP-to-GeoJSON/KML and KMZ, requiring one or more exact complex field joins rather than merely tolerating blocked output. Confirmed loss must be withheld.
- Hosted regression also reruns existing P29–P50 browser, native OGR and 19-route checks. Exact-main-SHA Cloudflare public workflow repeats P51, all 19 public routes, preview and noindex acceptance.

## Independent unsatisfied testing

Manual QGIS desktop GUI checking and real physical low-memory mobile testing remain separate. This is not a general multi-CRS semantic guarantee, topology certification, style/altitude preservation guarantee, or full null/date/time field type certification.