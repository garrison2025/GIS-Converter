# P41 — Large GIS geometry fidelity, real-world regression and bounded memory

## Concrete limitation fixed

Before P41, the P40 independent geometry verifier supported only 500
complex features, 20,000 XY vertices and 8 MiB input/output inspection,
even though the site already passed a real 3,000-polygon-with-holes
GDAL/WASM conversion stress suite. Larger complex conversions therefore
produced an unverified geometry status instead of an independently comparable
result. P41 closes this gap for supported confirmed-WGS84 2D files.

## Engineering changes

- Expand the **independent quality inspector** to 4,000 complex features,
  120,000 XY vertices and up to 18 MiB per file. This is independent of and
  does **not** change the site's 15 MiB user-upload limit, GDAL output limits,
  conversion routing or the premium SaaS product boundary.
- Compute each output geometry bbox **once** and index candidates by type
  and longitude/latitude grid cell. Each source geometry searches only a
  3×3 neighborhood and independently checks all four bbox bounds before
  comparing actual XY vertex/ring coordinates. This eliminates repeated
  full-geometry bbox traversals on disjoint large datasets.
- If a bbox moves and no unique candidate can be established, mark the
  quality comparison **unavailable**, not a fabricated mismatch or pass.
  Identical/overlapping geometry candidates also remain unavailable to
  prevent incorrect blocking.
- Limit redundant ring-anchor scans on adversarial geometries with many
  indistinguishable start points. An unresolved ring is unverified, not
  silently treated as data loss.
- Enforce a bounded total decompressed SHP/SHX/PRJ size and a bounded ZIP
  entry count before inspecting large Shapefile archives.
- Summarize complex feature families with counts, not a huge per-record
  list of repeated geometry names. Original coordinate values and private
  attributes remain excluded from downloadable quality details.
- Preserve P40 data-loss withholding only for definite, unambiguous
  vertex/part/polygon-hole changes. No change to file output bytes.

## Independent tests and evidence

- `npm run smoke:large-geometry`: 3,500 separate 2-ring polygons
  (35,000 XY vertices), full reordered target dataset, changed inner ring
  within unchanged outer bbox, duplicate ambiguity, 4,001-feature cap
  and a 60,000-vertex line; records runner-local timings and heap.
  The 15-second per-case cap is deliberately broad and intended only
  to detect pathological slowdowns, not to promise any hardware latency.
- The preexisting `npm run smoke:polygon-stress` uses actual browser
  GDAL/WASM to convert 3,000 GeoJSON polygons including 3,000 holes into
  Shapefile, and independently validates SHP/SHX/DBF geometry structure,
  UTF-8 Chinese labels, field-name truncation, numeric values and
  worker termination. P41 additionally requires that the **downloaded
  quality report** marks `complex-geometry-values: pass` and reports
  all 3,000 polygons. This is more than checking 4 sample coordinates.
- The same real 3,000-feature browser stress can now run against a live
  Cloudflare Pages deployment via `GIS_BASE_URL`, while retaining the
  existing local CI path and measuring Chromium-process-tree RSS.
- Existing 16 converted-output SVG/quality browser checks, 19 real
  converter routes, P33 desktop OGR, P34 mini-batch, P39 points and P40
  holes remain required in GitHub Actions.
- After merge, a one-shot P41 public workflow waits for the **exact main
  commit SHA** on live `release.json`, then tests 3,000 real public
  polygon conversions, 16 output previews and all 19 routes. Do not
  claim live acceptance until the public workflow succeeds.

## Limitations and operating costs

The checks do not certify arbitrary self-intersecting topology, CAD curves,
3D Z/M semantics, advanced Shapefile variants, missing CRS, ambiguous
overlaps or professional GIS interoperability. Native GDAL/OGR testing
is separate from a complete QGIS GUI examination.

No new paid APIs, map tile services, databases or persistent file storage
are introduced. Free client-side GIS conversion and the existing
engineering-preview `noindex` remain. Optional Pancake/Waffo checkout is
unchanged and inactive.
