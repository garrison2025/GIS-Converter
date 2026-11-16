/**
 * P46 real browser test: every one of the 19 public/local routes can load
 * its own synthetic source file and convert it with actual GDAL/WASM.
 * No mocked Worker, no external GIS data, no uploaded user data.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
import JSZip from 'jszip';
import {routes} from '../src/lib/converter-routes.mjs';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8794').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const output=local?'p46-examples-local-results.json':'p46-examples-public-results.json';
const report={kind:'p46-real-gdal-synthetic-examples',origin:base,
 expected:routes.length+1,caseResults:[],pageErrors:[],status:'FAILED',
 guarantees:'Only synthetic GIS data; real browser Worker for all 19 routes'};
let browser,webkitBrowser,server;
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function test(name,fn){
 const r={name,status:'FAILED'};report.caseResults.push(r);
 try{Object.assign(r,await fn(),{status:'PASSED'});console.log('P46_EXAMPLE '+name+' PASSED')}
 catch(e){r.error=String(e?.stack||e).slice(0,1700);console.error('P46_EXAMPLE '+name+' FAILED '+r.error)}
}
async function download(page,selector){
 const [item]=await Promise.all([page.waitForEvent('download',{timeout:25000}),page.locator(selector).click()]);
 return {name:item.suggestedFilename(),bytes:fs.readFileSync(await item.path())};
}
async function verifyOutput(bytes,dst){
 check(bytes.length>8,'GDAL returned genuinely empty or invalid example conversion output');
 if(dst==='shp'){
  const zip=await JSZip.loadAsync(bytes);
  const names=Object.keys(zip.files);
  for(const ext of ['.shp','.shx','.dbf','.prj'])check(names.some(n=>n.endsWith(ext)),
   'Actual sample conversion missing '+ext);
  return {kind:'Shapefile ZIP',fileCount:names.length};
 }
 if(dst==='kmz'){
  const zip=await JSZip.loadAsync(bytes);
  check(Object.keys(zip.files).some(n=>n.endsWith('.kml')),'Converted KMZ missing KML');
  return {kind:'KMZ',fileCount:Object.keys(zip.files).length};
 }
 const text=bytes.toString('utf8');
 if(dst==='geojson'){
  const result=JSON.parse(text);
  check(result.type==='FeatureCollection'&&result.features?.length>=1,
   'Example GeoJSON missing features');
  const first=result.features[0].geometry.coordinates;
  if(result.features[0].geometry.type==='Point'){
   check(Math.abs(first[0]-116.4)<0.001&&Math.abs(first[1]-39.9)<0.001,
    'Example GeoJSON coordinates drifted');
  }
 }else if(dst==='kml')check(text.includes('<kml')&&text.includes('<Placemark'),
  'Converted KML missing usable placemark');
 else if(dst==='gpx')check(text.includes('<gpx')&&
   (text.includes('<wpt')||text.includes('<trk')||text.includes('<rte')),
   'Converted GPX contains no waypoint or track');
 else if(dst==='csv')check(text.includes('116.4')&&text.includes('39.9'),
  'Converted CSV point coordinates are missing');
 return {kind:dst};
}
try{
 if(local){
  let ready=false;try{ready=(await fetch(base+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8794','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<65;i++){
    try{ready=(await fetch(base+'/')).ok;if(ready)break}catch{}
    await wait(230);
   }
  }
  check(ready,'Cannot serve locally built GIS site');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const [slug,src,dst] of routes){
  await test('chromium_'+slug,async()=>{
   const page=await browser.newPage({acceptDownloads:true});
   page.on('pageerror',e=>report.pageErrors.push(slug+': '+String(e)));
   let outsideRequests=0,workers=0;
   page.on('request',request=>{
    if(!request.url().startsWith(base))outsideRequests++;
   });
   await page.addInitScript(()=>{
    const Base=window.Worker;
    window.__demoWorkers=0;
    window.Worker=class extends Base{
     constructor(...args){super(...args);window.__demoWorkers++}
    };
   });
   try{
    const response=await page.goto(base+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:50000});
    check(response?.ok(),'Converter unavailable');
    check(await page.locator('#load-sample').isVisible(),'Try sample button is missing');
    await page.locator('#load-sample').click();
    // ZIP samples dynamically import JSZip; the button click returns before
    // asynchronous archive generation has finished. Await the real file.
    await page.waitForFunction(()=>document.querySelector('#file')?.files.length===1,
     {timeout:15000});
    check(await page.locator('#file').evaluate(input=>input.files.length)===1,
     'Example was not assigned to native file picker');
    const input=await page.locator('#file').evaluate(input=>({
     name:input.files[0]?.name,size:input.files[0]?.size
    }));
    check(input.name==='gis-example.'+(src==='shp'?'zip':src),
     'Sample filename format does not match source');
    check(input.size>0&&input.size<16384,'Sample size exceeds strict bound');
    check((await page.locator('#sample-help').innerText()).includes('Click Convert'),
     'Sample instructions did not explain next step');
    check(await page.evaluate(()=>window.__demoWorkers)===0,
     'Selecting a sample unexpectedly started GDAL before user consent');
    check(outsideRequests===0,'Loading a sample issued an external request');
    await page.locator('#submit').click();
    try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
    catch{throw Error('Actual Worker conversion failed: '+await page.locator('#error').textContent())}
    const file=await download(page,'#download');
    const verified=await verifyOutput(file.bytes,dst);
    const quality=JSON.parse((await download(page,'#quality-download')).bytes.toString('utf8'));
    check(quality.checks?.some(c=>c.id==='feature-count'&&c.status==='pass'),
     'Independent feature count did not pass for sample');
    check((await page.locator('#result').isVisible())&&
     (await page.evaluate(()=>window.__demoWorkers))===1,
     'Example conversion did not complete with exactly one isolated real Worker');
    check(outsideRequests===0,'Sample conversion sent any network request outside the website');
    workers=await page.evaluate(()=>window.__demoWorkers);
    return {source:src,target:dst,inputBytes:input.size,
     outputBytes:file.bytes.length,workerCount:workers,...verified,
     independentFeatureCount:true,noExternalRequests:true};
   }finally{await page.close()}
  });
 }
 await test('webkit_touch_sample_load_and_real_GDAL',async()=>{
  webkitBrowser=await webkit.launch({headless:true});
  const context=await webkitBrowser.newContext({viewport:{width:390,height:844},
   isMobile:true,hasTouch:true,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push('webkit: '+String(e)));
  try{
   await page.goto(base+'/converter/shp-to-geojson/',{waitUntil:'domcontentloaded'});
   await page.locator('#load-sample').click();
   await page.waitForFunction(()=>document.querySelector('#file')?.files.length===1,
    {timeout:15000});
   check(await page.locator('#file').evaluate(input=>input.files.length)===1,
    'WebKit cannot assign the synthetic SHP ZIP to file control');
   await page.locator('#submit').click();
   try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
   catch{throw Error('WebKit synthetic SHP conversion failed: '+await page.locator('#error').textContent())}
   const parsed=JSON.parse((await download(page,'#download')).bytes.toString('utf8'));
   check(parsed.features?.length===1&&
    Math.abs(parsed.features[0].geometry.coordinates[0]-116.4)<.001,
    'WebKit sample SHP→GeoJSON did not preserve point location');
   return {engine:'WebKit',touch:true,syntheticShapefile:true,realGDAL:true};
  }finally{await context.close()}
 });
 report.status=report.caseResults.length===20&&
  report.caseResults.every(c=>c.status==='PASSED')&&report.pageErrors.length===0?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,1400)}
finally{
 await webkitBrowser?.close();await browser?.close();server?.kill();
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log('P46_EXAMPLES_SUMMARY '+JSON.stringify({
  status:report.status,expected:report.expected,
  passed:report.caseResults.filter(c=>c.status==='PASSED').length,
  failed:report.caseResults.filter(c=>c.status!=='PASSED').map(c=>c.name),
  browserErrors:report.pageErrors,fatal:report.fatal
 }));
}
if(report.status!=='PASSED')process.exitCode=1;
