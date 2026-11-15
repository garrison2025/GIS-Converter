# P42 — constrained-memory conversion and native GIS interoperability

## Concrete issues addressed

P41 already independently verified 3,000 real polygon-hole Shapefile
conversions and large geometry fidelity. P42 focuses on the **next real device
and interoperability boundaries**, not expanding upload or conversion
limits.

1. Browser GDAL/WASM previously performed an optional map-preview pass
   even when the user only needed the output and its quality report.
2. ZIP batching used DEFLATE regardless of available device memory, and
   output guardrails were the same on all devices.
3. Native desktop GIS interoperability lacked an independently generated
   **Windows-1252 / CP1252** Shapefile test with `.cpg` and QGIS-style
   optional `.qpj` companion.
4. Inconsistent DBF encoding declarations may produce text mojibake;
   merely selecting an encoding open option cannot reliably resolve a
   mislabeled file. Any correction must be demonstrable against raw DBF
   bytes without changing geometry or numeric data.

## Browser resource controls

- A visible **Use memory-saving mode** checkbox is available on each
  converter page. It is automatically selected *only* when the optional
  `navigator.deviceMemory` hint is 2 GiB or less. All other browsers,
  including browsers without this API, can enable it manually.
- The hint is not a real-time measure of available RAM. No speed, actual
  memory cap, or guaranteed conversion success is implied.
- Memory-saving mode **skips only the optional preview GDAL pass**.
  The original converted output, native byte download, independently
  generated quality report and critical GIS loss guards remain active.
- Existing per-file 15 MiB limit remains. In memory-saving mode a
  mini-batch accepts up to **12 MiB combined input** and
  **24 MiB combined converted output**, and packs the ZIP with STORE
  instead of a second DEFLATE compression pass. Normal 30 MiB input and
  96 MiB output batch limits remain in the ordinary mode.
- Conversion and timeout/cancel errors still terminate the isolated
  Worker, re-enable file controls, and allow retries. The checkbox is
  disabled during an active conversion to prevent a mid-job mismatch.
- A conservative batch-cap error guides users to process files singly or
  disable the mode only when their device can accommodate the workload.

## Interoperability & encoding

- Native GDAL/OGR independently generates a real Windows-1252 Shapefile
  and validates the DBF **raw byte encoding**, `.cpg` metadata, .prj CRS,
  .shx and .dbf records. A QGIS-style `.qpj` is included as an optional
  companion and cannot break unrelated projected Shapefiles when absent.
- The browser's SHP → GeoJSON export must preserve the native input's
  accented attributes and positions, then be independently read back.
- A bounded CP1252 DBF reader handles only explicitly declared
  Windows-1252 text within confirmed fields and row boundaries.
  It compares raw DBF-decoded values against each emitted property;
  **only values matching a recognized double-decoding error may be
  corrected**. Already-correct text is left unchanged. Numeric fields and
  geometry are never rewritten from DBF.
- Unsupported or ambiguous legacy codepage/row mapping fails closed with
  guidance to re-export as UTF-8. This is not general support for every
  legacy encodings or arbitrary QGIS plugin fields.
- Independent DBF field certification remains limited to its declared
  strict UTF-8 scope; a CP1252 correction is not incorrectly advertised
  as a general attribute-fidelity certificate.

## CI and acceptance

- `npm run smoke:memory-policy` checks low-memory hint behavior,
  12/24 MiB limits, actual STORE ZIP contents and worker flag cleanup.
- `npm run smoke:legacy-dbf` checks raw-byte CP1252 decoding, exact
  row/field correspondence, already-correct values, numeric and
  coordinate preservation, and fail-closed unsafe cases.
- The existing browser preview test suite increases from **16 to 19**
  actual cases, adding Chromium automated low-RAM simulation,
  preserved downloadable GIS output and report, ordinary retry with
  preview restored, WebKit manual memory-saving conversion, plus 14 MiB batch rejection
  before GDAL/WASM and successful single-file recovery.
- Native OGR interoperability extends from **six to seven** distinct
  cases; the added source is produced by native GDAL and read in the
  real browser GDAL/WASM converter, not by the website's own encoder.
- The P42 public acceptance gate waits for the exact merged commit in
  Cloudflare Pages, then checks **19 real browser cases**, 7 native
  interoperability cases and **all 19 upload/download routes**.

## Limits / deployment state

QGIS *desktop GUI* import/export has **not** been manually tested.
Native GDAL/OGR acceptance proves compatibility with specific real CLI
readers/writers, not a blanket claim that all QGIS project/workspace,
symbology, layout or plugin metadata transfers correctly.

The project remains browser-local and engineering-preview/noindex.
There are no new persistent database, maps, server GIS processing or
subscription dependencies. Optional Pancake/Waffo checkout stays inactive.
