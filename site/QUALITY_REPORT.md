# GIS Converter — Automated quality inspection (staging)

A local, **bounded structural comparison** is produced *inside* the existing conversion Worker before the GIS file is downloaded. All checks are browser-local, and the downloadable JSON is created through an in-memory Blob URL.

### Supported checks
- Independently parse recognized GeoJSON `FeatureCollection` objects, CSV rows with longitude/latitude, single-point KML Placemarks, simple GPX waypoints, KMZ KML contents, and zipped SHP/SHX/DBF metadata.
- Compare input vs output feature counts only when both inspectors can structurally account for their data.
- Compare WGS84 point bounds only when both coordinate systems can be inferred safely and geometry types are supported.
- Flag discrepancies as **Review** instead of manufacturing a green certificate. Return **Unavailable** for unknown projections, GPX tracks, complicated KML, mixed geometry cases and unsupported formats.
- Report has no source feature properties, names, user files or personally identifying location details beyond a numeric bounding box, which is **local and can itself be sensitive**. The report is not uploaded automatically.

### Not certified
This is not a GIS data accuracy or security certification. It does not prove polygon topology, geometry repair, vertex-by-vertex equality, feature ordering, field names/types/value fidelity, styles, metadata, full reprojection quality, or safe handling of all malformed archives. A binary SHP index/DBF count check is necessary but insufficient. Only a small, explicit allowlist of GeoJSON WGS84/CRS84 declarations is recognized; any other declared CRS is not assumed to be WGS84. KML/GPX inspection is intentionally limited and uses a narrow simple-point recognition heuristic.

A conversion can succeed while the quality report requests review. Production GIS verification still requires independent QGIS/GDAL inspection of representative customer datasets. No user/account/payment service is active.

### P16 fail-closed protection
Mixed point/line/polygon GeoJSON geometry families are rejected before attempting a single Shapefile output. After conversion, if independent comparable feature counts or WGS84 point bounds definitively differ, the file is withheld and the user receives an error. Unknown or unsupported comparisons remain explicitly `unavailable`; they do not claim certification. The rule currently applies only where the independent parsers can compare those invariants. This cannot guarantee every feature or attribute survived.

### P17 Shapefile field compatibility warnings
For GeoJSON→Shapefile, the report scans source property **names and types** within a bounded set and warns about UTF-8 field names over 10 bytes, possible first-ten-byte collisions, or object/list properties. Only counts are exposed in the local JSON report, not source keys or values. A clean schema scan **does not prove field values are preserved**; Shapefile DBF has other field type/width restrictions. See GDAL's official ESRI Shapefile/DBF driver reference. The conversion is not withheld for metadata-name warnings alone.
