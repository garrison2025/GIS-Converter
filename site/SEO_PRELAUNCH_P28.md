# GIS Converter P28 — 19-route SEO prelaunch quality and public conversion acceptance

## What P28 changes

P28 retains the **free browser conversion tool + optional future SaaS** product model. All 19 conversion routes remain available without accounts or payment. Noindex and blocked robots remain in place on the Pages preview because the final .com domain, canonical URLs, launch strategy and Search Console are not yet finalized.

1. Each of 19 pages includes a distinct, real GIS workflow and source file requirements, the actual output shape, a verification checklist, a common format-specific mistake, and **two route-specific FAQs**. This is practical content, not newly claimed conversion capability. A few examples: GeoJSON → SHP exposes DBF field-name limits; GPX → KML explains conditional gx:Track timing; KMZ → KML notes linked-resource loss; CSV → KMZ stresses strict WGS84 point columns.
2. Contextual links point to existing related conversion pages, not invented route destinations.
3. A separate build-time audit verifies 19 unique titles, descriptions and workflow examples, 38 unique questions, 20 HTML pages including the homepage, non-duplicated substantive content, related valid internal links and the noindex/robots launch guard. Results are in `p28-seo-prelaunch-audit.json` from the hosted-validation artifacts.
4. A **one-time main-merge public acceptance** workflow waits until `https://gis-converter.pages.dev/release.json` reports the exact merged main commit. Only then does it execute an independent public release audit, existing real Chromium upload/download tests, and the **full 19-route live conversion matrix**. This is a GitHub Actions read-only job with no Cloudflare token and no deploy. It is triggered by adding `site/.p28-live-acceptance` once.
5. On failed or unfinished public deploy, the live workflow is intentionally red. Review `p28-live-deployment-wait.json`, `live-release-gate.json`, `live-pages-qa.json` and `live-matrix-report.json` artifacts instead of claiming success.

## SEO audit categories

| Input | Existing route pages | Differentiating requirements |
| --- | ---: | --- |
| KML | 5 | GIS geometry type, style loss, GPX compatibility, CSV point restriction and KMZ assets |
| KMZ | 5 | ZIP/embedded KML structure, overlay/resource loss, GPX shape restrictions, exported CSV records |
| SHP | 3 | Required .prj, zipped .shp/.shx/.dbf, UTF-8 .cpg, CRS reprojection, KMZ output |
| GeoJSON | 2 | FeatureCollection, geometry family compatibility, DBF name/field limitations |
| GPX | 2 | Waypoint/track distinctions, valid per-point times, elevation and gx:Track |
| CSV | 2 | WGS84 numeric decimal coordinates, column aliases and strict invalid-row rejection |
| **Total** | **19** | Distinct task-specific content and FAQ, with no new fake functionality |

## Evidence versus remaining work

**Validated by P28 static CI only:** content on 19 pages, basic user education, internal link integrity, title/description uniqueness, noindex preservation. Content length/uniqueness does *not* independently prove Google ranking quality, actual keyword demand, topical authority, user satisfaction or backlinks.

**Validated by P28 live workflow only after it turns green:** actual deployed main SHA, online browser uploads/exports, and all 19 public output routes.

**Not yet validated:** Google Earth Pro desktop gx:Track playback, all real GPS device models, all GIS input shapes and metadata, physical iOS/Android devices, custom domain/canonical/sitemap, Google Search Console crawl/indexing, domain-level Semrush competitors, nonbrand keyword distribution, backlink strategy.

**No premature launch:** The missing `/sitemap-index.xml` currently falls back to the homepage; it is not a valid sitemap. Do not submit it to Search Console. Create the indexable canonical URLs, production robots/sitemap and correct domain links together **after** custom-domain selection and a separate launch decision.

**Economics:** Conversion runs in the browser with Cloudflare Pages static delivery; potential ads are separate from optional paid GIS batch operations. Pancake/Waffo remains the designated eventual payment system. No live checkout, paid subscription or backend service was activated in P28.

## Where to read artifacts

- CI: `npm run smoke:seo-prelaunch` after `npm run build:pages`; output `site/p28-seo-prelaunch-audit.json`.
- One-time live: GitHub Actions → `GIS Converter P28 one-shot public Cloudflare 19-route acceptance (read-only)`; output `gis-p28-live-public-19-route-evidence` artifact.
- Future manual: GitHub Actions → `GIS Converter P27 public Pages release & live conversion verification (manual, no deploy)` from main; set full_conversion_matrix=true.
