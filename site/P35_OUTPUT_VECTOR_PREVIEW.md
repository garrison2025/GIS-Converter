# GIS Converter P35 — output-based vector preview (free, local)

## Product behavior

After a successful conversion, the result area contains a **geographic vector preview** below the existing file download and independent structural quality report. The implementation does not call map tiles, geocoding, analytics endpoints or a GIS conversion server. All source files, generated vector preview features and inspected attribute values remain in the **user's browser**.

- **GeoJSON outputs** are read directly from the **converted GeoJSON bytes**.
- **Shapefile ZIP, KML, KMZ, GPX and CSV outputs** are read directly from the **generated output bytes** by bounded, format-specific browser-only parsers in the same isolated Worker. There is **no second GDAL conversion**, avoiding accidental delays or timeouts for a successful file export. The preview is drawn *from the generated file*, not the original uploaded file.
- Points, lines, polygons (including interior holes) and Multi* counterparts display in an SVG schematic using longitude/latitude. A user can select a feature and inspect up to six scalar attributes. Attributes are inserted with `textContent` and never parsed as HTML.
- **Two- or three-file free mini-batches** have a local file picker in the preview panel; each selected file shows its own visual sample and properties. The downloadable batch ZIP and per-file quality reports remain unchanged.
- Choosing another input clears the old SVG and attributes immediately, just as P31 clears the previous Blob download links. A malformed source never reveals a stale preview.
- SVG mapping has **no basemap** and is not an accurate map projection, route navigation interface, area calculator, CRS verification or a substitute for desktop GIS. See the warnings displayed with every map.

## Boundaries and failure policy

| Guard | Enforced behavior |
| --- | --- |
| Source of visualized coordinates | Actual **converted output** only, not original source |
| Visible features | First **60 features** maximum; not a guarantee all layers are shown |
| Vertices | **3,000 XY points** maximum in an in-memory preview sample |
| Non-GeoJSON input for preview | **5 MiB** maximum generated output file size |
| Intermediate GeoJSON sample | **850 KiB** maximum before parsing |
| Coordinates | Only finite longitude from -180 to 180 and latitude from -90 to 90; unsuitable CRS rejected |
| Unsupported geometries | Unsupported or invalid geometry results in an explicit unavailable preview |
| Antimeridian | Shows a caution when longitude span exceeds 180°, does **not** unwrap lines or rings |
| Large input/output or failed sample | Preview reports **unavailable**. Valid converted output and quality report remain downloadable |
| Interactive attribute fields | Up to six safe primitive values per displayed feature, 48 characters per key and 120 per value; no HTML interpolation |
| Security | No map tile URLs, API keys, uploaded files on a server, new databases or paid services; output ZIP parsing is bounded, projection declarations checked and SVG text is never interpreted as HTML |

Feature counts shown for GDAL readback are explicitly **sample counts**, not a statement of complete GIS feature coverage. Some formats (especially GPX track timing, CSV schemas and invalid/unsupported geographic layers) may not yield a safe schematic even though the underlying conversion succeeds. The quality report and file downloads are always separate.

## QA strategy

1. `npm run smoke:preview-unit`: mixed point/line/polygon and inner hole, properties limits, 60-feature cap, invalid CRS and coordinates, oversized vertex rejection.
2. `npm run smoke:preview-local`: **11 real Chromium, Firefox and WebKit browser tests** including KML→GeoJSON vector+fields; GeoJSON→Shapefile native ZIP readback including a polygon hole; KML→KMZ; CSV→KML; KML→GPX; KML→CSV; mini-batch file switch; source replacement cleaning; malformed input; Firefox and WebKit render.
3. Existing P34 batch, all 19 routes, P29 complex GIS, P31 mobile, P32 cross-browser, P33 native desktop GDAL, P30 isolated SEO and D1 offline billing remain required CI gates.
4. After main merge, `p35-public-output-preview.yml` waits for **exact live Cloudflare Pages release SHA**, then executes the same 11 public browser tests and the existing 19 single-file route regression. Confirm the public evidence report rather than treating branch CI as live deployment.

## Unchanged gates

Site remains **engineering-preview/noindex** until a real user-owned `.com` and explicit SEO approval. Real iOS/Android devices, physical macOS Safari, desktop Google Earth Pro time playback, QGIS GUI and screen readers remain **unverified external checks**. The free browser converter does not require an account or paid SaaS tier; future optional SaaS payments remain specified as **Pancake/Waffo**, not activated.
