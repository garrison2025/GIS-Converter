# GIS Converter P34 — free browser-only mini-batch

## What's actually new

The same **19 existing** GIS conversion routes now accept either a single source file or **2–3 source files of the same route's input format**. No account or payment is needed.

- Select multiple files through the native file picker (also supports dragging files into the input area).
- Per-file source limit: **15 MiB**; total source limit per batch: **30 MiB**; maximum **3** files. Empty files are blocked. The generated combined outputs are bounded to **96 MiB** to prevent unbounded JSZip packaging.
- Every source is handled by a **separate, sequential GDAL WebAssembly Worker**. This deliberately avoids launching three 28 MB WASM runtimes concurrently in memory.
- A **single file behaves as before** and downloads directly as GeoJSON/KML/KMZ/GPX/CSV/Shapefile ZIP, with its JSON quality report.
- When selecting 2 or 3 files, the UI shows progress (`Converting file N of 3`), then creates one local ZIP that contains:
  - `converted/01-...`, `02-...`, `03-...`: actual per-file GIS conversion outputs
  - `reports/01-inspection.json`, etc.: **the per-file structural quality reports returned by the real worker**
  - `manifest.json`: format route, count, output file paths, source file names (sanitized), per-file inspection status and output byte length
- Duplicate source and output names are **never overwritten**, because output ZIP entry names use distinct numbered prefixes and strip untrusted path fragments.
- Invalid source file, unsupported geometry, timeout, cancellation or packaging overflow: **the entire batch fails closed, with no partial ZIP**; the user can correct and retry.
- The aggregate JSON quality-report download summarizes the batch. Individual full reports remain in the ZIP. Quality reports are **structural checks, not professional GIS certification**.
- All file conversion and ZIP packaging happen in the user's browser. No backend, D1/Supabase database, Cloudflare API, Pancake/Waffo account or paid subscription is needed for this free mode.

### ZIP-in-ZIP is intentional

Shapefiles require multiple matching components (`.shp`, `.shx`, `.dbf`, `.prj`, optionally `.cpg`). A batch converting **to Shapefile** contains one individual **inner SHP ZIP per input** inside the batch ZIP. Similarly, KMZ is itself a ZIP archive containing KML; multiple KMZ outputs are embedded as separate `.kmz` files. Do not flatten these datasets, as it could corrupt corresponding fields and geometry.

## Actual validation

The branch and main CI execute:
1. `npm run smoke:mini-batch-unit`: quota limits, safe paths, unique entry names, two independent quality reports, manifest, aggregate summary and cancel behavior.
2. `npm run smoke:mini-batch-local`: **11** actual Playwright+GDAL browser cases using synthetic files:
   - Chromium, Firefox and WebKit each upload two KML files, receive a ZIP, parse distinct converted GeoJSON values, check each quality JSON, and verify two workers were started and terminated
   - Single-file direct GeoJSON download regression
   - Three files with *identical source names* produce three uniquely named, accurate outputs
   - ZIP-in-ZIP for KML→SHP and CSV→KMZ; inner datasets and KML coordinates checked
   - Second source invalid: no partial result, error names file 2, retry succeeds
   - More than three sources and combined input over 30 MiB rejected before Worker start
   - Browser drag/drop chooses two sources but never automatically starts conversion
   - Cancel in-progress batch terminates Worker and exposes no partial result
3. All previous **19 route single-file regressions**, security preflight, cross-browser Chromium/Firefox/WebKit and native GDAL/OGR desktop interoperability remain CI gates.
4. After merging, a **one-time public Cloudflare Pages workflow** first confirms `release.json` matches the exact merge commit, then reruns the same 11 live browser mini-batch cases and 19 existing route downloads. Save `p34-mini-batch-live-results.json` and `live-matrix-report.json`; do not claim public success until its job turns green.

## What P34 does not do

- This is a *limited free mini-batch*, not unlimited paid SaaS batch processing. The optional paid SaaS lane still uses the specified **Pancake/Waffo** platform when it is designed and separately activated. No checkout, payment callback or user storage is created here.
- No server-side job queue, retry of selected failed files, cloud backup, background processing across browser closures or guaranteed 96 MiB output support on real iPhones. Heavy files can strain a device's RAM even under the source limits.
- No new format routes beyond the existing 19; batch applies the same input preflight, supported geometries, CRS handling and output fidelity limits to each source separately.
- Google Earth Pro native playback, real QGIS GUI, iOS/Android physical hardware and screen reader acceptance remain separate manual test gates.
- P30 SEO launch is **still default-off/noindex**. Current `gis-converter.pages.dev` cannot be called publicly indexable, and no unowned .com domain or sitemap is invented.
