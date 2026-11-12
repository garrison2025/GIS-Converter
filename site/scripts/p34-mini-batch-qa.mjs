/**
 * P34: run REAL browser GDAL/WASM mini-batch conversions, outputs and failures.
 * Same harness runs on locally-served built Astro and public Cloudflare Pages.
 * Synthetic test inputs only; never sends actual user files anywhere.
 */
import fs from 'node:fs';
import {chromium,firefox,webkit} from 'playwright';
import JSZip from 'jszip';

const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const local=origin.startsWith('http://127.0.0.1:');
const evidence=local?'p34-mini-batch-local-results.json':'p34-mini-batch-live-results.json';
const report={kind:'p34-free-browser-mini-batch',origin,mode:local?'local':'public',
 status:'FAILED',startedAt:new Date().toISOString(),cases:[],failed:[],browserErrors:[]};
const kml=(lon,lat,caption)=>'<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>'+
 caption+'</name><Point><coordinates>'+lon+','+lat+',0</coordinates></Point></Placemark></Document></kml>';
const point=(lon,lat,name)=>({name:name||'input.kml',
 mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kml(lon,lat,'GIS QA'))});
function check(value,message){if(!value)throw Error(message);}
async function downloaded(page,selector){
 const [d]=await Promise.all([page.waitForEvent('download',{timeout:20000}),
  page.locator(selector).click()]);
 return {name:d.suggestedFilename(),bytes:fs.readFileSync(await d.path())};
}
async function convert(page){
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
 catch{throw Error('Batch conversion error: '+
  (await page.locator('#error').textContent())+' status='+
  (await page.locator('#status').textContent()))}
}
async function inspectZip(bytes,expectedCoordinates){
 const zip=await JSZip.loadAsync(bytes);
 const manifestFile=zip.file('manifest.json');
 check(manifestFile,'Batch output omitted manifest');
 const manifest=JSON.parse(await manifestFile.async('string'));
 check(manifest.kind==='gis-converter-local-mini-batch','Batch manifest type is wrong');
 check(manifest.files.length===expectedCoordinates.length,'Batch manifest contains wrong file count');
 check(Object.keys(zip.files).filter(n=>!zip.files[n].dir).length===
  1+2*expectedCoordinates.length,'Batch archive has missing or unexpected files');
 const seen=new Set();
 for(let i=0;i<manifest.files.length;i++){
  const entry=manifest.files[i];
  check(!seen.has(entry.outputPath),'Duplicate output path silently overwrote a converted file');
  seen.add(entry.outputPath);
  check(entry.outputPath.startsWith('converted/')&&
   !entry.outputPath.includes('..')&&!entry.outputPath.includes('\\'),
   'Unsafe user-derived ZIP path');
  const data=zip.file(entry.outputPath);
  check(data,'Missing converted file for input '+i);
  const json=JSON.parse(await data.async('string'));
  check(json.type==='FeatureCollection'&&json.features.length===1,
   'Batch converted GeoJSON is invalid');
  const coords=json.features[0].geometry.coordinates;
  check(Math.abs(coords[0]-expectedCoordinates[i][0])<.0001&&
   Math.abs(coords[1]-expectedCoordinates[i][1])<.0001,
   'File '+(i+1)+' got a different source geometry or was overwritten');
  const quality=zip.file(entry.reportPath);
  check(quality,'No independent JSON inspection report for file '+i);
  const payload=JSON.parse(await quality.async('string'));
  check(payload.kind==='local-structural-quality-report'&&
   payload.checks.some(c=>c.id==='feature-count'),
   'Batch quality report is not the real worker result');
 }
 return {manifestCount:manifest.files.length,convertedOutputs:seen.size,
  qualityReports:manifest.files.length,safePaths:true};
}
async function doTest(name,fn){
 const entry={name,status:'FAILED'},start=Date.now();
 report.cases.push(entry);
 try{
  Object.assign(entry,await fn(),{status:'PASSED',elapsedMs:Date.now()-start});
  console.log('P34_BATCH '+name+' PASSED');
 }catch(e){
  entry.error=String(e?.stack||e).slice(0,2500);
  report.failed.push(name);
  console.error('P34_BATCH '+name+' FAILED '+entry.error);
 }
}
let browser;
try{
 for(const [name,type] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
  await doTest('two_real_gis_files_to_zip_'+name,async()=>{
   const b=await type.launch({headless:true});
   try{
    const page=await b.newPage({acceptDownloads:true});
    page.on('pageerror',e=>report.browserErrors.push(name+': '+String(e)));
    await page.addInitScript(()=>{
     const Old=window.Worker;
     window.__batchWorkers={created:0,terminated:0};
     window.Worker=class extends Old{
      constructor(...args){super(...args);window.__batchWorkers.created++}
      terminate(){window.__batchWorkers.terminated++;return super.terminate()}
     };
    });
    const r=await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded',timeout:45000});
    check(r?.ok(),'Converter unavailable');
    check(await page.locator('#file').getAttribute('multiple')!==null,
     'Batch multi-select missing');
    await page.locator('#file').setInputFiles([
     point(116.4,39.9,'one.kml'),point(114.1,22.5,'two.kml')]);
    check((await page.locator('#file-info').textContent()).includes('2 files selected'),
     'Batch selection summary missing');
    await convert(page);
    check((await page.locator('#status').textContent()).includes('Mini-batch complete'),
     'Batch completion status not announced');
    const item=await downloaded(page,'#download');
    check(item.name==='gis-kml-to-geojson-batch-2.zip','ZIP filename incorrect');
    const checked=await inspectZip(item.bytes,[[116.4,39.9],[114.1,22.5]]);
    const qa=await downloaded(page,'#quality-download');
    const summary=JSON.parse(qa.bytes.toString('utf8'));
    check(summary.kind==='local-mini-batch-summary'&&summary.checks.length===2,
     'Aggregated mini-batch quality download missing');
    const workerCount=await page.evaluate(()=>window.__batchWorkers);
    check(workerCount.created===2&&workerCount.terminated===2,
     'Batch did not isolate and terminate one Worker per file');
    return {...checked,workerCount};
   }finally{await b.close()}
  });
 }
 await doTest('single_file_still_downloads_unzipped_geojson',async()=>{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles(point(116.4,39.9,'one.kml'));
  await convert(page);
  const output=await downloaded(page,'#download');
  check(output.name.endsWith('.geojson')&&!output.name.endsWith('.zip'),
   'Single file unexpectedly downloaded a batch ZIP');
  const json=JSON.parse(output.bytes.toString('utf8'));
  check(json.features.length===1,'Single-file conversion regression');
  return {singlePreserved:true};
 });
 await doTest('three_files_same_name_no_collisions',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles([
   point(116.4,39.9,'same.kml'),point(114.1,22.5,'same.kml'),
   point(-73.9,40.7,'same.kml')]);
  await convert(page);
  const d=await downloaded(page,'#download');
  const checked=await inspectZip(d.bytes,[[116.4,39.9],[114.1,22.5],[-73.9,40.7]]);
  return {...checked,duplicateSourceNamesPreserved:true};
 });
 await doTest('invalid_second_file_fails_without_partial_zip_then_recovers',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles([
   point(116.4,39.9,'first.kml'),
   {name:'broken.kml',mimeType:'application/vnd.google-earth.kml+xml',
    buffer:Buffer.from('NOT VALID GIS XML')}]);
  await page.locator('#submit').click();
  await page.locator('#error').waitFor({state:'visible',timeout:110000});
  check(await page.locator('#result').isHidden(),'Partial ZIP was exposed after a file failed');
  check((await page.locator('#download').getAttribute('href'))===null,
   'Failed batch left downloadable artifact');
  check((await page.locator('#error').textContent()).includes('File 2'),
   'No per-file error context');
  check(await page.locator('#submit').isEnabled(),'Failed batch cannot be retried');
  await page.locator('#file').setInputFiles([
   point(116.4,39.9,'first.kml'),point(114.1,22.5,'second.kml')]);
  await convert(page);
  const d=await downloaded(page,'#download');
  await inspectZip(d.bytes,[[116.4,39.9],[114.1,22.5]]);
  return {partialOutputBlocked:true,retrySuccessful:true};
 });
 await doTest('four_files_and_oversized_combined_input_rejected_pre_worker',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.addInitScript(()=>{
   const Old=window.Worker;window.__batchStarted=0;
   window.Worker=class extends Old{
    constructor(...args){super(...args);window.__batchStarted++}
   };
  });
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles([
   point(1,1,'1.kml'),point(2,2,'2.kml'),
   point(3,3,'3.kml'),point(4,4,'4.kml')]);
  check(await page.locator('#error').isVisible(),'Four-file overquota not explained');
  await page.locator('#submit').click();
  check(await page.locator('#result').isHidden(),'Too many input files produced a ZIP');
  check(await page.evaluate(()=>window.__batchStarted)===0,
   'Overquota input started worker');
  const oversized=Buffer.alloc(11*1024*1024,65);
  await page.locator('#file').setInputFiles([1,2,3].map(i=>({
   name:'big'+i+'.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:oversized
  })));
  check((await page.locator('#error').textContent()).includes('30 MiB'),
   'Combined limit not explained');
  await page.locator('#submit').click();
  check(await page.evaluate(()=>window.__batchStarted)===0,
   'Too-large combined input started worker');
  return {maxFiles:3,totalInputMiB:30,workerStarts:0};
 });
 await doTest('drag_drop_two_files_selects_but_does_not_autoconvert',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(origin+'/converter/kml-to-geojson/');
  const res=await page.evaluate(()=>{
   const z=document.querySelector('#drop-zone'),dt=new DataTransfer();
   const kml=(x,y)=>'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">'+
    '<Placemark><Point><coordinates>'+x+','+y+',0</coordinates></Point></Placemark></kml>';
   dt.items.add(new File([kml(116.4,39.9)],'first.kml',{type:'application/vnd.google-earth.kml+xml'}));
   dt.items.add(new File([kml(114.1,22.5)],'second.kml',{type:'application/vnd.google-earth.kml+xml'}));
   z.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
   return {count:document.querySelector('#file').files.length,
    status:document.querySelector('#status').textContent,
    hidden:document.querySelector('#result').hidden};
  });
  check(res.count===2&&res.hidden&&res.status.includes('Ready'),
   'Dropping files unexpectedly started conversion or was ignored');
  await convert(page);
  const d=await downloaded(page,'#download');
  await inspectZip(d.bytes,[[116.4,39.9],[114.1,22.5]]);
  return {dropSupported:true,requiresExplicitSubmit:true};
 });
 await doTest('cancel_first_worker_never_exposes_partial_zip',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.addInitScript(()=>{
   const Old=window.Worker;
   window.__holdOne=true;window.__batchCounters={starts:0,stops:0};
   window.Worker=class extends Old{
    constructor(...args){super(...args);window.__batchCounters.starts++}
    postMessage(...args){if(window.__holdOne){window.__holdOne=false;return;}return super.postMessage(...args)}
    terminate(){window.__batchCounters.stops++;return super.terminate()}
   };
  });
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles([
   point(116.4,39.9,'first.kml'),point(114.1,22.5,'second.kml')]);
  await page.locator('#submit').click();
  await page.locator('#cancel').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.__batchCounters.starts===1,{timeout:15000});
  await page.locator('#cancel').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('cancelled'),{timeout:20000});
  check(await page.locator('#result').isHidden(),'Cancelled batch exposed partial output');
  check((await page.locator('#download').getAttribute('href'))===null,
   'Cancelled batch leaked a ZIP link');
  check(await page.locator('#submit').isEnabled(),'Cancelled batch left form disabled');
  const workers=await page.evaluate(()=>window.__batchCounters);
  check(workers.starts===1&&workers.stops===1,'Cancelled worker was not terminated');
  return {cancelWorks:true,workers};
 });
 check(report.browserErrors.length===0,'Uncaught browser exception(s): '+report.browserErrors);
 report.status=report.failed.length===0&&report.cases.length===9?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2500)}
finally{
 report.passed=report.cases.filter(x=>x.status==='PASSED').length;
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(evidence,JSON.stringify(report,null,2));
 console.log('P34_MINI_BATCH_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.passed,total:report.cases.length,
  failed:report.failed,pageErrors:report.browserErrors,fatal:report.fatal
 }));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
