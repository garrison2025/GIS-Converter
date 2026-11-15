# P43 — Real installed QGIS Qt GUI, browser GIS export, and constrained-device acceptance

## Scope and evidence levels (do not conflate)

P42 confirmed 19 public converter routes, 19 actual Playwright browser
cases and 7 independently produced native GDAL/OGR interoperability cases.
P43 adds **installed QGIS desktop's actual PyQGIS Qt map canvas**, plus
large-GDAL conversion, cancellation and retry under a **simulated 1 GiB
browser device-memory hint** in touch-sized Chromium/WebKit viewports.

The three evidence levels are distinct:

| Evidence | Meaning |
| --- | --- |
| Real QGIS Qt GUI, automated | QGIS is installed on Ubuntu; its native `QgsVectorLayer` OGR provider reads actual website files and `QgsMapCanvas` renders a PNG screenshot under a virtual display |
| Browser mobile profile, automated | Real GDAL/WASM conversion in Chromium/WebKit, using Playwright mobile viewport/touch simulation; simulated `navigator.deviceMemory`, Chromium CI process-tree RSS measured |
| Human-operated QGIS GUI and physical low-memory Android/iPhone | **Not verified by automated CI**; requires a real user or independent device lab; must not be reported as passed without device/test notes |

## Automated P43 desktop QGIS acceptance

The test installed from Ubuntu packages is not browser-side GDAL or a mock
layer. `site/scripts/p43-browser-qgis-fixtures.mjs` uses actual browser
uploads/downloads to generate three distinct output classes, which an
independent Python process then loads using `qgis.core.QgsVectorLayer`
and renders using `qgis.gui.QgsMapCanvas`:

1. **Browser GeoJSON -> ZIP Shapefile.** Two features, including one
   polygon with one interior hole and one two-part MultiPolygon; inspect
   `.shp/.shx/.dbf/.prj`, QGIS geometry type, three polygon islands,
   one hole, planar area 20, EPSG:4326, Chinese UTF-8 attributes and
   numeric fields.
2. **Native CP1252 Shapefile -> browser GeoJSON.** Native GDAL produces
   a genuine `.cpg` CP1252 file (raw `é` byte confirmed), includes an
   optional QGIS-style `.qpj` sidecar, then the website converts it.
   QGIS GUI independently reads the original Shapefile AND the browser's
   UTF-8 GeoJSON; both must preserve `Café Málaga` and numeric Code=31.
3. **Native EPSG:3857 Shapefile -> browser WGS84 GeoJSON.** QGIS must
   recognize the native projected layer as EPSG:3857 and downloaded
   GeoJSON as EPSG:4326, with separately validated transformed geographic
   coordinates and Chinese attributes.
4. **Qt GUI map canvas:** set the real Shapefile as a layer, render it
   via QGIS's Qt canvas, capture an actual PNG screenshot and record
   QGIS per-layer validation evidence.

Independent source/output SHA-256 hashes and sanitized checks are saved
in `p43-qgis-fixtures/browser-evidence.json`,
`p43-qgis-fixtures/qgis-desktop-evidence.json` and
`p43-qgis-fixtures/p43-qgis-desktop-map.png`.
The image is generated from wholly synthetic GIS features.

This automated QGIS UI widget test is **not** equivalent to human
interaction with QGIS's main window, layer dialogs, symbology tools,
attribute table, 3D renderer, plugins or saved project files.

## Automated mobile-profile reliability

`site/scripts/p43-mobile-resilience.mjs` checks:

- Actual 3,000 polygon / 3,000 hole GeoJSON -> Shapefile GDAL/WASM on
  390x844 Chromium touch viewport with `navigator.deviceMemory=1`
  emulation; independent geometry-quality pass, 3,000-feature count,
  actual ZIP download, memory-saving preview skipped, Worker terminated.
- Browser renderer process-tree **peak RSS in KiB** sampled from the
  GitHub runner, with conversion elapsed time. RSS is not actual phone
  RAM usage, includes multiple Chromium processes, and must not be
  presented as hardware requirements or guaranteed latency.
- On the same page, replace input and revoke old Blob URLs, cancel
  another real large GIS Worker, verify no partial/stale output and no
  leaked active Worker, then retry an actual KML -> GeoJSON conversion
  with memory-saving mode retained and independent coordinate check.
- WebKit in a mobile touch viewport with manually enabled memory-saving:
  actual GDAL/WASM point conversion, downloadable GeoJSON, skipped
  optional map preview and preserved coordinate-value quality report.

No additional external file APIs or uploads are used. Site limits remain
15 MiB per input file and the P42 12/24 MiB memory-saving batch limits.

## Manual acceptance checklist — physical hardware (UNVERIFIED)

Record the **actual device model, OS version, browser version, reported RAM
class (if known), file size, battery/thermal state and timestamp**.
Do not store identifiable user data or raw private GIS files in screenshots.

1. On a genuine Android Chrome device with around 2 GiB RAM, open
   `https://gis-converter.pages.dev/converter/geojson-to-shp/`.
   Confirm whether the memory-saving option is selected; if the browser
   exposes no reliable device-memory hint, enable it manually.
2. Use a **synthetic** GeoJSON containing 3,000 polygons and holes.
   Convert it to Shapefile; save the ZIP and quality JSON. Confirm
   `complex-geometry-values=pass`, correct feature count, successful
   download, and absence of optional SVG preview in saving mode.
   Record measured wall-clock time and whether the OS killed the tab.
3. Cancel a new conversion, then retry a small valid file. Check the
   previous output link cannot be reused, progress text is correct and
   only the new conversion is downloadable.
4. Repeat on an actual iPhone/Safari device; enable the saver manually,
   because `navigator.deviceMemory` is not reliably available.
   Check iOS Files download behavior, not just whether a Blob URL exists.
5. In a human-operated installed QGIS GUI, unzip the SHP and **Add
   Vector Layer**, open the attribute table and verify Chinese and
   accented fields, EPSG:4326, the hole visually visible at zoom,
   MultiPolygon islands and 3857 reprojection. Compare the exported
   GeoJSON layer and CP1252 fixture; record the QGIS version and screenshots.
6. Treat any tab reload, app kill, missing download, wrong CRS, missing
   hole, or corrupted property as failure. Document reproducible steps.

**Status:** the manual checklist is unverified until real external
device/QGIS evidence is supplied. No such evidence is manufactured.

## Deployment & costs

P43 adds automated tests, native-package interoperability evidence, and
reproducible manual acceptance. It **does not** enable production SEO,
change the Cloudflare release routing, activate Pancake/Waffo payments,
or add persistent servers/databases/cloud GIS APIs.

CI must pass independently for branch code and, after squash merge,
for the exact main commit deployed on Cloudflare Pages. Public site
remains engineering-preview `noindex`.
