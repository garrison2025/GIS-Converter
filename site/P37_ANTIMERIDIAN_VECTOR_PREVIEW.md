# P37 — antimeridian-aware, output-based local GIS vector preview

## Scope

This is a rendering improvement for the existing P35 actual converted-output browser-only preview. GDAL conversion and download formats, original CRS and coordinates, quality inspection, and P34 mini-batch are unchanged. No external maps, services, APIs, cloud file uploads or billing.

## Behavior

- Input is the bounded, WGS84-checked point/line/polygon sample from actual converted output (up to 60 features and 3,000 vertices).
- When original sample longitude span <=180 degrees, the SVG keeps the original display frame.
- If the sample spans +/-180 longitude, choose the shortest circular longitude arc, shift display-only X to a continuous interval, and use the same frame for points, lines and polygon rings/holes.
- Original feature.coordinates and bbox remain WGS84. Only feature.displayCoordinates and displayBbox are added to the preview payload for visualization.
- The UI shows both original geographic bounds and shifted drawing bounds, explicitly warning about the shortest-arc assumption. Shifted coordinates are not download coordinates.
- If no safe <=180-degree circular sample exists, preview reports unavailable; converted file and independent quality report remain downloadable.

## Safety and limitations

No basemap, scale, tile request, geodetic projection, upload, measured route or certified GIS topology. A dateline sketch cannot establish intended short-way/long-way edge semantics or polygon topology. A global/geographically ambiguous footprint fails closed.

## Verification

- npm run smoke:antimeridian-unit: untouched source data, +/-180 line, MultiLineString, polygon with hole, normal no-op, global ambiguous case.
- npm run smoke:preview-local: real GDAL/WASM conversion in Chromium/Firefox/WebKit, including KML to GeoJSON crossing dateline and unchanged downloadable coordinates.
- Prior 19-route, native GDAL/OGR, P34 batch, mobile, security and SEO CI remain required.
- Exact live Cloudflare Pages release SHA is required before P37 public preview and 19-route tests are recorded as successful.

## Deployment

Site remains engineering-preview/noindex until explicit future domain/SEO launch. Optional Pancake billing remains inactive. CI tests do not establish physical device compatibility.
