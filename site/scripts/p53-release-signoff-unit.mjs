/**
 * P53 automatic-vs-manual release evidence policy. Read-only, synthetic fixtures.
 * Automated QGIS Qt and Playwright devices cannot self-certify human checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const qgis=read('scripts/p43-qgis-qt-gui.py');
const fixtures=read('scripts/p43-browser-qgis-fixtures.mjs');
const mobile=read('scripts/p43-mobile-resilience.mjs');
const workflow=read('../.github/workflows/p53-qgis-release-acceptance.yml');
const manual=read('P53_RELEASE_SIGNOFF.md');
for(const f of ['p53-browser-survey-lines.kml',
 'p53-browser-survey-lines-roundtrip.geojson']){
 assert(fixtures.includes(f),'Browser must generate real GIS fixture '+f);
 assert(qgis.includes(f),'Installed QGIS must actually open fixture '+f);
}
for(const item of ['Survey east','Survey west','R-A01','R-B02',
 'QGIS_gui_real_KML_and_roundtrip_line_vertices_attributes',
 'colored>=15','vertices=[(v.x(),v.y()) for v in geom.vertices()]']){
 assert(qgis.includes(item),'QGIS independent geometry/field check missing '+item);
}
assert(qgis.includes("'manualQgisInteraction': 'NOT_TESTED'"),
 'Automated QGIS Qt must never declare a real human desktop test passed');
assert(qgis.includes("'physicalDevice': 'NOT_TESTED'"),
 'Automated Qt cannot declare physical phone testing passed');
assert(mobile.includes("physicalDevice:'NOT_TESTED'"),
 'Playwright device simulation cannot be called a physical test');
for(const s of ['qgis python3-qgis gdal-bin xvfb',
 'QT_QPA_PLATFORM: offscreen','smoke:qgis-browser-fixtures',
 'p43-qgis-qt-gui.py','smoke:mobile-resilience',
 'GIS_EXPECTED_COMMIT:','smoke:live-release',
 'node scripts/live-all-routes.mjs','smoke:preview-live',
 'site/.p53-qgis-release-public-acceptance']){
 assert(workflow.includes(s),'P53 workflow omits '+s);
}
assert(workflow.includes('run: npm run smoke:release-signoff'),
 'P53 CI must enforce release evidence boundary');
assert(workflow.includes('branches:')&&workflow.includes('main'),
 'P53 missing main exact SHA public acceptance');
assert(!workflow.includes('wrangler pages deploy'),
 'P53 cannot deploy, enable payments or activate SEO');
for(const s of ['QGIS 手动操作','真实手机','Release 判定','NOT_TESTED']){
 assert(manual.includes(s),'Manual signoff not documented: '+s);
}
console.log('P53_SIGNOFF_POLICY PASSED: QGIS layer/attributes/Qt screenshots require real outputs; manual desktop and physical phone remain NOT_TESTED');
