# GIS Converter P40 — complex geometry output fidelity

## Verified engineering gap

Earlier GIS quality checks independently compared eligible point coordinates,
GPX line sequences, and DBF fields. Other LineString, MultiLineString,
Polygon and MultiPolygon data could have a lost interior vertex, removed hole
or changed multipart structure without detection by feature count or bbox.

## Bounded change

P40 independently reads **actual source and converted output** GIS bytes,
without mutating the generated file. It supports confirmed WGS84 GeoJSON,
simple KML, KMZ doc.kml and 2D Shapefile (PolyLine/Polygon) within **8 MiB,
500 features, 20,000 XY vertices**.

- Check line vertex sequence (allowing reversal) and MultiLineString part
  membership (allowing reordering).
- Check polygons including outer rings and interior holes, permitting rotated
  ring starting vertex and reversed winding while retaining ring membership.
- Check MultiPolygon islands/components including hole assignments.
- Verify SHP record geometry, matching SHX index offsets, PRJ WGS84 and
  bounded ZIP sidecars independently from the browser's GDAL/WASM.
- Explicitly verify geometry coordinates and component structure, not just
  feature counts, global extents or SVG visuals.
- When an eligible, unambiguous pair has a definite change, add
  `complex-geometry-values: review` to the downloadable quality report
  and block the file through the existing DATA_LOSS guard.
- Output quality reports disclose aggregate counts/statuses only, never
  individual coordinates or private attributes.

## Important limitations

This is **not** formal polygon topology certification, geometric validity
checking, CRS transformation audit, survey accuracy testing, property equality,
geometry Z/M/elevation or geodesic measurement. It does not certify
mixed geometries, GeometryCollection, curves, gx:Track, unsupported KML
extensions, projected/uncertain CRS, ambiguous overlapping features, null
SHP shapes or oversized files. These cases are flagged as **unavailable**,
not falsely passed or blocked.

The inspector compares coordinates with an XY tolerance of 0.000005 degrees,
and is not suitable as a professional surveying tolerance. It preserves
feature and multipart structure; repeated/ambiguous component matching
falls back to an unavailable result.

Existing P21–P39 checks and 19 conversion routes remain unchanged in intent.
GPX timed tracks and elevation continue to use their own dedicated
inspectors; P40 does not falsely claim full GPX metadata preservation.

## Verification / deployment

- `npm run smoke:complex-geometry` covers altered interior line vertices,
  missing/altered holes, reversed lines, reordered multi-components,
  missing MultiPolygon islands, independent SHP ZIP readback and
  DATA_LOSS blocking.
- Existing browser tests gain a real GeoJSON -> SHP polygon-hole quality
  download and a real GeoJSON -> KML LineString quality download
  (**16 total browser cases**).
- GitHub CI includes native GDAL/OGR, P34 mini-batch, P38 real public GPX,
  P39 points, all 19 routes, mobile, security and SEO isolated builds.
- A one-shot public workflow waits for the exact merged main SHA to appear
  in `https://gis-converter.pages.dev/release.json` before publicly
  exercising the 16 quality/preview cases and 19 routes.

The site remains engineering-preview/noindex until a real-domain SEO launch
is separately approved. No new backend, external file uploads, paid APIs or
fixed costs; Pancake/Waffo payments remain inactive.
