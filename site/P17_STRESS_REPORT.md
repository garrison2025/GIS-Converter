# P17: polygon stress and attribute risk — verified staging evidence

Verified on GitHub Actions development run [43124414649](https://github.com/garrison2025/GIS-Converter/actions/runs/43124414649). The same source is now tracked on `main`.

## Real browser test
- Actual GDAL/WebAssembly conversion on a Linux GitHub Actions Chromium runner, not a mock.
- Synthetic input: **3,000 GeoJSON Polygon features**, each with one exterior ring and one interior ring (hole); 1,168,451 input bytes.
- Actual zipped Shapefile output: **1,435,134 bytes**, `.shp/.shx/.dbf/.prj/.cpg` present.
- Independently verified **3,000 DBF records, 3,000 SHX records and 3,000 SHP Polygon records**, with two ring parts per record. Four first/middle/last samples checked geometric coordinates, UTF-8 Chinese `Label` and numeric `Seq` attributes.
- Quality report: 3,000 input and 3,000 output features; feature-count check passes; **`shp-field-limits=review`** for intentionally overlong and colliding field names; attribute fidelity remains `unavailable`. Confirmed that GDAL renamed two long source field names in DBF.
- One background Worker created and terminated; no page exceptions.
- Conversion elapsed time: **843 ms** *on this particular GitHub-hosted CI runner*. No service-level or mobile performance guarantee.
- Sampled sum of Chromium subprocess-tree RSS: **634,020 KiB (~619 MiB)** over 5 samples. This is a rough process memory observation that may double-count shared memory pages; it does not isolate WASM heap and cannot be extrapolated to consumer devices.
- Chromium JS heap measurements (pre/post) are reported for reference but do not include WebAssembly's linear memory.

## What this test cannot certify
- Arbitrary invalid, self-intersecting, multipolygon/multilayer and polygon-with-thousands-of-vertices geometry; sophisticated topology correctness; all coordinate systems; all attribute field names/types/values; large file / low-memory mobile behavior.
- Raster conversions, remote data uploads, live billing or 15 MiB maximum stress.
- Normal output with a review status **can still be downloaded** when the issue is a Shapefile metadata-name warning, not verified geometry/feature loss.

## GDAL and DBF limitations

[GDAL ESRI Shapefile/DBF driver documentation](https://gdal.org/en/stable/drivers/vector/shapefile.html) describes the roughly 10-character DBF field-name limit, automatic collision renaming, geometry-family limits and supported DBF types. A warning about likely field-name modification is not proof of arbitrary data loss.

CI source: `site/scripts/polygon-stress.mjs`. Run after building the Astro app using `npm run smoke:polygon-stress`.

**Release state:** This remains a noindex browser-local engineering preview. No D1 authentication, Pancake/Waffo live payments, ads, or production indexing has been enabled.
