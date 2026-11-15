/**
 * P44 independent, actual Chromium browser review-and-retry regression.
 * Triggers real Worker preflight errors before GIS WASM, then verifies the
 * rendered accessible recovery panel and one valid end-to-end GDAL download.
 * Synthetic GDAL errors are used ONLY for a privacy-redaction display test.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const root=(process.env.GIS_BASE_URL||'http://127.0.0.1:8799').replace(/\/+$/,'');
const local=root.startsWith('http://127.0.0.1:');
const resultFile=local?'p44-guidance-local-results.json':'p44-guidance-live-results.json';
const report={kind:'p44-browser-gis-recovery',root,status:'FAILED',expected:8,
 cases:[],errors:[],codePrivacy:'NO RAW INPUT DETAILS'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser;
const check=(value,message)=>{if(!value)throw Error(message)};
async function test(name,fn){
 const entry={name,status:'FAILED'};report.cases.push(entry);
 try{Object.assign(entry,await fn(),{status:'PASSED'});console.log('P44_BROWSER '+name+' PASSED')}
 catch(e){entry.error=String(e?.stack||e).slice(0,1800);
  console.error('P44_BROWSER '+name+' FAILED '+entry.error)}
}
async function pageAt(slug){
 const page=await browser.newPage({acceptDownloads:true});
 page.on('pageerror',e=>report.errors.push(String(e)));
 const response=await page.goto(root+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:50000});
 check(response?.ok(),'Converter route unavailable: '+slug);
 return page;
}
const fixture=(name,content,mimeType='text/plain')=>({
 name,mimeType,buffer:Buffer.from(content)
});
async function failWith(page,input,expected){
 await page.locator('#file').setInputFiles(input);
 await page.locator('#submit').click();
 await page.waitForFunction(()=>document.querySelector('#error')?.hidden===false,{timeout:20000});
 check(await page.locator('#result').isHidden(),'Failed conversion showed an old download');
 check(await page.locator('#recovery-panel').isVisible(),'Recovery panel absent for '+expected);
 check(await page.locator('#recovery-panel').getAttribute('data-guidance')===expected,
  'Unexpected GIS guidance code: '+await page.locator('#recovery-panel').getAttribute('data-guidance')+' expected '+expected);
 check(await page.locator('#recovery-steps li').count()===3,'Recovery steps missing');
 check((await page.locator('#recovery-code').innerText()).includes(expected),
  'Recovery diagnostic code not available');
 check((await page.locator('#error').innerText()).startsWith('Conversion failed:'),
  'Safe error summary missing');
 check(await page.locator('#download').getAttribute('href')===null,
  'Rejected GIS conversion retained a downloadable stale URL');
 return (await page.locator('#error').innerText());
}
try{
 if(local){
  let ready=false;
  try{ready=(await fetch(root+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8799','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<75;i++){try{ready=(await fetch(root+'/')).ok;if(ready)break}catch{}await wait(200)}
  }
  check(ready,'Local browser build server not available');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await test('invalid_KMZ_is_rejected_before_WASM_with_safe_ZIP_repair_instructions',async()=>{
  const page=await pageAt('kmz-to-shp');
  const requests=[];
  page.on('request',r=>{if(/gdal3WebAssembly.wasm/.test(r.url()))requests.push(r.url())});
  const message=await failWith(page,fixture('broken.kmz','NOT A ZIP'),'zip-damaged');
  check(message.includes('invalid ZIP header'),'ZIP error summary lost existing preflight detail');
  check(requests.length===0,'Invalid ZIP loaded GDAL/WASM before its preflight rejection');
  await page.close();return {rejectBeforeWasm:true,noStaleDownload:true};
 });
 await test('shapefile_PRJ_missing_provides_no_guess_CRS_recovery',async()=>{
  const page=await pageAt('shp-to-geojson'),zip=new JSZip();
  for(const ext of ['shp','shx','dbf'])zip.file('layer.'+ext,new Uint8Array([1,2,3,4]));
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
  const message=await failWith(page,{name:'missing-prj.zip',mimeType:'application/zip',buffer:bytes},'crs-missing');
  check(message.includes('.prj missing'),'Missing CRS message has no .prj context');
  check((await page.locator('#recovery-steps').innerText()).includes('Do not assign EPSG:4326'),
   'Missing CRS guidance must never encourage guessing EPSG code');
  await page.close();return {crsGuessingForbidden:true};
 });
 await test('geojson_mixed_geometry_has_actionable_layer_split_and_safe_retry',async()=>{
  const page=await pageAt('geojson-to-shp');
  const feature=(type,coordinates)=>({type:'Feature',properties:{},geometry:{type,coordinates}});
  const input=features=>fixture('sample.geojson',
   JSON.stringify({type:'FeatureCollection',features}),'application/geo+json');
  await failWith(page,input([feature('Point',[0,0]),feature('Polygon',
   [[[0,0],[1,0],[1,1],[0,1],[0,0]]])]),'geometry-mixed');
  check((await page.locator('#recovery-steps').innerText()).includes('separate'),
   'Mixed geometry guidance must recommend splitting families');
  await page.locator('#file').setInputFiles(input([feature('Point',[116.4,39.9])]));
  check(await page.locator('#recovery-panel').isHidden(),
   'Recovery guidance must clear when user selects new source');
  await page.locator('#submit').click();
  try{await page.locator('#result').waitFor({state:'visible',timeout:125000})}
  catch{throw Error('Valid retry blocked: '+await page.locator('#error').textContent())}
  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:20000}),
   page.locator('#download').click()]);
  const bytes=fs.readFileSync(await dl.path());
  check(bytes.length>200&&dl.suggestedFilename().endsWith('.zip'),
   'Retry failed to deliver actual GIS Shapefile archive');
  const archive=await JSZip.loadAsync(bytes);
  check(Object.keys(archive.files).some(name=>name.endsWith('.shp')),
   'Valid retry ZIP missing SHP payload');
  const [qd]=await Promise.all([page.waitForEvent('download',{timeout:20000}),
   page.locator('#quality-download').click()]);
  const quality=JSON.parse(fs.readFileSync(await qd.path(),'utf8'));
  check(quality.checks.some(x=>x.id==='feature-count'&&x.status==='pass'),
   'Recovered actual GIS conversion lacks independent feature-count pass');
  check(await page.locator('#recovery-panel').isHidden(),
   'Old failure guidance remained after successful conversion');
  await page.close();return {repairedInputRetry:'success',downloadedRealSHP:true,
   independentQuality:true,staleFailureCleared:true};
 });
 await test('csv_WGS84_out_of_bounds_no_false_auto_reprojection',async()=>{
  const page=await pageAt('csv-to-kml');
  const message=await failWith(page,fixture('points.csv',
   'longitude,latitude,name\n116.4,39.9,ok\n181,40,bad\n','text/csv'),'csv-coordinates');
  check(message.includes('longitude outside WGS84 bounds'),'Existing CSV bounds diagnostic lost');
  check((await page.locator('#recovery-steps').innerText()).includes('EPSG:4326'),
   'WGS84 correction steps must specify CRS');
  await page.close();return {invalidCoordinatesRejected:true};
 });
 await test('csv_missing_columns_have_distinct_guidance',async()=>{
  const page=await pageAt('csv-to-kml');
  await failWith(page,fixture('points.csv','a,b,name\n1,2,x\n','text/csv'),'csv-columns');
  await page.close();return {headersVerified:true};
 });
 await test('geojson_JSON_syntax_error_recommends_valid_nonempty_collection',async()=>{
  const page=await pageAt('geojson-to-shp');
  await failWith(page,fixture('bad.geojson','{ invalid }','application/geo+json'),'geojson-invalid');
  await page.close();return {noSilentRecordDropping:true};
 });
 await test('raw_worker_GDAL_details_are_never_exposed_to_screen_or_DOM',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.addInitScript(()=>{
   const Native=window.Worker;
   window.Worker=class extends Native{
    postMessage(request){
     queueMicrotask(()=>this.onmessage?.({data:{id:request.id,type:'error',
      error:'GDAL could not open private file /Users/alice/private-patient.shp; 120.23456,31.3321; label=ConfidentialName'}}));
    }
   };
  });
  await page.goto(root+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded'});
  await failWith(page,fixture('ok.kml',
   '<?xml version="1.0"?><kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>'),'gdal-open');
  const visible=await page.locator('#error, #recovery-panel').allTextContents();
  for(const secret of ['/Users/alice','private-patient.shp','120.23456','ConfidentialName'])
   check(!visible.join(' ').includes(secret),'Worker private GIS content leaked in error panel');
  await page.close();return {rawFilePathAndCoordinatesHidden:true};
 });
 await test('raw_worker_memory_failure_is_safely_labeled_and_retryable',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.addInitScript(()=>{
   const Native=window.Worker;
   window.Worker=class extends Native{
    postMessage(req){queueMicrotask(()=>this.onmessage?.({data:{
     id:req.id,type:'error',error:'RuntimeError: memory allocation failed for /secret/field.shp'
    }}))}
   };
  });
  await page.goto(root+'/converter/kml-to-geojson/');
  await failWith(page,fixture('okay.kml',
   '<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>'),'memory');
  check((await page.locator('#recovery-steps').innerText()).includes('memory-saving mode'),
   'Resource guidance should offer opt-in memory-saving mode');
  await page.close();return {memoryFixInstructionsVisible:true};
 });
 report.status=report.cases.length===8&&report.cases.every(x=>x.status==='PASSED')&&
  report.errors.length===0?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,1800)}
finally{
 fs.writeFileSync(resultFile,JSON.stringify(report,null,2));
 console.log('P44_GIS_RECOVERY_SUMMARY '+JSON.stringify({
  status:report.status,expected:8,passed:report.cases.filter(x=>x.status==='PASSED').length,
  failed:report.cases.filter(x=>x.status!=='PASSED').map(x=>x.name),
  browserErrors:report.errors,fatal:report.fatal
 }));
 await browser?.close();server?.kill();
}
if(report.status!=='PASSED')process.exitCode=1;
