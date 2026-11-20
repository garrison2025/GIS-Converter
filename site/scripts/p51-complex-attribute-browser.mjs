/**
 * P51 real browser GDAL / isolated Worker checks complex line / polygon
 * feature-to-attribute integrity, using only synthetic GIS fixtures.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8792').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const output=local?'p51-complex-attribute-browser-local.json':'p51-complex-attribute-browser-public.json';
const report={kind:'p51-complex-geometry-attribute-join',origin:base,status:'FAILED',
 expected:9,verified:0,cases:[],note:'Synthetic GIS attributes only, raw values excluded from evidence'};
let browser,server;
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const check=(condition,message)=>{if(!condition)throw Error(message)};
const geo=features=>Buffer.from(JSON.stringify({type:'FeatureCollection',features:features.map(f=>({
 type:'Feature',properties:f.props,geometry:{type:f.type,coordinates:f.coords}
}))}));
const lineA=[[116.4,39.9],[116.45,39.95],[116.5,40]];
const lineB=[[117.1,39.3],[117.12,39.33],[117.14,39.35]];
const outer=[[116.4,39.9],[116.4,40],[116.5,40],[116.5,39.9],[116.4,39.9]];
const hole=[[116.425,39.925],[116.475,39.925],[116.475,39.975],[116.425,39.975],[116.425,39.925]];
const fixtures={
 simpleLine:geo([{type:'LineString',coords:lineA,props:{Name:'Line A'}}]),
 twoLines:geo([{type:'LineString',coords:lineA,props:{Name:'Line A',Code:'A-001'}},
  {type:'LineString',coords:lineB,props:{Name:'Line B',Code:'B-002'}}]),
 multiLine:geo([{type:'MultiLineString',coords:[lineA,lineB],props:{Name:'Multi-track',Code:'R-007'}}]),
 polygon:geo([{type:'Polygon',coords:[outer,hole],props:{Name:'Parcel A',Code:'P-100'}}]),
 twoPolygons:geo([{type:'Polygon',coords:[outer,hole],props:{Name:'Parcel A',Code:'P-100'}},
  {type:'Polygon',coords:[[[118,39],[118,40],[119,40],[119,39],[118,39]]],
  props:{Name:'Parcel B',Code:'P-200'}}])
};
async function download(page,selector){
 const [item]=await Promise.all([page.waitForEvent('download',{timeout:24000}),
  page.locator(selector).click()]);
 return fs.readFileSync(await item.path());
}
async function convert(page,route,fixture){
 const res=await page.goto(base+'/converter/'+route+'/',{waitUntil:'domcontentloaded',timeout:45000});
 check(res?.ok(),'Converter route unavailable');
 const file=fixture.bytes?fixture:await fixture();
 await page.locator('#file').setInputFiles({name:file.name,
  mimeType:file.mimeType||'application/octet-stream',buffer:Buffer.from(file.bytes)});
 await page.locator('#submit').click();
 await Promise.race([
  page.locator('#result').waitFor({state:'visible',timeout:120000}).catch(()=>{}),
  page.locator('#error').waitFor({state:'visible',timeout:120000}).catch(()=>{})
 ]);
 if(!await page.locator('#result').isVisible()){
  check(await page.locator('#recovery-panel').getAttribute('data-guidance')==='data-loss',
   'Conversion rejected without critical data loss guidance');
  check(await page.locator('#result').isHidden(),'Rejected output available for download');
  return {outcome:'withheld-on-data-loss'};
 }
 const q=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
 const attr=q.checks?.find(c=>c.id==='complex-feature-attributes');
 check(Boolean(attr),'P51 complex geometry field association check missing');
 check(attr.status!=='review','Confirmed complex attribute loss was downloadable');
 const geometry=q.checks?.find(c=>c.id==='complex-geometry-values');
 check(geometry?.status!=='review','Confirmed complex geometry loss was downloadable');
 // A nonempty download must still be available after the report inspection.
 const fileBytes=await download(page,'#download');
 check(fileBytes.length>100,'Output file unexpectedly empty');
 if(attr.status==='pass')report.verified++;
 return {outcome:attr.status==='pass'?'independently-verified':'delivered-with-uncertainty',
  attribute:attr.status,geometry:geometry?.status||'unavailable'};
}
async function test(name,route,fixture){
 const row={name,status:'FAILED'};report.cases.push(row);
 const page=await browser.newPage({acceptDownloads:true});
 try{
  Object.assign(row,await convert(page,route,fixture),{status:'PASSED'});
  console.log('P51_BROWSER '+name+' PASSED');
 }catch(e){row.error=String(e?.stack||e).slice(0,900);
  console.error('P51_BROWSER '+name+' FAILED '+row.error);
 }finally{await page.close()}
}
const named=(name,bytes,mimeType)=>({name,bytes,mimeType});
const sample=async(source,scenario)=>{
 const f=await makeScenarioGISFile(source,scenario);
 return named(f.name,await f.arrayBuffer(),f.type);
};
try{
 if(local){
  let ready=false;
  try{ready=(await fetch(base+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8792','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<80;i++){
    try{ready=(await fetch(base+'/')).ok;if(ready)break}catch{}
    await wait(220);
   }
  }
  check(ready,'Local build unavailable');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await test('simple_named_line_GeoJSON_to_KML','geojson-to-kml',
  named('line.geojson',fixtures.simpleLine,'application/geo+json'));
 await test('two_distinct_lines_GeoJSON_to_KML','geojson-to-kml',
  named('twolines.geojson',fixtures.twoLines,'application/geo+json'));
 await test('two_polygons_with_hole_GeoJSON_to_KML','geojson-to-kml',
  named('polygons.geojson',fixtures.twoPolygons,'application/geo+json'));
 await test('multipart_line_GeoJSON_to_KML','geojson-to-kml',
  named('multiline.geojson',fixtures.multiLine,'application/geo+json'));
 await test('polygon_with_hole_GeoJSON_to_SHP','geojson-to-shp',
  named('polygon.geojson',fixtures.polygon,'application/geo+json'));
 await test('native_SHP_line_to_GeoJSON','shp-to-geojson',()=>sample('shp','line'));
 await test('native_SHP_polygon_to_KML','shp-to-kml',()=>sample('shp','polygon'));
 await test('KML_line_to_GeoJSON','kml-to-geojson',()=>sample('kml','line'));
 await test('KMZ_polygon_to_GeoJSON','kmz-to-geojson',()=>sample('kmz','polygon'));
 report.status=report.cases.length===report.expected&&
  report.cases.every(x=>x.status==='PASSED')&&report.verified>=1?'PASSED':'FAILED';
 if(report.verified<1)report.error='No real complex geometry field association was independently verified';
}catch(e){report.error=String(e?.stack||e).slice(0,1100)}
finally{
 await browser?.close();
 if(server)server.kill();
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log('P51_BROWSER_REPORT '+JSON.stringify({status:report.status,
  passed:report.cases.filter(x=>x.status==='PASSED').length,expected:report.expected,verified:report.verified}));
}
if(report.status!=='PASSED')process.exitCode=1;
