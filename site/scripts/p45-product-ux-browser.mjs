/**
 * P45 actual product UX / route discoverability / repeated conversion QA.
 * Uses real Chromium + real GDAL/WASM, synthetic files, no remote GIS uploads.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {routes,FORMAT_CODES} from '../src/lib/converter-routes.mjs';
const origin=(process.env.GIS_BASE_URL||'http://127.0.0.1:8796').replace(/\/+$/,'');
const local=origin.startsWith('http://127.0.0.1:');
const outfile=local?'p45-product-ux-local.json':'p45-product-ux-live.json';
const report={kind:'p45-product-ux-real-browser',mode:local?'local':'public',origin,
 status:'FAILED',expected:7,cases:[],pageErrors:[],notes:[
  'No physical phone or human QGIS UI operation is implied by this test'
 ]};
const check=(condition,msg)=>{if(!condition)throw Error(msg)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let browser,server;
async function test(name,fn){
 const entry={name,status:'FAILED'};report.cases.push(entry);
 try{Object.assign(entry,await fn(),{status:'PASSED'});
  console.log('P45_PRODUCT '+name+' PASSED')}
 catch(e){entry.error=String(e?.stack||e).slice(0,1800);
  console.error('P45_PRODUCT '+name+' FAILED '+entry.error)}
}
function sampleKml(x,y,name){
 return {name:'p45-synthetic.kml',mimeType:'application/vnd.google-earth.kml+xml',
  buffer:Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'+
  '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>'+name+
  '</name><Point><coordinates>'+x+','+y+',0</coordinates></Point></Placemark></kml>')};
}
async function pageAt(path){
 const page=await browser.newPage({acceptDownloads:true});
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 const response=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:50000});
 check(response?.ok(),'Cannot load '+path);
 return page;
}
async function download(page,selector){
 const [d]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator(selector).click()]);
 return fs.readFileSync(await d.path());
}
try{
 if(local){
  let ready=false;try{ready=(await fetch(origin+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8796','--directory','dist'],{stdio:'ignore'});
   for(let n=0;n<80;n++){
    try{ready=(await fetch(origin+'/')).ok;if(ready)break}catch{}
    await wait(200);
   }
  }
  check(ready,'Built local Astro site not available');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await test('home_route_cards_and_directional_shapefile_search',async()=>{
  const p=await pageAt('/');
  check(await p.locator('a.tool').count()===19,'Homepage missing 19 actual tool cards');
  const filter=p.locator('#filter');
  await filter.fill('Shapefile to GeoJSON');
  check(await p.locator('a.tool:visible').count()===1,'Directional Shapefile search returned wrong count');
  check((await p.locator('a.tool:visible').getAttribute('href'))==='/converter/shp-to-geojson/',
   'Search returns reverse GeoJSON→SHP instead of requested SHP→GeoJSON');
  check((await p.locator('#result-count').innerText()).includes('1 of 19'),'Search count incorrect');
  await filter.fill('GeoJSON to SHP');
  check(await p.locator('a.tool:visible').count()===1,'Reverse format query should have one match');
  check((await p.locator('a.tool:visible').getAttribute('href'))==='/converter/geojson-to-shp/',
   'Reverse direction search incorrect');
  await filter.fill('no-such-format');
  check(await p.locator('#empty').isVisible(),'No-results state missing');
  await filter.fill('');
  check(await p.locator('a.tool:visible').count()===19,'Clearing search did not restore 19 cards');
  await p.close();
  return {keywordQueries:['Shapefile to GeoJSON','GeoJSON to SHP'],all19Restored:true};
 });
 await test('home_source_target_picker_never_opens_unsupported_route',async()=>{
  const p=await pageAt('/');
  check(await p.locator('#quick-from').inputValue()==='kml','Incorrect default source');
  check(await p.locator('#quick-to').inputValue()==='shp','Incorrect default target');
  check(await p.locator('#quick-open').getAttribute('href')==='/converter/kml-to-shp/',
   'Default quick-link not valid');
  await p.locator('#quick-from').selectOption('csv');
  check(await p.locator('#quick-to').inputValue()==='kml','Unsupported CSV→SHP was not corrected');
  check(await p.locator('#quick-to option[value="shp"]').isDisabled(),
   'CSV→Shapefile should not be advertised');
  check(await p.locator('#quick-open').getAttribute('href')==='/converter/csv-to-kml/',
   'Valid CSV→KML route not selected');
  await p.locator('#quick-from').selectOption('shp');
  await p.locator('#quick-to').selectOption('geojson');
  check(await p.locator('#quick-open').getAttribute('href')==='/converter/shp-to-geojson/',
   'Shapefile source/destination picker pointed to wrong route');
  await p.locator('#quick-open').click();
  await p.waitForURL('**/converter/shp-to-geojson/');
  check(await p.locator('#switch-from').inputValue()==='shp',
   'Target converter not correctly initialized');
  await p.close();return {unsupportedPairDisabled:true,onlyRealLinks:true,realNavigation:true};
 });
 await test('all_19_pages_have_complete_route_picker_and_precise_input_requirements',async()=>{
  const p=await pageAt('/');
  for(const [slug,src,dst] of routes){
   const r=await p.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:40000});
   check(r?.ok(),'Broken route '+slug);
   check(await p.locator('#switch-from').inputValue()===src,
    'Source picker misconfigured on '+slug);
   check(await p.locator('#switch-to').inputValue()===dst,
    'Target picker misconfigured on '+slug);
   check(await p.locator('#switch-open').getAttribute('href')==='/converter/'+slug+'/',
    'Converter switcher link is wrong on '+slug);
   check(await p.locator('#file-info').innerText()!=='','Missing format preparation note '+slug);
   check(await p.locator('.route-guide .faq-entry').count()===2,
    'Missing practical FAQ on '+slug);
   check(await p.locator('#convert-again').count()===1,'Missing repeat conversion CTA '+slug);
   check(await p.locator('meta[name="robots"]').getAttribute('content')==='noindex,nofollow',
    'P45 unintentionally activated SEO on '+slug);
  }
  await p.close();return {pagesVerified:routes.length,seo:'noindex,nofollow'};
 });
 await test('converter_switch_is_explicit_and_does_not_silently_move_file',async()=>{
  const p=await pageAt('/converter/kml-to-geojson/');
  await p.locator('#file').setInputFiles(sampleKml(116.4,39.9,'Keep'));
  const original=await p.locator('#file').evaluate(e=>e.files[0]?.name);
  await p.locator('#switch-from').selectOption('csv');
  check(await p.locator('#switch-to').inputValue()==='kml','Invalid CSV→GeoJSON not corrected');
  check(await p.locator('#switch-open').getAttribute('href')==='/converter/csv-to-kml/',
   'Switch link points to invalid route');
  check(await p.locator('#file').evaluate(e=>e.files[0]?.name)===original,
   'Changing target selection discarded the selected local file');
  check(await p.locator('#result').isHidden(),'Switching route options started a conversion');
  await p.locator('#switch-open').click();
  await p.waitForURL('**/converter/csv-to-kml/');
  check(await p.locator('#file').evaluate(e=>e.files.length)===0,
   'New converter unexpectedly retained old file or uploaded file');
  await p.close();return {noAutomaticUpload:true,explicitNavigation:true};
 });
 await test('real_GDAL_download_report_and_convert_another_cleans_private_blobs',async()=>{
  const p=await browser.newPage({acceptDownloads:true});
  p.on('pageerror',e=>report.pageErrors.push(String(e)));
  await p.addInitScript(()=>{
   const revoke=URL.revokeObjectURL.bind(URL);
   window.__p45Revoked=[];
   URL.revokeObjectURL=url=>{window.__p45Revoked.push(url);return revoke(url)};
  });
  await p.goto(origin+'/converter/kml-to-geojson/');
  await p.locator('#file').setInputFiles(sampleKml(116.4,39.9,'First'));
  await p.locator('#submit').click();
  try{await p.locator('#result').waitFor({state:'visible',timeout:125000})}
  catch{throw Error('Real GDAL first convert failed: '+await p.locator('#error').textContent())}
  const json=JSON.parse((await download(p,'#download')).toString('utf8'));
  check(Math.abs(json.features[0].geometry.coordinates[0]-116.4)<.0001,
   'First conversion lost point coordinates');
  const quality=JSON.parse((await download(p,'#quality-download')).toString('utf8'));
  check(quality.checks.some(c=>c.id==='point-coordinate-values'&&c.status==='pass'),
   'Independent quality check missing on first real conversion');
  const urls=await p.evaluate(()=>({
   download:document.querySelector('#download').href,
   quality:document.querySelector('#quality-download').href
  }));
  check(urls.download.startsWith('blob:')&&urls.quality.startsWith('blob:'),
   'Expected output and report Blob links missing');
  await p.locator('#convert-again').click();
  check(await p.locator('#file').evaluate(e=>e.files.length)===0,'New conversion action did not clear old file');
  check(await p.locator('#result').isHidden(),'New conversion action kept old result visible');
  check(await p.locator('#download').getAttribute('href')===null,'Old output URL still available');
  check(await p.locator('#quality-download').getAttribute('href')===null,'Old quality URL still available');
  const revoked=await p.evaluate(()=>window.__p45Revoked);
  check(revoked.includes(urls.download)&&revoked.includes(urls.quality),
   'Old local GIS URLs were not revoked');
  check(await p.evaluate(()=>document.activeElement.id)==='file',
   'Convert another file did not return keyboard focus to input');
  await p.locator('#file').setInputFiles(sampleKml(114.1,22.5,'Second'));
  await p.locator('#submit').click();
  try{await p.locator('#result').waitFor({state:'visible',timeout:125000})}
  catch{throw Error('Real GDAL retry failed: '+await p.locator('#error').textContent())}
  const retry=JSON.parse((await download(p,'#download')).toString('utf8'));
  check(Math.abs(retry.features[0].geometry.coordinates[0]-114.1)<.0001,
   'Repeat conversion returned previous data rather than new input');
  await p.close();
  return {firstAndSecondRealWasm:true,bothReportsSafelyManaged:true,
   privateBlobUrlsRevoked:true,keyboardFocusRestored:true};
 });
 await test('mobile_home_and_converter_find_route_without_horizontal_scroll',async()=>{
  const p=await browser.newPage({viewport:{width:360,height:780},isMobile:true,hasTouch:true});
  p.on('pageerror',e=>report.pageErrors.push(String(e)));
  await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
  check((await p.evaluate(()=>document.documentElement.scrollWidth))<=361,
   'New homepage route finder overflows 360px mobile viewport');
  check(await p.locator('#quick-open').isVisible(),'Quick route CTA missing at mobile width');
  await p.locator('#quick-from').selectOption('gpx');
  check(await p.locator('#quick-to').inputValue()==='kml',
   'GPX to KML should be offered first on touch viewport');
  await p.locator('#quick-open').click();
  await p.waitForURL('**/converter/gpx-to-kml/');
  check((await p.evaluate(()=>document.documentElement.scrollWidth))<=361,
   'New converter route switcher overflows 360px mobile viewport');
  check(await p.locator('#switch-open').isVisible(),
   'Converter route-switcher CTA not visible on touch viewport');
  await p.close();return {mobileWidthPx:360,homeAndConverterNoOverflow:true};
 });
 await test('javascript_disabled_still_has_19_real_route_links',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false});
  const p=await context.newPage();
  await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
  check(await p.locator('a.tool').count()===19,'JavaScript-free homepage lost route links');
  check(await p.locator('#quick-open').getAttribute('href')==='/converter/kml-to-shp/',
   'JavaScript-free quick link no longer opens a valid route');
  await p.locator('a.tool[href="/converter/geojson-to-shp/"]').click();
  await p.waitForURL('**/converter/geojson-to-shp/');
  check(await p.locator('#switch-open').getAttribute('href')==='/converter/geojson-to-shp/',
   'JavaScript-free converter fallback link wrong');
  await context.close();return {noJavascriptRealLinks:true};
 });
 report.status=report.cases.length===7&&report.cases.every(c=>c.status==='PASSED')&&
  report.pageErrors.length===0?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2000)}
finally{
 fs.writeFileSync(outfile,JSON.stringify(report,null,2));
 console.log('P45_PRODUCT_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.cases.filter(c=>c.status==='PASSED').length,
  expected:7,failed:report.cases.filter(c=>c.status!=='PASSED').map(c=>c.name),
  pageErrors:report.pageErrors,fatal:report.fatal
 }));
 await browser?.close();server?.kill();
}
if(report.status!=='PASSED')process.exitCode=1;
