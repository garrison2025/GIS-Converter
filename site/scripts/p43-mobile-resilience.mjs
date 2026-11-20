/**
 * P43 low-memory device-profile robustness with actual GDAL/WASM conversion.
 * The Playwright viewport/deviceMemory are EMULATION, not real mobile RAM
 * measurements; the Chromium process-tree RSS is only a CI-runner observation.
 * Never claim a specific device can process a given GIS file based on this.
 */
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
import JSZip from 'jszip';

const root=(process.env.GIS_BASE_URL||'http://127.0.0.1:8784').replace(/\/+$/,'');
const local=/^http:\/\/127\.0\.0\.1:/.test(root);
const file=local?'p43-mobile-local-results.json':'p43-mobile-live-results.json';
const report={kind:'p43-mobile-browser-resilience',
 status:'FAILED',origin:root,physicalDevice:'NOT_TESTED',
 simulatedLowMemoryGiB:1,cases:[],errors:[]};
const check=(v,message)=>{if(!v)throw Error(message)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function processRSS(pid){
 try{
  const list=execFileSync('ps',['-e','-o','pid=,ppid=,rss='],{encoding:'utf8',timeout:1500})
   .trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  const parents=new Map(list.map(([p,parent])=>[p,parent]));
  const childOf=p=>{
   const seen=new Set();
   while(p>0&&!seen.has(p)){
    if(p===pid)return true;
    seen.add(p);p=parents.get(p)||0;
   }
   return false;
  };
  return list.filter(([p])=>p!==pid&&childOf(p)).reduce((total,[,,rss])=>total+(rss||0),0);
 }catch{return null}
}
function polygonFixture(n=3000){
 const features=Array.from({length:n},(_,i)=>{
  const x=100+(i%100)*.011,y=19+Math.floor(i/100)*.011;
  const outer=[[x,y],[x,y+.008],[x+.008,y+.008],[x+.008,y],[x,y]];
  const hole=[[x+.002,y+.002],[x+.005,y+.002],[x+.005,y+.005],[x+.002,y+.005],[x+.002,y+.002]];
  return {type:'Feature',properties:{Label:'Polygon-'+i,ID:i},
   geometry:{type:'Polygon',coordinates:[outer,hole]}};
 });
 return {name:'p43-3000holes.geojson',mimeType:'application/geo+json',
  buffer:Buffer.from(JSON.stringify({type:'FeatureCollection',features}))};
}
function pointFixture(){
 return {name:'p43-retry.kml',mimeType:'application/vnd.google-earth.kml+xml',
  buffer:Buffer.from('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">'+
   '<Placemark><name>Retry</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></kml>')};
}
async function download(page,selector){
 const [dl]=await Promise.all([page.waitForEvent('download',{timeout:25000}),page.locator(selector).click()]);
 return fs.readFileSync(await dl.path());
}
async function run(name,fn){
 const entry={name,status:'FAILED'};report.cases.push(entry);
 try{Object.assign(entry,await fn(),{status:'PASSED'});console.log('P43_MOBILE '+name+' PASSED')}
 catch(e){entry.error=String(e?.stack||e).slice(0,1700);
  console.error('P43_MOBILE '+name+' FAILED '+entry.error)}
}
let browser,kit,localServer;
try{
 // Hosted validation invokes this script with built dist but no persistent
 // web server. Public live acceptance and the QGIS workflow already have
 // a reachable origin. Start local static service only when needed.
 let available=false;
 for(let attempt=0;attempt<3;attempt++){
  try{available=(await fetch(root+'/')).ok;if(available)break}catch{}
  await sleep(250);
 }
 if(!available&&local){
  localServer=spawn('python3',['-m','http.server','8784','--directory','dist'],{stdio:'ignore'});
  for(let attempt=0;attempt<65;attempt++){
   try{if((await fetch(root+'/')).ok){available=true;break}}catch{}
   await sleep(200);
  }
 }
 check(available,'P43 browser test origin unavailable');
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-precise-memory-info']});
 const ctx=await browser.newContext({viewport:{width:390,height:844},
  isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true});
 await ctx.addInitScript(()=>{
  Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>1});
  const Native=window.Worker;
  window.__workerStarts=0;window.__workerStops=0;
  window.Worker=class extends Native{
   constructor(...args){super(...args);window.__workerStarts++}
   terminate(){window.__workerStops++;return super.terminate()}
  };
 });
 const page=await ctx.newPage();
 page.on('pageerror',e=>report.errors.push(String(e)));
 await run('mobile_390_3000_polygon_holes_low_memory_actual_wasm_quality_download',async()=>{
  const r=await page.goto(root+'/converter/geojson-to-shp/',{waitUntil:'domcontentloaded',timeout:50000});
  check(r?.ok(),'Cannot load actual converter');
  check(await page.locator('#memory-save').isChecked(),
   'One-GiB reported hint should select memory saver');
  const fixture=polygonFixture();
  check(fixture.buffer.length<15*1024*1024,'Fixture exceeds upload limit');
  await page.locator('#file').setInputFiles(fixture);
  let peakRSSKiB=0,samples=0;
  const sample=()=>{
   const rss=processRSS(process.pid);
   if(rss!==null){samples++;peakRSSKiB=Math.max(peakRSSKiB,rss)}
  };
  const timer=setInterval(sample,200);
  sample();const start=Date.now();
  try{
   await page.locator('#submit').click();
   try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
   catch{throw Error('Large low-memory profile conversion failed: '+
     await page.locator('#error').textContent())}
  }finally{clearInterval(timer);sample()}
  const elapsedMs=Date.now()-start;
  check(await page.locator('#preview-body').getAttribute('data-status')==='unavailable',
   'Low-memory page allocated optional GIS preview');
  const quality=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
  check(quality.checks.find(c=>c.id==='complex-geometry-values')?.status==='pass',
   'All 3,000 polygon holes were not independently checked');
  check(quality.output.features===3000,'Quality report did not account for all polygons');
  const shape=await JSZip.loadAsync(await download(page,'#download'));
  check(Object.keys(shape.files).some(n=>n.endsWith('.shp')),'Actual Shapefile missing');
  check(await page.evaluate(()=>window.__workerStarts===window.__workerStops),
   'Converted Worker not terminated after completion');
  check((await page.locator('#download').getAttribute('href'))?.startsWith('blob:'),
   'Private Blob download not prepared');
  return {fixtureFeatures:3000,polygonHoles:3000,geometryIntegrity:'pass',
   elapsedMs,chromiumProcessTreePeakRSSKiB:peakRSSKiB||null,rssSamples:samples,
   memoryCaveat:'Process-tree RSS is CI runner only; not mobile device measurement'};
 });
 await run('mobile_390_cancel_real_worker_and_retry_without_stale_output',async()=>{
  // Keep the same page and mode to detect accidental re-use of stale Blob URLs
  // and workers after a real (not mocked) large GDAL conversion is cancelled.
  const old=await page.locator('#download').getAttribute('href');
  await page.locator('#file').setInputFiles(polygonFixture());
  check(await page.locator('#result').isHidden(),'Old conversion result remained after input replacement');
  check((await page.locator('#download').getAttribute('href'))===null,
   'Old download Blob not revoked after input replacement');
  await page.locator('#submit').click();
  await page.locator('#cancel').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('cancelled'),{timeout:10000});
  const stopped=await page.evaluate(()=>({starts:window.__workerStarts,
   stops:window.__workerStops,canSubmit:!document.querySelector('#submit').disabled}));
  check(stopped.starts===stopped.stops&&stopped.canSubmit,
   'Cancelled large conversion leaked Worker or disabled submit');
  check(await page.locator('#result').isHidden(),'Cancelled large conversion exposed partial result');
  // Keep the exact same GeoJSON→SHP page; a KML fixture would be
  // intentionally rejected by the filename preflight and would NOT test
  // cancellation recovery of this conversion route.
  const retryGeojson={type:'FeatureCollection',features:[{
   type:'Feature',properties:{Label:'Retry'},
   geometry:{type:'Point',coordinates:[116.4,39.9]}
  }]};
  await page.locator('#file').setInputFiles({
   name:'p43-retry.geojson',mimeType:'application/geo+json',
   buffer:Buffer.from(JSON.stringify(retryGeojson))
  });
  await page.locator('#submit').click();
  try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
  catch{throw Error('Recovery after cancel failed: '+await page.locator('#error').textContent())}
  const retryZip=await JSZip.loadAsync(await download(page,'#download'));
  const shpName=Object.keys(retryZip.files).find(n=>n.toLowerCase().endsWith('.shp'));
  check(Boolean(shpName),'Successful retry did not return a Shapefile');
  const shape=await retryZip.file(shpName).async('uint8array');
  const view=new DataView(shape.buffer,shape.byteOffset,shape.byteLength);
  check(shape.byteLength>=128&&view.getInt32(108,true)===1,
   'Retry does not contain a valid 2D Shapefile Point');
  check(Math.abs(view.getFloat64(112,true)-116.4)<.00001&&
   Math.abs(view.getFloat64(120,true)-39.9)<.00001,
   'Retry returned stale or corrupt point geometry');
  const memoryFlag=await page.locator('#memory-save').isChecked();
  check(memoryFlag,'Retry unexpectedly disabled low-memory mode');
  const workers=await page.evaluate(()=>({starts:window.__workerStarts,stops:window.__workerStops}));
  check(workers.starts===workers.stops,'Recovery Worker not terminated');
  return {cancelledActiveWorker:true,privateOldBlobRevoked:Boolean(old),successfulRetry:true,
   workersStarted:workers.starts,workersTerminated:workers.stops};
 });
 // P52 resource isolation: the preceding 3,000-polygon Chromium test
 // must release its process tree before the independent WebKit mobile
 // low-memory conversion. Keep the same fixtures, quality assertions and
 // actual GDAL/WASM coverage; do not weaken the acceptance threshold.
 await ctx.close();
 await browser.close();
 browser=null;
 await run('webkit_touch_mobile_manual_low_memory_download',async()=>{
  kit=await webkit.launch({headless:true});
  const context=await kit.newContext({viewport:{width:390,height:844},
   deviceScaleFactor:2,isMobile:true,hasTouch:true,acceptDownloads:true});
  const p=await context.newPage();
  const r=await p.goto(root+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded',timeout:50000});
  check(r?.ok(),'WebKit GIS converter unavailable');
  await p.locator('#memory-save').check();
  await p.locator('#file').setInputFiles(pointFixture());
  await p.locator('#submit').click();
  try{await p.locator('#result').waitFor({state:'visible',timeout:110000})}
  catch{throw Error('WebKit mobile profile conversion failed: '+await p.locator('#error').textContent())}
  const geo=JSON.parse((await download(p,'#download')).toString('utf8'));
  check(geo.features.length===1,'WebKit mobile download lost point');
  check(await p.locator('#preview-body').getAttribute('data-status')==='unavailable',
   'WebKit memory saver reallocated GDAL map preview');
  const q=JSON.parse((await download(p,'#quality-download')).toString('utf8'));
  check(q.checks.find(c=>c.id==='point-coordinate-values')?.status==='pass',
   'WebKit low-memory point value quality check missing');
  await context.close();
  return {engine:'WebKit',simulatedTouch:true,manualMemorySaving:true,
   actualWasmOutput:true,qualityReport:'point-coordinate-values:pass'};
 });
 check(report.cases.length===3&&report.cases.every(c=>c.status==='PASSED')&&
  report.errors.length===0,'One or more P43 mobile-profile resilience cases failed');
 report.status='PASSED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,1800)}
finally{
 await kit?.close();await browser?.close();localServer?.kill();
 fs.writeFileSync(file,JSON.stringify(report,null,2));
 console.log('P43_MOBILE_SUMMARY '+JSON.stringify({status:report.status,
  passed:report.cases.filter(c=>c.status==='PASSED').length,expected:3,
  errors:report.errors,physicalDevice:report.physicalDevice,fatal:report.fatal}));
}
if(report.status!=='PASSED')process.exitCode=1;
