# GIS Converter P30 — guarded SEO launch architecture

**Current state (2026-11-12):** No custom domain has been selected or supplied for this GIS project, and no index/unblock approval has been given. **The existing Cloudflare Pages preview remains `noindex,nofollow`**. P30 builds an optional and independent future SEO release *procedure*, not an actual production SEO launch. The browser conversion tools are free; optional Pancake/Waffo SaaS payment integration remains inactive.

## Build modes

| Property | Default `off` (currently deployed) | Explicit `approved` with real domain (future only) |
| --- | --- | --- |
| HTML meta robots | `noindex,nofollow` on homepage + 19 converters | `index,follow` on the 20 listed public pages |
| Canonical URLs | None (no unverified origin) | Exactly 20 self-referential absolute HTTPS URLs on the chosen custom domain |
| `robots.txt` | `Disallow: /` | `Allow: /` plus `Sitemap: https://CHOSEN_DOMAIN/sitemap.xml` |
| `sitemap.xml` | **Not published** (avoid misleading HTML fallback) | 20 absolute matching canonical URLs; no invented `lastmod` |
| `_headers` | All-site `X-Robots-Tag: noindex` | No global noindex; `/internal/*`, `/release.json`, `/engine/*` remain noindex |
| `*.pages.dev` mirrors | Noindex globally | **Host-scoped noindex header** on `gis-converter.pages.dev` and its branch preview subdomains |
| `release.json` | `phase=engineering-preview, indexing=noindex` | `phase=seo-launch, indexing=index` |
| User uploads/checkout | Browser-local, free, payment disabled | Unchanged; launch mode does not enable an API, database or paid checkout |

The Cloudflare Pages documentation supports absolute-host `_headers` rules, so static responses on its `*.pages.dev` mirror can remain noindex even when the canonical .com domain is indexed. **Those rules do not apply to Pages Function responses**. Their correctness must be independently verified after any actual custom-domain activation.

Official references:
- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

## Fail-closed activation inputs

Default uses **no custom environment values**. The only accepted launch trigger is:

```text
GIS_SEO_LAUNCH=approved
GIS_PUBLIC_ORIGIN=https://YOUR_OWNED_DOMAIN.com
```

Both must be explicitly configured in the **production build environment of the existing Cloudflare Pages project** (and not in preview builds) *after* the domain is bought, bound and tested. The `CF_PAGES_BRANCH` injected by Cloudflare must equal `main`; other branches are blocked. The hostname cannot be `pages.dev`, a reserved test domain, localhost or an IP address, and the origin must not contain credentials, a path, port, query or fragment. **Do not set the variable pair now**.

This is a build-time change; the current short Pages command remains `npm run build:pages`, root `site`, output `dist`. Cloudflare must actually rebuild and deploy the approved main commit before its live sitemap/canonicals can be certified.

### Never use the test-domain escape on Cloudflare

GitHub Actions has an isolated **non-deploying** job `seo-activation-dry-run` with:

```text
GIS_SEO_TEST_MODE=1
GIS_SEO_LAUNCH=approved
GIS_PUBLIC_ORIGIN=https://gis-launch.example
```

The reserved `.example` domain is **not a purchasable or real production domain**. It exists only to exercise the alternative static build under CI. Cloudflare build detection disables that escape, even when someone mistakenly supplies `GIS_SEO_TEST_MODE=1` to Pages. CI validates the generated canonical URLs, XML sitemap, scoped response header policy, all 20 HTML pages, release phase and invalid-domain/branch rejection logic. This output is not deployed or treated as SEO launched.

## Later production go/no-go checklist

1. **Domain ownership and authority:** choose and purchase a suitable real .com domain, compare first-year + renewal prices, select apex vs www as canonical, and verify ownership. Domain availability and registrar costs are not assumed in P30.
2. **Cloudflare DNS/custom domain:** bind and verify the custom hostname, HTTPS, TLS, www→canonical 301 redirect and 200 status on the actual homepage and all 19 converter pages. The custom redirect cannot be inferred from a build artifact.
3. **Release decision:** approve SEO indexing on that confirmed hostname. Enter the two variables above in **production**; leave `GIS_SEO_TEST_MODE` unset. Confirm `main` is the Pages production branch.
4. **Full live audit:** GitHub → Actions → **GIS Converter P30 custom-domain SEO acceptance (manual, read-only)** → Run workflow from `main`, supply the real `https://domain.com`. The job must show real `release.json` matching SHA, an XML sitemap of exactly 20 URLs, 20 self-canonical indexable pages, crawler policy, internal noindex headers, and `pages.dev` mirror noindex. Merely seeing `release.json` is not enough.
5. **Google Search Console:** create/verify the correct domain property and submit the real `https://domain.com/sitemap.xml` only after the production audit passes. Indexing and ranking are asynchronous Google decisions, not proof from CI.
6. **Independent SEO quality:** competitor-domain organic traffic verification (prefer Semrush US first), actual keyword/search intent validation, real usefulness assessment and future GSC coverage. Unique headings and FAQs do not guarantee rankings or traffic.
7. **GIS release accuracy:** keep separate gates for Google Earth Pro desktop `gx:Track` playback, actual Garmin/Apple Watch/Suunto exports, mobile Safari/Android performance, vertical datum, advanced metadata and complex datasets.

## Evidence and rollback

- Current preview CI (still noindex): `npm run build:pages && npm run smoke:release && npm run smoke:seo-prelaunch`.
- Future isolated build: separate GitHub hosted job `P30 isolated custom-domain SEO build rehearsal (never deployed)`, artifact `p30-seo-production-rehearsal.json`.
- Future read-only public custom-domain acceptance: `npm run smoke:seo-live`, artifact `p30-live-seo-acceptance.json`.
- Rollback if launch mode is incorrect: remove production `GIS_SEO_LAUNCH` (or set `off`), redeploy main, and verify preview robots/headers immediately; do not assume a previous static asset will be purged instantaneously. Inspect both the custom domain and `pages.dev` after rollback.

**No external DNS, Google Search Console, payment, advertising or user accounts were changed in P30.**
