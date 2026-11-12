# GIS Converter P27 — public deployment identity and acceptance

## Scope and independent observation

P27 keeps the GIS Converter at **engineering-preview / noindex**; it does not enable production payments, user accounts, display ads or search indexing.

On 2026-11-12, an independent public fetch of https://gis-converter.pages.dev/ found 19 converter links, a live homepage with noindex,nofollow, and a robots.txt with Disallow: /. The sitemap-index.xml path returned homepage content instead of a sitemap. Because a public build SHA was unavailable, GitHub main success could not prove exactly what commit was deployed.

## Public release fingerprint

The final Cloudflare packaging command (npm run build:pages, from the site directory) now creates the static JSON file at:

**https://gis-converter.pages.dev/release.json**

It contains only schemaVersion, site, commit, branch, buildProvider, builtAt, phase, indexing and converterRoutes. No Cloudflare account IDs, private env vars, payment secrets or user data are exposed.

Cloudflare Pages supplies CF_PAGES_COMMIT_SHA and CF_PAGES_BRANCH during Git-connected builds; GitHub Actions uses GITHUB_SHA / GITHUB_REF_NAME, otherwise Git is queried locally. Invalid or unavailable 40-character source SHA prevents releasing a falsely attributed Pages bundle.

Do not treat an HTML fallback at /release.json as a genuine release report. If the release file does not match the selected GitHub main SHA, live deployment remains unverified.

## Existing Cloudflare Pages project settings to inspect

| Setting | Expected |
| --- | --- |
| Repository | garrison2025/GIS-Converter |
| Production branch | main |
| Root directory | site |
| Build command | npm run build:pages |
| Build output directory | dist |
| Production auto-deploy | Enabled if the project is meant to follow main |

Do not create a new Pages project, change DNS or activate billing only to check a source SHA. The GitHub hosted-validation workflow is a build/test pipeline, **not** a Cloudflare deployment.

## Independent validation flow

1. Merge the P27 pull request after the full GitHub CI succeeds. The new static release gate validates the built SHA, robots.txt, X-Robots-Tag, the homepage and all 19 converter HTML pages, plus removal of the oversized raw WASM.
2. Confirm the existing Cloudflare Pages production deployment has consumed this main commit. Open /release.json to compare the full 40-character commit SHA.
3. In GitHub **Actions**, run **GIS Converter P27 public Pages release & live conversion verification (manual, no deploy)** from branch main. Use the default pages.dev site URL and leave expected_commit blank to compare with the selected main revision.
4. The manual workflow reads live release.json and the production noindex settings; only after it matches does it execute Chromium real-file upload/download tests. Optionally set full_conversion_matrix=true to run all 19 live routes.
5. Inspect the uploaded live-release-gate.json and live-pages-qa.json test evidence. Only claim that the public site is verified if this flow passes against the intended deployed SHA.

Local build commands from site directory: npm run build:pages && npm run smoke:release.
Manual existing live site check: GIS_EXPECTED_COMMIT=FULL_GIT_SHA npm run smoke:live-release.

## Outstanding release gates (not certified by GitHub CI)

- Google Earth Pro actual desktop playback of gx:Track.
- Actual Garmin/Apple Watch/Suunto device exports and mobile Safari/Android hardware memory behavior.
- Real user GPS/GIS file conversion expectations and independent CRS/attribute inspection.
- Formal custom-domain SEO launch: canonical URLs, sitemap, indexed robots, privacy/terms, Search Console validation and original useful content on 19 routes.
- Live Pancake/Waffo billing integration, if later needed for optional SaaS. It is not active in P27.

Keep the existing noindex/robots protections until the domain, SEO and public production acceptance are explicitly approved. Cloudflare's injected build variables are documented at https://developers.cloudflare.com/pages/configuration/build-configuration/.
