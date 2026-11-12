# GIS Converter P39 — independently verify all eligible point coordinates

## Discovered integrity gap

Before P39, the structural quality report checked point feature counts and
longitude/latitude bounding boxes. Changing an **interior point** without
changing either the count or the geographic extrema could evade both checks,
so the quality report could appear too reassuring.

## Implementation

New independent WGS84 point XY inspection uses actual input and converted
output bytes in the browser Worker. It supports simple point-only GeoJSON,
KML, KMZ, CSV, and waypoint-only GPX under strict parsing/CRS bounds.

- Compares up to **20,000 Point positions** on each side, regardless of feature
  order, within a documented tolerance of 0.000005 degrees per axis.
- Uses a two-dimensional spatial index to detect unmatched points rather than
  comparing counts/bboxes only. Report has **counts and statuses only**; no
  point coordinates, GPS track details, field values or private names.
- A **definite** point count or coordinate mismatch produces
  `point-coordinate-values: review` and the existing critical data-loss guard
  withholds the output.
- Complex/mixed geometry, MultiPoint, GPX routes/tracks, uncertain CRS,
  point pairs too close to match unambiguously, longitude normalization near
  +/-180, excess data or invalid encodings return `unavailable`, not a pass
  or a false critical loss.
- The existing bounding-box check remains visible but is not treated as a
  full comparison.
- Existing fast quality-inspection parsers now reject blank, hexadecimal,
  out-of-WGS84-range and coercion-prone point values in GPX, KML, CSV and
  GeoJSON; MultiPoint does not qualify as one position per feature.
- Full polygons, Shapefile geometry and GPX track timing/elevation do **not**
  gain a new certification from this point-specific feature. They continue
  under their previous dedicated checks and warnings.

## Verification

- `npm run smoke:point-fidelity`: moving the middle coordinate without
  changing extrema triggers review and a blocked download, while unchanged
  and reordered points, CSV with escaped fields, KMZ and GPX waypoints pass.
  MultiPoint, tracks, duplicated points, unknown projected CRS and seam
  coordinates remain unavailable. Invalid parser inputs never falsely pass.
- The real-browser output suite expands from 14 to **15** cases, adding
  actual CSV -> KML GDAL/WASM conversion, a separately downloaded quality
  JSON, and the independent point-value status.
- All 19 converter routes, P38 GPX eTrex time pairs, P37 dateline,
  P33 desktop OGR, P34 mini-batch, P30 offline SEO and billing regressions
  stay in hosted CI.
- P39 public acceptance waits for **exact merged SHA** from live Cloudflare
  before running the same 15 browser preview/quality cases and 19 routes.

## Limits / deployment

Accuracy tolerance is a cautious byte-level comparison, **not geodetic
surveying, topology validation, projection certification or native QGIS GUI
testing**. Empty/complex/geographically ambiguous samples are disclosed as
unavailable rather than silently treated as verified.

No external GIS upload, map tiles, database or new fixed cost; optional
Pancake/Waffo billing remains inactive. Cloudflare preview stays
engineering-preview / noindex until explicit approval for a real domain.
