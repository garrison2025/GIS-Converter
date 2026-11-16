# P48 — strict DBF attribute precision and multilingual field integrity

## Verified engineering issue

P47 fully passed real browser conversion and polygon-hole tests, but the
independent DBF attribute fidelity checks still used a relative numeric
tolerance `max(1e-10, abs(value)*1e-12)`. For an original, independently
comparable **3,000,000,000,000**, that allowed an absolute mismatch of **3**:
a silently changed integer value **2,999,999,999,999** could be incorrectly
marked as *pass*. The same threshold could miss sub-nanounit decimal
differences in other safely representable numeric fields.

That is a genuine correctness flaw in output quality **certification**,
not proof that the GDAL engine routinely alters all such values.

## Fix

- The independent GeoJSON→Shapefile DBF comparator and reverse
  Shapefile→GeoJSON comparator now require exact numeric equality for
  values already deemed safely comparable. Integers must be JS safe
  integers and real numbers are limited by the existing 15-significant
  decimal-digit comparability policy. Unsupported/unsafe values remain
  `unavailable`, not falsely certified or coerced.
- Both attribute comparison directions now decode DBF field descriptor
  names using strict UTF-8 **only after** verifying the paired
  `.cpg` indicates UTF-8. They can independently compare short
  normalized Chinese and accented field names that fit the
  **10 UTF-8 byte** Shapefile field-name bound. Long, ambiguous or
  ill-encoded names remain unverified, not guessed.
- A field name known to be comparable but absent, or a truly changed
  numeric/string value, produces `review` in the downloadable
  `dbf-attribute-values` or `shp-geojson-attributes` check. The
  existing critical `DATA_LOSS` gate then withholds the converted output.
  The P44 safe error-recovery panel explains the rejection.
- A local sidebar note on Shapefile converter routes explains DBF
  field-name byte restrictions, UTF-8 sidecars, null/unsupported
  values, independent verification, and preserving the original
  GeoJSON where DBF cannot represent all attributes.

## Precision boundaries

Exact comparison applies **only when source and output values can be
safely interpreted under a verified UTF-8 DBF schema**. It is not a
blanket claim that GDAL or JavaScript can exactly represent
arbitrary-precision decimals, >2^53-1 integer values, nulls, custom
nested properties, legacy encodings or every Unicode field name.
The existing risk checks (`shp-field-limits`,
`shp-value-limits`) still communicate schema truncation, 10-byte
collisions, nulls, oversized strings and unsafe integer risks.
The quality report exposes **counts and status only**, not raw file
paths, private attribute names, values or source coordinates.

## Acceptance

- `npm run smoke:dbf-precision` constructs genuine DBF bytes, UTF-8
  `.cpg` ZIP components and synthetic GeoJSON input independently;
  proves valid short Chinese and accented fields match in **both**
  directions, while a one-unit change in a three-trillion safe integer,
  a one-trillionth-scale decimal change, changed Unicode strings
  and renamed short CJK columns are all detected. Confirms
  `DATA_LOSS` blocking, null/unverifiable names and CP1252 limits.
- `npm run smoke:attribute-browser` runs actual user-facing
  GDAL/WASM conversion on synthetic Unicode attribute GeoJSON and back
  through Shapefile, downloads real ZIP/JSON and quality report, verifies
  exact large integer values and UTF-8 bytes, checks CJK field names
  (either preserved with independent proof or safely withheld), long
  collisions/nulls/unsafe numbers (review not certified), and high-
  precision numeric data (identical output or critical data-loss block).
- All original P29–P47 baseline checks remain, including the 19 routes,
  19 previews, P43 QGIS native/Qt and P47 complex polygon samples.
  On merge, a one-shot **exact main SHA** Cloudflare workflow tests
  the actual public browser output and existing routes.

## Deployment limits

The site stays an **engineering preview**, client-side/free, with
`noindex` and `robots.txt Disallow: /`. P48 neither authorizes
production SEO nor activates Pancake/Waffo billing, backend uploads or
paid APIs. Manual full QGIS GUI and physical low-memory phone
verification still require separate evidence.
