/**
 * P31: mobile/keyboard UX, private Blob download lifecycle, oversized input
 * rejection, invalid-GIS recovery. Same Chromium QA can be used locally or
 * on the real public Cloudflare Pages URL. No private or user files.
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const outputFile=process.env.GIS_BASE_URL?.startsWith('http://127.0.0.1:')?
 'p31-mobile-local-results.json':'p31-mobile-live-results.json';
const report={kind:'p31-mobile-keyboard-lifecycle',origin,
 status:'FAILED',startedAt:new Date().toISOString(),cases:[],browserErrors:[],networkFailures:[]};
const kml=(lon,lat,name)=>'<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>'+name+
 '</name><Point><coordinates>'+lon+','+lat+',0</coordinates></Point></Placemark></Document></kml>';
const fixture=(content,name='valid.kml')=>({name,mimeType:'application/vnd.google-earth.kml+xml',
 buffer:Buffer.from(content)});
function assert(ok,message){if(!ok)throw Error(message)}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function waitForOutput(page){
 await page.locator('#result').waitFor({state:'visible',timeout:100000});
 assert(await page.locator('#download').getAttribute('href')!==null,'Download href missing after conversion');
 assert(await page.locator('#quality').isVisible(),'Quality review missing after conversion');
}
async function download(page,selector){
 const [d]=await Promise.all([page.waitForEvent('download',{timeout:15000}),
  page.locator(selector).click()]);
 return {name:d.suggestedFilename(),bytes:fs.readFileSync(await d.path())};
}
async function test(name,fn){
 const entry={name,status:'FAILED',startedAt:new Date().toISOString()};report.cases.push(entry);
 try{
  const props=await fn();Object.assign(entry,props,{status:'PASSED'});
  console.log('P31_UX '+name+' PASSED');
 }catch(e){
  entry.error=String(e?.stack||e).slice(0,2400);
  console.error('P31_UX '+name+' FAILED '+entry.error);
 }
}
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 // 320 px is a particularly narrow viewport: verify real page layout,
 // focus and the noindex preview without assuming mobile hardware tests.
 await test('320_360_390_768_mobile_viewports_no_horizontal_overflow',async()=>{
  const widths=[320,360,390,768],results=[];
  for(const width of widths){
   const context=await browser.newContext({viewport:{width,height:740},isMobile:true,deviceScaleFactor:2});
   const page=await context.newPage();
   page.on('pageerror',e=>report.browserErrors.push(String(e)));
   for(const pathname of ['/','/converter/kml-to-geojson/','/converter/gpx-to-kmz/']){
    const r=await page.goto(origin+pathname,{waitUntil:'domcontentloaded',timeout:45000});
    assert(r?.ok(),'HTTP navigation failure '+pathname);
    const box=await page.evaluate(()=>({viewport:window.innerWidth,
      documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
    assert(box.documentWidth<=box.viewport+2&&box.bodyWidth<=box.viewport+2,
      'Horizontal mobile overflow '+pathname+' '+JSON.stringify(box));
    assert((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow',
      'Preview indexing guard disappeared');
    assert(await page.locator('a.skip-link').count()===1,'No keyboard skip link');
    results.push({viewport:width,path:pathname,overflow:false});
   }
   await context.close();
  }
  return {checked:results.length,viewports:widths,layout:'no horizontal overflow in Chromium emulation'};
 });
 await test('keyboard_accessible_navigation_and_focus_after_real_conversion',async()=>{
  const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push(String(e)));
  await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded'});
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>document.activeElement?.classList.contains('skip-link')),
   'First keyboard Tab must focus visible skip link');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(()=>location.hash)==='#main-content',
   'Skip link should target main conversion content');
  assert(await page.locator('#file').getAttribute('aria-describedby')==='file-info',
   'File selector is not associated with file requirements');
  await page.locator('#file').setInputFiles(fixture(kml(116.4,39.9,'Keyboard')));
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await waitForOutput(page);
  assert(await page.evaluate(()=>document.activeElement?.id)==='result',
   'Keyboard focus was not moved to newly visible conversion result');
  const data=await download(page,'#download'),json=JSON.parse(data.bytes.toString('utf8'));
  assert(json.features?.length===1,'Incorrect downloaded GeoJSON output');
  assert(Math.abs(json.features[0].geometry.coordinates[0]-116.4)<.00001,'Incorrect downloaded coordinates');
  const quality=await download(page,'#quality-download');
  const reportJson=JSON.parse(quality.bytes.toString('utf8'));
  assert(reportJson.kind==='local-structural-quality-report','Quality JSON invalid');
  await context.close();
  return {outputSha256:sha(data.bytes),qualityDownload:true,
    afterKeyboardSubmitFocus:'result',skipLinkWorks:true,downloadBytes:data.bytes.length};
 });
 await test('source_replacement_revokes_stale_download_before_oversize_validation_and_recovers',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},
    isMobile:true,deviceScaleFactor:2,hasTouch:true,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push(String(e)));
  await page.addInitScript(()=>{
   const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
   window.__p31Urls={created:[],revoked:[]};
   URL.createObjectURL=(blob)=>{const url=create(blob);window.__p31Urls.created.push(url);return url};
   URL.revokeObjectURL=(url)=>{window.__p31Urls.revoked.push(url);return revoke(url)};
   const WorkerOriginal=window.Worker;
   window.__p31WorkerStarts=0;
   window.Worker=class extends WorkerOriginal{
    constructor(...args){super(...args);window.__p31WorkerStarts++}
   };
  });
  await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded'});
  await page.locator('#file').setInputFiles(fixture(kml(116.4,39.9,'First')));
  await page.locator('#submit').click();
  await waitForOutput(page);
  const oldUrls=await page.evaluate(()=>({
   download:document.querySelector('#download').href,
   quality:document.querySelector('#quality-download').href,
   workers:window.__p31WorkerStarts
  }));
  assert(oldUrls.download.startsWith('blob:')&&oldUrls.quality.startsWith('blob:'),
   'First valid conversion did not create two Blob URLs');
  const oversized={name:'too-large.kml',mimeType:'application/vnd.google-earth.kml+xml',
   buffer:Buffer.alloc(15*1024*1024+1,32)};
  await page.locator('#file').setInputFiles(oversized);
  assert(await page.locator('#result').isHidden(),'Old conversion result still shown after choosing a different file');
  assert(await page.locator('#quality').isHidden(),'Old quality report still visible after choosing a different file');
  assert((await page.locator('#download').getAttribute('href'))===null,'Stale file download URL still present');
  assert((await page.locator('#quality-download').getAttribute('href'))===null,'Stale quality download URL still present');
  const urls=await page.evaluate(()=>window.__p31Urls);
  assert(urls.revoked.includes(oldUrls.download)&&urls.revoked.includes(oldUrls.quality),
   'Old download and quality Blob URLs were not revoked');
  assert(await page.locator('#error').isVisible(),'Too-large file selection not explained');
  await page.locator('#submit').click();
  assert(await page.locator('#result').isHidden(),'Oversized submit showed old download result');
  assert((await page.locator('#error').textContent()).includes('15 MiB'),
   'Oversized upload not rejected with a readable limit');
  const afterBad=await page.evaluate(()=>window.__p31WorkerStarts);
  assert(afterBad===oldUrls.workers,'Oversized file incorrectly started a Web Worker');
  await page.locator('#file').setInputFiles(fixture(kml(114.1,22.5,'Second'),'second.kml'));
  assert(await page.locator('#error').isHidden(),'Old oversize error persisted after choosing a new file');
  await page.locator('#submit').click();
  await waitForOutput(page);
  const downloaded=await download(page,'#download');
  const data=JSON.parse(downloaded.bytes.toString('utf8')),p=data.features?.[0]?.geometry?.coordinates;
  assert(Math.abs(p?.[0]-114.1)<.00001&&Math.abs(p?.[1]-22.5)<.00001,
   'Retry file downloaded the previous coordinates rather than newly selected file');
  assert(await page.evaluate(()=>window.__p31WorkerStarts)===oldUrls.workers+1,
   'Retry must use one fresh worker');
  await context.close();
  return {oldFileBlobRevoked:true,qualityBlobRevoked:true,
    tooLargeRejectedWithoutWorker:true,retrySha256:sha(downloaded.bytes),
    newCoordinatesVerified:true};
 });
 await test('invalid_input_error_has_no_artifact_then_valid_retry',async()=>{
  const context=await browser.newContext({viewport:{width:360,height:780},
    acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push(String(e)));
  await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded'});
  await page.locator('#file').setInputFiles(fixture('this is not valid KML XML','broken.kml'));
  await page.locator('#submit').click();
  await page.waitForFunction(()=>document.querySelector('#error')?.hidden===false,
   {timeout:60000});
  assert(await page.locator('#result').isHidden(),'Malformed input unexpectedly exposed a download');
  assert((await page.locator('#download').getAttribute('href'))===null,'Failure left a stale download URL');
  assert(await page.locator('#submit').isEnabled(),'Submission must be recoverable after failed conversion');
  await page.locator('#file').setInputFiles(fixture(kml(116.4,39.9,'Recovered')));
  assert(await page.locator('#error').isHidden(),'Old error not cleared when input changed');
  await page.locator('#submit').click();
  await waitForOutput(page);
  const dl=await download(page,'#download');
  assert(JSON.parse(dl.bytes.toString('utf8')).features?.length===1,'Retry downloaded invalid output');
  await context.close();
  return {failureRecoveredWithoutReload:true,afterFailureNoDownload:true};
 });
 assert(report.browserErrors.length===0,'Uncaught browser errors '+JSON.stringify(report.browserErrors));
 report.passed=report.cases.filter(c=>c.status==='PASSED').length;
 report.failed=report.cases.filter(c=>c.status!=='PASSED').map(c=>c.name);
 assert(report.passed===report.cases.length&&report.cases.length===4,
  'Mobile/keyboard lifecycle failures '+report.failed);
 report.status='PASSED';
}catch(e){
 report.fatal=String(e?.stack||e).slice(0,2400);
}finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(outputFile,JSON.stringify(report,null,2));
 console.log('P31_UX_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.passed,failed:report.failed,
  errors:report.browserErrors,fatal:report.fatal}));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
