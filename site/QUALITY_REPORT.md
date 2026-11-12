# GIS Converter — Automated quality inspection (staging)

A local, **bounded structural comparison** is produced *inside* the existing conversion Worker before the GIS file is downloaded. All checks are browser-local, and the downloadable JSON is created through an in-memory Blob URL.

### Supported checks
- Independently parse recognized GeoJSON `FeatureCollection` objects, CSV rows with longitude/latitude, single-point KML Placemarks, simple GPX waypoints, KMZ KML contents, and zipped SHP/SHX/DBF metadata.
- Compare input vs output feature counts only when both inspectors can structurally account for their data.
- Compare WGS84 point bounds only when both coordinate systems can be inferred safely and geometry types are supported.
- Flag discrepancies as **Review** instead of manufacturing a green certificate. Return **Unavailable** for unknown projections, detailed GPX track geometry comparisons, complicated KML, mixed geometry cases and unsupported formats. For GPX→KML/KMZ, a narrower logical feature-count check is available.
- Report has no source feature properties, names, user files or personally identifying location details beyond a numeric bounding box, which is **local and can itself be sensitive**. The report is not uploaded automatically.

### Not certified
This is not a GIS data accuracy or security certification. It does not prove polygon topology, geometry repair, vertex-by-vertex equality, feature ordering, field names/types/value fidelity, styles, metadata, full reprojection quality, or safe handling of all malformed archives. A binary SHP index/DBF count check is necessary but insufficient. Only a small, explicit allowlist of GeoJSON WGS84/CRS84 declarations is recognized; any other declared CRS is not assumed to be WGS84. KML/GPX inspection is intentionally limited and uses a narrow simple-point recognition heuristic.

A conversion can succeed while the quality report requests review. Production GIS verification still requires independent QGIS/GDAL inspection of representative customer datasets. No user/account/payment service is active.

### P16 fail-closed protection
Mixed point/line/polygon GeoJSON geometry families are rejected before attempting a single Shapefile output. After conversion, if independent comparable feature counts or WGS84 point bounds definitively differ, the file is withheld and the user receives an error. Unknown or unsupported comparisons remain explicitly `unavailable`; they do not claim certification. The rule currently applies only where the independent parsers can compare those invariants. This cannot guarantee every feature or attribute survived.

### P17 Shapefile field compatibility warnings
For GeoJSON→Shapefile, the report scans source property **names and types** within a bounded set and warns about UTF-8 field names over 10 bytes, possible first-ten-byte collisions, or object/list properties. Only counts are exposed in the local JSON report, not source keys or values. A clean schema scan **does not prove field values are preserved**; Shapefile DBF has other field type/width restrictions. See GDAL's official ESRI Shapefile/DBF driver reference. The conversion is not withheld for metadata-name warnings alone.

### P20 GPX logical-layer protection and tested samples
- GDAL's GPX reader exposes three logical feature layers (`waypoints`, `routes`, `tracks`) plus two auxiliary vertex layers (`route_points`, `track_points`). Exporting only the logical layers to KML/KMZ prevents auxiliary vertices from being emitted as duplicate standalone point features.
- A browser-local independent `gpx-logical-features` check compares the count of source waypoints + routes + tracks against output KML Placemarks; an independently detected count mismatch withholds the download. Invalid or unsupported cases are not marked certified.
- Real Chromium/GDAL QA fixture: **2 waypoints + 2 routes + 2 tracks** (one track has two segments) yielded **6 Placemarks, 5 lines and 10 route/track vertices** in each of KML and KMZ. Names and each synthetic vertex coordinate are individually tested in the regression suite. This does not establish accurate preservation for every GPX extension, track-point time, elevation, large or malformed dataset.
- Independent sample EPSG:32650 UTM zone 50N Shapefile→GeoJSON roundtrip returned longitude/latitude within `0.0001°` of the WGS84 input. This is a single synthetic location and **not** general CRS certification.
- Two-record GeoJSON→Shapefile→GeoJSON QA checks UTF-8 Chinese strings, integer and decimal properties. DBF null values, arbitrary field names/types, widths and coercion remain **uncertified**. Do not infer production-safe attribute fidelity from the fixture.
- The production website remains a browser-local noindex engineering preview; billing is not activated. Cloudflare public deployment must be checked separately from GitHub CI.

### P21 track vertex checks and value compatibility warnings

- **GPX → KML/KMZ**: a bounded browser-only comparison inspects logical GPX route segments and track segments against output KML LineStrings. It compares total vertex counts, segment counts and within-segment lon/lat coordinates rounded to **six decimal places**. A definite discrepancy withholds the converted file. It is *not* an exact geodetic accuracy, full XML validity, ordering, elevation or topology certificate.
- The P21 line inspector deliberately returns **Unavailable**, rather than passing, for unsupported markup/invalid coordinates, waypoint-only GPX, more than 2,000 lines or 50,000 route/track vertices. Its exported JSON does not contain the source vertex list.
- GPX point-level <code>time</code>, <code>ele</code> and <code>extensions</code> tags produce an aggregate **Review** warning. The GDAL GPX driver exposes some of these on per-point auxiliary layers, but this product's KML/KMZ exports use the three logical feature layers. Do not assume timestamp, elevation or extension preservation; source samples are not included in the report.
- **GeoJSON → Shapefile**: count risky source values including explicit <code>null</code>, UTF-8 strings longer than 254 bytes, numbers with more than 15 significant decimal digits and unsafe integer values. These produce a **Review** warning; they do **not** automatically block a conversion or prove that a DBF truncation happened. The original values are not included in the report.
- Actual Chrome/GDAL tests cover a GPX with sample time/elevation values and a one-record long-string/null/precision DBF example. These are regression fixtures rather than independent certification of arbitrary customer datasets. Null roundtrip is **not** marked certified.
- Formal release still requires representative real-user files inspected with independent QGIS/GDAL. Live Pancake/Waffo billing, accounts, ads and SEO indexing remain disabled.
