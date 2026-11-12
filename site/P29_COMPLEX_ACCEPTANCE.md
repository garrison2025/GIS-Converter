# GIS Converter P29 — complex GIS file integrity on Cloudflare Pages

## Scope

P28 proved all **19 basic point-file conversion routes** work through the public Cloudflare Pages site using real Chromium uploads/downloads. P29 validates more demanding, independently inspectable file semantics and does **not** broaden supported GIS formats or claim universally lossless conversion.

The exact same **six test cases** run first in Chromium against the locally built Astro/GDAL site, then via a one-time main-merge public Cloudflare job. Neither test bypasses the actual converter UI and neither uploads customer/private GIS files to a server.

| Case | Public browser workflow | Independent acceptance |
| --- | --- | --- |
| 1 | GeoJSON → zipped Shapefile | Two polygon records with one inner hole and a MultiPolygon with two parts; SHP/SHX binary record structure, DBF UTF-8 Chinese text, integer values, .cpg |
| 2 | Output from case 1: zipped SHP → GeoJSON | Two features, three polygon parts, one interior hole, expected planar test area and two original attributes |
| 3 | GeoJSON point → SHP; independent binary rewrite into EPSG:3857 metres; projected SHP → GeoJSON | Reprojection to longitude/latitude with stated tolerance and text/integer field equality |
| 4 | Public Apache-2.0 eTrex sample GPX → KML | All 104 track timestamps, longitude, latitude and supplied elevations compared vertex-by-vertex with KML gx:Track |
| 5 | Same public eTrex GPX → KMZ | Real browser-downloaded ZIP contains doc.kml; 104 time/position/elevation pairs compared independently |
| 6 | Mixed point/polygon GeoJSON → SHP | Conversion rejected, error describes mixed geometry families, no output/download exposed |

**Privacy:** Public eTrex fixture provenance and Apache license are recorded in `test-fixtures/public-gpx/README.md`. Reports only contain aggregate counts and boolean equality results; source GPS coordinates, track timestamps and customer data are not logged. The test data include synthesized polygon/CRS examples and a public archive GPS sample; no proprietary GPS data are collected.

**Quality limitations:** GeoJSON/Shapefile attribute fidelity checked only for sample columns, ring structure and selected geometry. WKT source projection is constructed by the regression test and is not an external independently surveyed CRS. Google Earth Pro desktop gx playback, all real Garmin/Apple Watch exports, vertical reference systems, real iOS/Android devices, huge datasets and general losslessness remain independent acceptance gates.

## Validation workflow

1. P29 development branch: GitHub Actions `hosted-validation` runs `npm run smoke:complex-local` against a **real built Astro site and real browser GDAL/WASM**, in addition to existing data-fidelity and security tests.
2. After branch CI succeeds, merge into `main`. The marker `site/.p29-live-acceptance` triggers **GIS Converter P29 one-shot complex public GIS acceptance (read-only)**.
3. Public workflow first compares `https://gis-converter.pages.dev/release.json` with the exact merged SHA. It then tests the six public complex cases and rechecks the existing 19 basic conversion routes. Inspect `gis-p29-live-complex-acceptance-evidence` containing `p29-live-deployment-wait.json`, `p29-complex-live-results.json`, `live-release-gate.json` and `live-matrix-report.json`.
4. A matching deployed SHA alone does not certify the browser tests. Only a finished green public job plus its **6/6 complex** and **19/19 route** reports counts as public acceptance. Report an actual failure or unsupported case honestly; do not turn a failing test into a false pass.

## Current index/monetization gates

The Pages preview remains **noindex,nofollow** with `robots.txt Disallow: /`. A real .com domain has not been supplied in this project thread, so do not invent production canonical URLs or prematurely publish a sitemap. Before SEO launch, validate the real domain, domain-based canonical URLs, status-200 static XML sitemap, appropriate robots policy, title/content quality, independent SEO competition and GSC ownership. Display ads are optional free-site monetization; paid batch/SaaS services would separately use **Pancake/Waffo**, with no live charge or backend requirement for basic browser conversions.

No auto-DNS, advertising activation, checkout or paid account flow is included in P29.
