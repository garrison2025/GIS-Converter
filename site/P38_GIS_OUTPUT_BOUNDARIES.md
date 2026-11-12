# P38 GIS Converter — output-preview integrity boundaries

## Scope and independently reproducible issues

The existing P35 converted-output preview read GPX waypoint/track coordinates using JavaScript Number() without strict empty-value checks, so whitespace coordinates could appear as a (0,0) geographic point. KML coordinates accepted malformed extra tuple components; gx:Track previews did not independently require aligned timestamps. SHP polygon preview could fabricate an outer shell from a counterclockwise hole, or render an unclosed/degenerate ring as a valid polygon.

These are **optional output preview** issues, not proof of actual GDAL conversion data loss. Conversion outputs are not modified in P38.

## Changes

- Reject GPX/KML longitude, latitude and optional elevation/altitude unless they are finite, strictly numeric strings; still accept genuine 0,0 coordinates.
- Match GPX lat and lon attributes by true attribute boundaries, rejecting look-alike suffixes.
- Require gx:Track coordinate triplets and 1:1 valid time tags for schematic preview. A malformed timeline makes preview unavailable; it does not change file download.
- Reject SHP polygon rings that are unclosed, zero-area or a CCW hole before its CW shell. Preserve valid SHP holes and multipart geometry.
- Continue to show original converted WGS84 data only; do not invent missing points or timestamps. Output quality report remains separate.

## Verification

- npm run smoke:preview-boundaries covers GPX / KML / KMZ / SHP actual-output byte readers with synthetic adversarial fixtures, valid 0,0, valid gx timestamps, and polygon hole ordering.
- Existing 13 browser preview scenarios are retained. A 14th real-source public Garmin eTrex GPX -> KMZ case verifies the exported gx timeline and coordinates are paired for 104 points and the actual downloaded KMZ renders the track.
- Public eTrex fixture is already checked into test-fixtures/public-gpx under Apache-2.0 provenance in the earlier P26 corpus. Its source claims are not hardware-authenticated.
- Existing all-19-route, P33 native OGR, P34 mini-batch, P37 dateline, mobile/browser, noindex and offline billing checks remain mandatory.
- After merge, P38 one-shot public CI waits for the **exact merged main SHA** to appear on Cloudflare Pages before testing the 14 live previews and 19 routes.

## Release and limitations

This is a bounded browser visualization, not a general GPX/KML XML parser, a GIS projection system, professional topology certification or a replacement for native QGIS inspection. There are no new network calls, paid APIs, database requirements or site-wide costs. The public site remains engineering-preview/noindex; optional Pancake payment remains inactive.
