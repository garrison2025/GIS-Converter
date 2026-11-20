/**
 * P52 regression: keep complete GIS/browser verification while making
 * superseded dev pushes cancelable. No network, user data or writes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync('../.github/workflows/'+name,'utf8');
const hosted=read('hosted-validation.yml');
const p50=read('p50-public-cross-attributes.yml');
const p51=read('p51-public-complex-attributes.yml');
const p52=read('p52-public-ci-stability.yml');
const pin=JSON.parse(fs.readFileSync('package.json','utf8')).devDependencies.playwright;
assert.equal(pin,'1.57.0','Update browser cache keys when Playwright changes');
const cacheKey='gis-pw-all-${{ runner.os }}-${{ runner.arch }}-ubuntu24.04-v'+pin;
for(const [name,w] of [['hosted',hosted],['p50',p50],['p51',p51],['p52',p52]]){
 assert.match(w,/runs-on: ubuntu-24\.04/,name+' runner must stay pinned');
 assert(w.includes('key: '+cacheKey),name+' wrong cache version/platform');
 assert(w.includes('path: ~/.cache/ms-playwright'),name+' browser cache path absent');
 assert(w.includes('npx playwright install --with-deps chromium firefox webkit'),
  name+' removes required Chromium Firefox or WebKit');
 assert.match(w,/actions\/cache@v4/,name+' omits cache action');
}
assert(hosted.includes("group: gis-hosted-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}"),
 'Keep one dev lane per ref, unique main SHA lane');
assert(hosted.includes("cancel-in-progress: ${{ github.ref != 'refs/heads/main' && github.event_name == 'push' }}"),
 'Only superseded dev push runs may be canceled, never main');
for(const command of [
 'npm run smoke:ci-policy','npm run smoke:complex-attr-browser',
 'npm run smoke:crossbrowser-local','npm run smoke:all-ui','npm run smoke:polygon-stress'
])assert(hosted.includes('run: '+command),'Hosted regression missing '+command);
for(const [name,w] of [['p50',p50],['p51',p51],['p52',p52]]){
 for(const required of [
 'GIS_EXPECTED_COMMIT: ${{ github.sha }}',
 'GIS_EXPECTED_BRANCH: main',
 'run: npm run smoke:live-release',
 'run: npm run smoke:preview-live',
 'run: node scripts/live-all-routes.mjs',
 'branches: [main]'
 ])assert(w.includes(required),name+' public acceptance missing '+required);
}
for(const command of [
 'npm run smoke:ci-policy','npm run smoke:cross-attributes',
 'npm run smoke:complex-attributes','npm run smoke:complex-attr-browser'
])assert(p52.includes('run: '+command),'P52 public acceptance omits '+command);
const p43=fs.readFileSync('scripts/p43-mobile-resilience.mjs','utf8');
assert(p43.includes("await browser.close();\n browser=null;\n await run('webkit_touch_mobile_manual_low_memory_download'"),
 'Release Chromium process before independently measuring WebKit mobile low-memory conversion');
assert(!p52.includes('wrangler pages deploy'),'Acceptance must not deploy or activate SEO');
console.log('P52_CI_POLICY PASSED: latest dev push wins, main never auto-canceled, cached browsers version-pinned, three engines and all 19 public routes/previews preserved');
