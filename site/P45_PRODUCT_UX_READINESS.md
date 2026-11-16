# P45 — GIS Converter product readiness, discovery and repeat-conversion UX

## Product baseline and decision
At P44 the engineering-preview site had 19 client-side GDAL/WASM
conversion routes, independent quality reports, safe file guards, browser
tests and automated Qt QGIS interoperability. This **does not** imply
professional topology certification, physical low-memory phone acceptance,
human-operated QGIS desktop GUI acceptance or production SEO readiness.

P45 addresses the **first-time user journey** without adding more unsupported
GIS format routes:

- Landing page: a user had to scan 19 cards or guess keywords to find a
  route; searches for *Shapefile to GeoJSON* could also surface the reverse
  direction.
- Converter pages: source/destination could only be changed by returning to
  the homepage or hunting through the related-link list near the footer.
- Post-conversion: rerunning the same file was easy, but starting another
  file did not have an obvious dedicated action that cleared stale downloads.

## Improvements implemented

### 1. One authoritative lightweight route catalog
`site/src/lib/converter-routes.mjs` is shared by the GDAL route engine,
the Astro page generator and the browser route picker, without importing
JSZip or GDAL into the homepage for simple navigation. It contains the same
**19 real pairs**; no SHP→GPX, CSV→SHP or other unimplemented URL is implied.

The original `gdal-matrix.mjs` still exports `routes` for backwards
compatibility. All existing converter URLs and server-side SEO behavior
remain unchanged.

### 2. Direct, accessible format selection
The homepage now provides source + output selectors, a link to the exact
matching converter, and a status message about supported destinations.
Unsupported outputs are disabled, and changing source chooses the first
available destination when the old choice is invalid. Navigation occurs
only when the user explicitly follows the link.

Each of the 19 converter pages offers the same switcher in the sidebar,
with a near-top link to it. Changing dropdowns does **not** automatically
upload, convert, discard a selected local file or change pages.
The user is told that switching pages does not transfer local files.

Native labels, focus rings and keyboard-selectable controls remain
available; without JavaScript all 19 card links and the initial switch
link still navigate to valid, pre-rendered pages.

### 3. Directional, alias-aware discovery
The homepage search now indexes full names such as **ESRI Shapefile**,
common short names and official format descriptions. A query with a
direction marker `to` matches input text **only on the left** and
output text **only on the right**. Thus:

- `Shapefile to GeoJSON` → `shp-to-geojson` only.
- `GeoJSON to SHP` → `geojson-to-shp` only.
- `KMZ to SHP` → `kmz-to-shp` only.

Independent keywords still filter non-directionally. The page shows a live
`Showing N of 19 converter routes` count and an honest empty state.

### 4. Repeat conversion safely
Successful results now show a **Convert another file** button plus a clear
instruction to download the existing output and JSON inspection report
first. Choosing it revokes both private Blob object URLs, clears the
input picker, hides the old result and report, resets status, and returns
keyboard focus to the file control. It creates no conversion until the
user chooses a new file and presses Convert again.

Existing cancellation, integrity-loss blocking, P44 repair guidance and
P42 memory-saving behaviors are unchanged.

## Scope of automated acceptance

`npm run smoke:route-catalog`: 19 distinct real route slugs; all 36
potential source→destination pairs checked for correct supported
status; all 19 practical route guides contain preparation, output,
verification, limitation and two FAQs. GDAL and UI catalogs must agree.

`npm run smoke:product-ux`: seven real Chromium browser journeys:
directional home search; source/target selection with disabled unsupported
pairs; complete route picker and static help on all 19 tool pages;
explicit switching without accidental file carryover; actual GDAL/WASM
conversion, downloaded GeoJSON and quality report, previous object-URL
revocation, keyboard focus and subsequent real conversion of a second
file; 360px touch viewport overflow check; and usable static navigation
when JavaScript is disabled.

The P45 exact merged-main Cloudflare acceptance additionally re-runs all
19 actual GIS upload/download routes and 19 independent previews and
quality reports on the **attested deployed SHA**. This suite is additive
and does not replace P29/P31/P34/P35/P42/P43/P44 compatibility and security
checks.

## Product readiness classification

| Area | Engineering-preview state | Remaining limitation |
| --- | --- | --- |
| Discovery/navigation | 19 supported links, pair selector, search and source-specific guidance | Outside manual user study remains unverified |
| Core conversion | Real browser GDAL/WASM; 19 routes; separate Worker; local downloads | Complex format/CRS/attribute equivalence cannot be universally guaranteed |
| Quality and recovery | Independent bounded checks, explicit rejection, 21 P44 error categories | No automatic geometry/CRS repair; independent GIS inspection required |
| Memory | Optional saver, real simulated-mobile stress and safe retry | Actual 1–2 GiB Android/iPhone hardware untested |
| Interoperability | Real installed QGIS Qt automated layer and map canvas validation | Human-operated complete QGIS GUI workflows untested |
| Privacy | Browser-local input, private local Blob output and no file server | Users still control downloaded artifacts on their own device |
| SEO | 20-page production build rehearsal exists | Current public preview intentionally `noindex`, `robots.txt Disallow: /`, no verified production domain or Search Console setup |
| Billing | Pancake/Waffo selected for possible future product | No paid checkout, subscriptions or user database activated |

**Production launch recommendation:** Not an unconditional GO. The new UX can
ship to the current private engineering preview if its full hosted CI and
exact-SHA public acceptance pass. Separately approve custom domain/SEO
activation and collect real-device/QGIS manual acceptance evidence before
asserting that the product is production-ready for broad public use.

No paid API, database, external GIS tile service or server-side upload is
introduced by P45. Existing local-file and security boundaries remain.
