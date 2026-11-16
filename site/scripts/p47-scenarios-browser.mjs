/**
 * P47 actual Chromium browser GDAL/WASM scenario acceptance.
 * Verify only supported scenarios, native file selection, real independent
 * geometry bytes & quality report. No mock Worker or external GIS upload.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
import JSZip from 'jszip';
import {routes} from '../src/lib/converter-routes.mjs';
import {supportedDemoScenarios,DEMO_LINE,DEMO_POLYGON} from '../src/lib/demo-gis-scenarios.mjs';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8793').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const evidence=local?'p47-scenarios-local.json':'p47-scenarios-public.json';
const scenarios=routes.flatMap(([slug,src,dst])=>
 supportedDemoScenarios(src,dst).filter(s=>s!=='point').map(s=>({slug,src,dst,scenario:s})));
const report={status:'FAILED',kind:'p47-real-complex-scenarios',origin:base,
 expected:scenarios.length+1,cases:[],browserErrors:[],
 originData:'Synthetic only; real GDAL/WASM Worker and output bytes'};
let server,browser,webKit;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const check=(v,msg)=>{if(!v)throw Error(msg)};
async function download(page,selector){
 const [d]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator(selector).click()]);
 return fs.readFileSync(await d.path());
}
async function verify(bytes,dst,scenario){
 check(bytes.length>8,'Converted example is empty');
 let geoKind=null,parts=0,holes=0,vertices=0;
 if(dst==='shp'){
  const zip=await JSZip.loadAsync(bytes);
  const name=Object.keys(zip.files).find(n=>n.toLowerCase().endsWith('.shp'));
  check(name,'Output SHP ZIP missing actual geometry');
  const shp=await zip.file(name).async('uint8array');
  check(shp.length>=200,'Output Shapefile record truncated');
  const view=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
  const type=view.getInt32(108,true);
  check((scenario==='line'?[3,13]:[5,15]).includes(type),'Output SHP has incorrect line/polygon shape type '+type);
  parts=view.getInt32(144,true);vertices=view.getInt32(148,true);
  check(parts===(scenario==='line'?1:2),'Output SHP lost polygon hole or polyline part');
  check(vertices===(scenario==='line'?3:10),'Output SHP lost original line/ring vertices');
  holes=parts-1;
  geoKind='Shapefile';
 }else if(dst==='kmz'){
  const zip=await JSZip.loadAsync(bytes);
  const names=Object.keys(zip.files);
  check(names.some(n=>n.endsWith('.kml')),'Converted KMZ missing KML');
  const kml=await zip.file(names.find(n=>n.endsWith('.kml'))).async('string');
  check(scenario==='line'?
    (kml.includes('<LineString')||kml.includes('<gx:Track')):
    (kml.includes('<Polygon')&&kml.includes('<innerBoundaryIs')),
    'KMZ KML lost expected line or polygon interior boundary');
  geoKind='KMZ';
 }else if(dst==='geojson'){
  const object=JSON.parse(bytes.toString('utf8'));
  check(object.type==='FeatureCollection'&&object.features?.length>=1,
   'GeoJSON output has no features');
  const geom=object.features.find(f=>f.geometry)?.geometry;
  check(geom?.type===(scenario==='line'?'LineString':'Polygon'),
   'GeoJSON lost original geometry family');
  if(scenario==='line'){
   check(geom.coordinates.length===DEMO_LINE.length,'Line lost vertices');
   check(Math.abs(geom.coordinates[1][0]-116.45)<.0001,'Interior line vertex moved');
  }else{
   check(geom.coordinates.length===2,'GeoJSON lost interior polygon hole');
   check(geom.coordinates[0].length===DEMO_POLYGON[0].length,'GeoJSON outer ring truncated');
   check(geom.coordinates[1].length===DEMO_POLYGON[1].length,'GeoJSON inner ring truncated');
  }
  geoKind='GeoJSON';
 }else if(dst==='kml'){
  const kml=bytes.toString('utf8');
  check(scenario==='line'?
    (kml.includes('<LineString')||kml.includes('<gx:Track')):
    (kml.includes('<Polygon')&&kml.includes('<innerBoundaryIs')),
    'KML output missing line, polygon or interior hole');
  geoKind='KML';
 }else if(dst==='gpx'){
  check(scenario==='line','GPX polygon output should never be offered');
  const xml=bytes.toString('utf8');
  check(xml.includes('<gpx')&&(xml.includes('<trk')||xml.includes('<rte')),
   'GPX output lost line or route geometry');
  geoKind='GPX';
 }else throw Error('Unsupported destination for complex demonstration: '+dst);
 return {geometry:geoKind,parts,holes,vertices};
}
async function test(name,fn){
 const entry={name,status:'FAILED'};report.cases.push(entry);
 try{Object.assign(entry,await fn(),{status:'PASSED'});console.log('P47_SCENARIO '+name+' PASSED')}
 catch(e){entry.error=String(e?.stack||e).slice(0,1800);console.error('P47_SCENARIO '+name+' FAILED '+entry.error)}
}
try{
 if(local){
  let okay=false;try{okay=(await fetch(base+'/')).ok}catch{}
  if(!okay){
   server=spawn('python3',['-m','http.server','8793','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<70;i++){
    try{okay=(await fetch(base+'/')).ok;if(okay)break}catch{}
    await wait(200);
   }
  }
  check(okay,'No local built GIS site available');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const {slug,src,dst,scenario} of scenarios){
  await test(slug+'_'+scenario,async()=>{
   const page=await browser.newPage({acceptDownloads:true});
   page.on('pageerror',e=>report.browserErrors.push(String(e)));
   try{
    const response=await page.goto(base+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:50000});
    check(response?.ok(),'Converter page unavailable');
    const available=await page.locator('#sample-scenario option').evaluateAll(options=>options.map(o=>o.value));
    check(available.includes('point')&&available.includes(scenario),
     'Route scenario selector missing compatible type');
    if(dst==='csv'||src==='csv')check(available.length===1,
     'CSV route incorrectly advertised geometry which cannot preserve');
    await page.locator('#sample-scenario').selectOption(scenario);
    await page.locator('#load-sample').click();
    await page.waitForFunction(()=>document.querySelector('#file')?.files.length===1,
     undefined,{timeout:20000});
    const chosen=await page.locator('#file').evaluate(input=>({
     name:input.files[0].name,bytes:input.files[0].size
    }));
    check(chosen.bytes>0&&chosen.bytes<16384,'Example exceeded 16 KiB bound');
    check(chosen.name.startsWith('gis-example-'+scenario+'.'),
     'Wrong geometry example attached');
    check((await page.locator('#sample-help').innerText()).includes('Click Convert'),
     'Example instructions not actionable');
    check(await page.locator('#result').isHidden(),'Loading sample automatically converted it');
    await page.locator('#submit').click();
    try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
    catch{throw Error('Real GDAL conversion failed: '+await page.locator('#error').textContent())}
    const output=await download(page,'#download');
    const geometry=await verify(output,dst,scenario);
    const quality=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
    const countCheck=quality.checks?.find(c=>c.id==='feature-count');
    check(countCheck&&['pass','unavailable','review'].includes(countCheck.status),
     'Actual output has no valid structural feature-count assessment');
    // GDAL/KML/GPX layers cannot always yield comparable count semantics.
    // The independently decoded actual output geometry is the substantive
    // evidence; report inconclusive checks honestly, never mislabel pass.
    const fidelity=quality.checks?.find(c=>c.id==='complex-geometry-values');
    if(['kml','kmz','shp','geojson'].includes(src)&&
       ['kml','kmz','shp','geojson'].includes(dst))
      check(fidelity&&['pass','unavailable','review'].includes(fidelity.status),
       'Expected complex GIS fidelity check is missing');
    return {src,dst,scenario,inputBytes:chosen.bytes,outputBytes:output.length,
     reportStatus:quality.status,featureCountAssessment:countCheck.status,
     complexGeometryAssessment:fidelity?.status||'not-applicable',...geometry};
    return {src,dst,scenario,inputBytes:chosen.bytes,outputBytes:output.length,
     reportStatus:quality.status,...geometry};
   }finally{await page.close()}
  });
 }
 await test('webkit_touch_polygon_hole_geometry',async()=>{
  webKit=await webkit.launch({headless:true});
  const context=await webKit.newContext({viewport:{width:390,height:844},
   deviceScaleFactor:2,isMobile:true,hasTouch:true,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push('WebKit: '+String(e)));
  try{
   await page.goto(base+'/converter/geojson-to-shp/',{waitUntil:'domcontentloaded'});
   await page.locator('#sample-scenario').selectOption('polygon');
   await page.locator('#load-sample').click();
   await page.waitForFunction(()=>document.querySelector('#file')?.files.length===1,
    undefined,{timeout:15000});
   await page.locator('#submit').click();
   try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
   catch{throw Error('WebKit polygon conversion failed: '+await page.locator('#error').textContent())}
   const result=await verify(await download(page,'#download'),'shp','polygon');
   return {engine:'WebKit',touch:true,holes:result.holes,polygonVertices:result.vertices};
  }finally{await context.close()}
 });
 report.status=report.cases.length===report.expected&&
  report.cases.every(c=>c.status==='PASSED')&&report.browserErrors.length===0?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,1600)}
finally{
 await webKit?.close();await browser?.close();server?.kill();
 fs.writeFileSync(evidence,JSON.stringify(report,null,2));
 console.log('P47_SCENARIO_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.cases.filter(c=>c.status==='PASSED').length,
  expected:report.expected,failed:report.cases.filter(c=>c.status!=='PASSED').map(c=>c.name),
  pageErrors:report.browserErrors,fatal:report.fatal
 }));
}
if(report.status!=='PASSED')process.exitCode=1;
