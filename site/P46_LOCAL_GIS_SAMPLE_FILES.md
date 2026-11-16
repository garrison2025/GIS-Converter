# P46 — Synthetic, browser-local GIS examples on every converter

## Why

P45 improved converter navigation and allowed repeat conversions, but visitors
still needed to find their own GIS files, which often means preparing a
complete Shapefile bundle just to understand the free product.

P46 adds one explicit action on each of the **19 supported converters**:
**Try a sample [source format] file**.

The button locally constructs an authentic tiny source file and places it
into the browser's normal file picker. The user must then press
**Convert** to run the ordinary isolated GDAL/WASM Worker. The sample
never triggers automatic conversion, remote upload, hidden submission or
tracking. If the user had chosen their own file, it is replaced **only**
when they explicitly click the sample button; a helpful explanation says
so in advance. The same preflight checks, quality reports and critical
data-loss rejection continue to apply.

## Six genuine source formats

All six examples carry **one synthetic WGS84 Point at (116.4, 39.9)** with
the label `Example point`, and use a clearly synthetic filename.

| Source | Generated representation | Claim boundary |
| --- | --- | --- |
| KML | UTF-8 KML 2.2 Placemark Point | Shows point conversion, not styling/overlays |
| KMZ | ZIP containing one `doc.kml` | No archive images, network links or private data |
| GPX | UTF-8 GPX 1.1 waypoint with lat/lon | No false claim of track/elevation completeness |
| GeoJSON | Valid WGS84 FeatureCollection/Point with fields | Single point only; no complex geometry certification |
| CSV | UTF-8 decimal-degree `longitude,latitude,Name,Code` | One WGS84 row, not arbitrary projected CSV |
| Shapefile | Correct 100-byte `.shp`/ `.shx` headers, one Point record, one DBF row, `.prj` WGS84 plus `.cpg` UTF-8, zipped at root | Independently validated by **native OGR**, not generated through the website's conversion output |

All six input files are limited to **16 KiB**, constructed inside the browser.
JSZip is imported only if the user requests a ZIP-type sample. There is
no backend, database, map API, third-party conversion API, account or
Pancake billing activation. Normal browsing still does not load GDAL.

## UI and privacy

- The sample action is separate from the ordinary file picker and the
  Convert button. The user can still choose a real file, drop files or
  use the three-file mini-batch.
- Explicit sample loading updates the same file selection message and
  clears any prior output and quality-report Blob URLs via the existing
  file-change handler.
- The sample button becomes disabled while a real conversion is running,
  avoiding a user-interface race. A **Convert another file** action also
  clears any stale sample-loaded message.
- User files are never uploaded or sent to sample-generation code.
  Generated coordinates and labels are fixed, synthetic public examples.

## Acceptance and limits

`npm run smoke:demo-unit` independently inspects all six generated files,
including binary Shapefile headers, point coordinates, SHX index offsets,
DBF fields, UTF-8 codepage, WGS84 .prj and preflight acceptance.

`npm run smoke:demo-native` uses **installed native GDAL/OGR CLI**
to open the generated Shapefile, extract actual WGS84 point coordinates and
read the DBF Name/Code fields; this checks interoperability independently
of the website's GDAL/WASM.

`npm run smoke:demo-browser` runs **all 19 real browser GDAL/WASM routes**
using the newly generated source files, downloads output and quality JSON,
verifies feature-count checks and no third-party HTTP requests. A separate
WebKit touch-layout test loads a synthetic Shapefile ZIP and independently
checks its GeoJSON output. No Worker is started merely by selecting a
sample; conversion requires user action.

The public workflow waits for the **exact merged main SHA** deployed on
Cloudflare Pages, re-runs all sample conversions, and retains the existing
19 route upload/download and 19 preview/quality checks.

The samples demonstrate **simple point format conversions only**. They
do not certify topology, polygon holes, mixed geometry, complete metadata,
all GIS projections or phone RAM capacity; existing P40–P44 guards and
manual QGIS/physical-device limitations remain in effect.

Current public site is an engineering preview, intentionally blocked from
search indexing. Production launch, domain setup and SEO activation are
not silently changed by P46.
