/**
 * P32: three real browser engines (Chromium, Firefox and WebKit) plus an
 * emulated iPhone WebKit viewport. Actual user-facing GDAL/WebAssembly
 * conversions and downloads, not a mock engine or an HTML-only smoke.
 *
 * This can run on local Wrangler Pages with compressed WASM or the real
 * public Pages origin. It never uploads files to a conversion backend.
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit,devices} from 'playwright';
import JSZip from 'jszip';

const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const local=/^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
const evidencePath=process.env.GIS_CROSSBROWSER_REPORT||
  (local?'p32-crossbrowser-local-results.json':'p32-crossbrowser-live-results.json');
const report={kind:'p32-real-crossbrowser-gdal',source:local?'local-wrangler-pages':'public-cloudflare-pages',
 origin,startedAt:new Date().toISOString(),status:'FAILED',engines:[],failures:[]};
const kml=(lon,lat,title)=>'<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>'+
 title+'</name><Point><coordinates>'+lon+','+lat+',0</coordinates></Point></Placemark></Document></kml>';
const asFile=(value,name)=>({name,mimeType:'application/vnd.google-earth.kml+xml',
 buffer:Buffer.from(value)});
const csv=Buffer.from('longitude,latitude,Name\n116.4,39.9,Firefox-WebKit\n');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message)};
const browserCases=[
 {name:'Chromium desktop',browser:chromium,options:{viewport:{width:1280,height:800}}},
 {name:'Firefox desktop',browser:firefox,options:{viewport:{width:1280,height:800}}},
 {name:'WebKit desktop',browser:webkit,options:{viewport:{width:1280,height:800}}},
 {name:'WebKit emulated iPhone 13',browser:webkit,options:{...devices['iPhone 13']}}
];
async function download(page,selector,suffix){
 const [dl]=await Promise.all([page.waitForEvent('download',{timeout:20000}),
  page.locator(selector).click()]);
 assert(dl.suggestedFilename().endsWith(suffix),
  'Downloaded unexpected extension '+dl.suggestedFilename());
 const bytes=fs.readFileSync(await dl.path());
 assert(bytes.length>40,'Downloaded result is empty');
 return {name:dl.suggestedFilename(),bytes};
}
async function successfulConversion(page,fixture,route,ext){
 const nav=await page.goto(origin+'/converter/'+route+'/',{waitUntil:'domcontentloaded',timeout:45000});
 assert(nav?.ok(),'Conversion page was not available '+route);
 await page.locator('#file').setInputFiles(fixture);
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
 catch{throw Error(route+' failed: '+(await page.locator('#status').textContent())+' / '+
   (await page.locator('#error').textContent()))}
 const data=await download(page,'#download',ext);
 const quality=await download(page,'#quality-download','.json');
 const parsed=JSON.parse(quality.bytes.toString('utf8'));
 assert(parsed.kind==='local-structural-quality-report',
   'No independent local structural quality report');
 return {data,quality:parsed};
}
for(const browserCase of browserCases){
 const entry={engine:browserCase.name,status:'FAILED',browserErrors:[],
  failedResponses:[],checks:[]};
 report.engines.push(entry);
 let browser,context;
 try{
  browser=await browserCase.browser.launch({headless:true});
  context=await browser.newContext({...browserCase.options,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>entry.browserErrors.push(String(error)));
  page.on('response',r=>{
   if(r.url().startsWith(origin)&&r.status()>=400&&
     /(?:\/engine\/|\/_astro\/|\/converter\/)/.test(r.url()))
    entry.failedResponses.push({status:r.status(),url:r.url().slice(0,180)});
  });
  await page.addInitScript(()=>{
   const OriginalWorker=window.Worker;
   window.__p32Workers={created:0,terminated:0};
   window.Worker=class extends OriginalWorker{
    constructor(...args){super(...args);window.__p32Workers.created++}
    terminate(){window.__p32Workers.terminated++;return super.terminate()}
   };
   const rawCreate=URL.createObjectURL.bind(URL);
   const rawRevoke=URL.revokeObjectURL.bind(URL);
   window.__p32Blobs={created:[],revoked:[]};
   URL.createObjectURL=(data)=>{
    const value=rawCreate(data);
    window.__p32Blobs.created.push(value);
    return value;
   };
   URL.revokeObjectURL=(value)=>{
    window.__p32Blobs.revoked.push(value);
    return rawRevoke(value);
   };
  });

  const home=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:45000});
  assert(home?.ok(),'Public homepage is not accessible');
  assert(await page.locator('a.tool').count()===19,'Missing 19 conversion tool cards');
  assert((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow',
   'Engineering preview incorrectly indexable');
  const homepageBox=await page.evaluate(()=>({
    viewport:window.innerWidth,width:document.documentElement.scrollWidth}));
  assert(homepageBox.width<=homepageBox.viewport+2,
   'Homepage overflows '+JSON.stringify(homepageBox));
  const search=page.locator('#filter');
  await search.fill('kmz-to-shp');
  assert(await page.locator('a.tool:visible').count()===1,
   'Homepage accessible tool filter is not functional');
  await search.fill('');
  assert(await page.locator('a.tool:visible').count()===19,
   'Clearing tool filter did not restore all 19 routes');
  entry.checks.push('homepage-19-links-filter-mobile-layout-noindex');

  const nav=await page.goto(origin+'/converter/kml-to-geojson/',{
   waitUntil:'domcontentloaded',timeout:45000});
  assert(nav?.ok(),'KML converter is not available');
  const box=await page.evaluate(()=>({
   viewport:window.innerWidth,width:document.documentElement.scrollWidth}));
  assert(box.width<=box.viewport+2,'Converter has horizontal overflow '+JSON.stringify(box));
  assert(await page.locator('a.skip-link').count()===1,'Missing keyboard skip link');
  const describedBy=(await page.locator('#file').getAttribute('aria-describedby')||'').split(/\s+/);
  assert(describedBy.includes('file-info')&&describedBy.includes('batch-help'),
   'File selector not associated with input requirements and mini-batch limits');
  assert((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow',
   'Converter lost preview noindex');
  entry.checks.push('converter-responsive-accessible-input-noindex');

  await page.locator('#file').setInputFiles(asFile(kml(116.4,39.9,'First'),'one.kml'));
  await page.locator('#submit').click();
  try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
  catch{throw Error('First KML-to-GeoJSON conversion failed '+await page.locator('#error').textContent()+
    ' / '+await page.locator('#status').textContent())}
  assert(await page.evaluate(()=>document.activeElement?.id)==='result',
   'Result focus was not moved to newly available download');
  const first=await download(page,'#download','.geojson');
  const firstJSON=JSON.parse(first.bytes.toString('utf8'));
  assert(firstJSON.type==='FeatureCollection'&&firstJSON.features?.length===1,
   'Browser downloaded an invalid GeoJSON FeatureCollection');
  const firstCoords=firstJSON.features[0].geometry?.coordinates;
  assert(Math.abs(firstCoords[0]-116.4)<.0001&&Math.abs(firstCoords[1]-39.9)<.0001,
   'Browser GIS conversion changed the source point coordinates');
  const qa=await download(page,'#quality-download','.json');
  const quality=JSON.parse(qa.bytes.toString('utf8'));
  assert(quality.kind==='local-structural-quality-report','GIS output QA JSON invalid');
  const createdUrls=await page.evaluate(()=>({
    output:document.querySelector('#download').href,
    quality:document.querySelector('#quality-download').href,
    created:window.__p32Blobs.created.slice()
  }));
  assert(createdUrls.output.startsWith('blob:')&&createdUrls.quality.startsWith('blob:'),
   'Browser output and QA report were not downloadable Blob URLs');
  entry.checks.push('real-kml-gdal-worker-geojson-qa-blob-download');
  entry.firstDownload={bytes:first.bytes.length,sha256:sha256(first.bytes),qualityDownloaded:true};

  // Changing the file must make the previous generated result inaccessible,
  // including browsers with different Blob URL handling and download behavior.
  await page.locator('#file').setInputFiles(asFile('INVALID KML DATA','bad.kml'));
  assert(await page.locator('#result').isHidden(),'Output from previous input is still visible');
  assert((await page.locator('#download').getAttribute('href'))===null,
   'Old output download link was not removed');
  assert((await page.locator('#quality-download').getAttribute('href'))===null,
   'Old quality report download link was not removed');
  const revoked=await page.evaluate(()=>window.__p32Blobs.revoked.slice());
  assert(revoked.includes(createdUrls.output)&&revoked.includes(createdUrls.quality),
   'Browser did not revoke old output and quality Blob URLs');
  await page.locator('#submit').click();
  await page.waitForFunction(()=>document.querySelector('#error')?.hidden===false,
   {timeout:90000});
  assert(await page.locator('#result').isHidden(),'Invalid input had an exposed result');
  assert(await page.locator('#submit').isEnabled(),'Conversion failure left form disabled');
  entry.checks.push('invalid-input-error-no-stale-download-recoverable');

  await page.locator('#file').setInputFiles(asFile(kml(114.1,22.5,'Retry'),'retry.kml'));
  assert(await page.locator('#error').isHidden(),'Old validation error not reset after selecting new file');
  await page.locator('#submit').click();
  try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
  catch{throw Error('Browser worker failed to recover from invalid GIS file: '+
   await page.locator('#error').textContent())}
  const retry=await download(page,'#download','.geojson');
  const retryJSON=JSON.parse(retry.bytes.toString('utf8'));
  const newPoint=retryJSON.features?.[0]?.geometry?.coordinates;
  assert(Math.abs(newPoint?.[0]-114.1)<.0001&&Math.abs(newPoint?.[1]-22.5)<.0001,
   'After error the browser downloaded the old geometry, not the new file');
  const workers=await page.evaluate(()=>window.__p32Workers);
  assert(workers.created===3&&workers.terminated===3,
   'Conversion worker leaked or was not terminated '+JSON.stringify(workers));
  entry.checks.push('retry-after-failure-new-data-worker-termination');
  entry.retryDownload={bytes:retry.bytes.length,sha256:sha256(retry.bytes),workers};

  const converted=await successfulConversion(page,
   {name:'coordinates.csv',mimeType:'text/csv',buffer:csv},'csv-to-kmz','.kmz');
  const archive=await JSZip.loadAsync(converted.data.bytes);
  assert(archive.file('doc.kml'),'KMZ does not contain expected doc.kml');
  const embedded=await archive.file('doc.kml').async('string');
  assert(embedded.includes('116.4,39.9')||/<coordinates>116\.4[0-9]*,39\.9/.test(embedded),
   'Downloaded KMZ KML lost the original geographic point');
  entry.checks.push('actual-csv-to-kmz-zip-download-extract');
  entry.kmzDownload={bytes:converted.data.bytes.length,sha256:sha256(converted.data.bytes)};

  assert(entry.browserErrors.length===0,
   'Uncaught '+browserCase.name+' JS errors '+entry.browserErrors.join(';'));
  assert(entry.failedResponses.length===0,
   'Public Pages HTTP asset failures '+JSON.stringify(entry.failedResponses));
  entry.status='PASSED';
 }catch(e){
  entry.error=String(e?.stack||e).slice(0,4500);
  report.failures.push(browserCase.name);
 }finally{
  await context?.close().catch(()=>{});
  await browser?.close().catch(()=>{});
 }
 console.log('P32_BROWSER '+browserCase.name+' '+entry.status+' '+
  (entry.error||entry.checks.join(',')));
}
report.passed=report.engines.filter(e=>e.status==='PASSED').length;
report.expected=browserCases.length;
report.status=report.passed===report.expected?'PASSED':'FAILED';
report.finishedAt=new Date().toISOString();
fs.writeFileSync(evidencePath,JSON.stringify(report,null,2));
console.log('P32_CROSS_BROWSER_SUMMARY '+JSON.stringify({
 status:report.status,passed:report.passed,expected:report.expected,
 failed:report.failures,source:report.source
}));
if(report.status!=='PASSED')process.exitCode=1;
