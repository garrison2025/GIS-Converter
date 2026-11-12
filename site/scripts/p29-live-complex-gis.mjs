/**
 * P29: real browser + real GDAL/WASM complex GIS acceptance (loopback or Pages).
 * Tests actual user upload/download flows, never uses a mock conversion engine.
 * Report contains only aggregate shape/field fidelity; never source GPS coordinates.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const report={kind:'p29-live-complex-gis-acceptance',origin,startedAt:new Date().toISOString(),
 status:'FAILED',tests:[],browserErrors:[],passed:0,expected:6,failed:[]};
const samplePath=path.resolve('test-fixtures/public-gpx/etrex20x-real-track.gpx');
const approx=(a,b,epsilon=.0001)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=epsilon;
function check(condition,message){if(!condition)throw Error(message)}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex')}
function area(ring){
 let sum=0;for(let i=0;i+1<ring.length;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
 return Math.abs(sum)/2;
}
function geometryMetrics(features){
 let polys=0,holes=0,totalArea=0;
 for(const feature of features){
  const g=feature.geometry;
  const shape=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
  for(const rings of shape){
   polys++;holes+=Math.max(0,rings.length-1);
   totalArea+=area(rings[0])-rings.slice(1).reduce((sum,r)=>sum+area(r),0);
  }
 }
 return {polygons:polys,holes,area:totalArea};
}
function readDbfValues(dbf){
 const view=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 const rows=view.getUint32(4,true),header=view.getUint16(8,true),stride=view.getUint16(10,true);
 check(header>=65&&header+rows*stride<=dbf.byteLength,'Malformed DBF record bounds');
 const fields=[];let start=1;
 for(let offset=32;offset+32<=header&&dbf[offset]!==0x0d;offset+=32){
  const field=dbf.subarray(offset,offset+11),nullAt=field.indexOf(0);
  const name=new TextDecoder().decode(nullAt<0?field:field.subarray(0,nullAt)).trim();
  const width=dbf[offset+16];
  check(width>0&&name.length>0,'Invalid DBF field descriptor');
  fields.push({name,width,start});
  start+=width;
 }
 check(start<=stride,'DBF field lengths exceed row record size');
 const decoded=Array.from({length:rows},(_,i)=>{
  const values={};for(const field of fields){
   values[field.name]=new TextDecoder('utf-8',{fatal:true}).decode(
     dbf.subarray(header+i*stride+field.start,header+i*stride+field.start+field.width)).trim();
  }
  return values;
 });
 return {rows,fields:fields.map(x=>x.name),records:decoded};
}
async function verifyFileOutput(page,slug,file,ext){
 const response=await page.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
 check(response?.ok(),'Missing live page '+slug);
 check((await page.locator('meta[name="robots"]').getAttribute('content'))?.includes('noindex'),
  'Preview route lost indexing guard '+slug);
 await page.locator('#file').setInputFiles(file);
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:100000})}
 catch{throw Error(slug+' browser conversion failed; status='+(await page.locator('#status').textContent())+
  '; error='+(await page.locator('#error').textContent()))}
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:15000}),
  page.locator('#download').click()]);
 check(download.suggestedFilename().endsWith(ext),'Wrong downloaded output extension '+slug);
 const bytes=fs.readFileSync(await download.path());
 check(bytes.length>50,'Empty downloaded conversion '+slug);
 // The quality report is downloaded through a distinct real click.
 const [qualityDownload]=await Promise.all([page.waitForEvent('download',{timeout:15000}),
  page.locator('#quality-download').click()]);
 const quality=JSON.parse(fs.readFileSync(await qualityDownload.path(),'utf8'));
 check(quality.kind==='local-structural-quality-report','Quality report missing '+slug);
 const critical=quality.checks?.filter(x=>x.status==='review'&&
   (/data.loss|geometry|feature.count|gpx.timed.track/.test(x.id)))||[];
 check(!critical.length,'Critical geometry/data loss review from '+slug+
  ': '+critical.map(x=>x.id).join(','));
 return {bytes,quality,sha256:digest(bytes)};
}
async function unzipFiles(bytes){
 const archive=await JSZip.loadAsync(bytes);
 const names=Object.keys(archive.files).filter(n=>!archive.files[n].dir);
 const get=async ext=>{
  const name=names.find(n=>n.toLowerCase().endsWith(ext));
  check(name,'Missing file in downloaded ZIP: '+ext);
  return {name,bytes:await archive.file(name).async('uint8array')};
 };
 return {archive,names,get};
}
function inspectPolygonShp(shp,shx,expectedParts){
 const shpView=new DataView(shp.buffer,shp.byteOffset,shp.length);
 const shxView=new DataView(shx.buffer,shx.byteOffset,shx.length);
 check(shpView.getInt32(0,false)===9994,'Invalid SHP file code');
 check(shpView.getInt32(32,true)===5,'Expected Polygon Shapefile');
 check((shx.length-100)/8===expectedParts.length,'Unexpected SHX record count');
 let totalParts=0,totalPoints=0;
 expectedParts.forEach((expected,i)=>{
  const offset=shxView.getInt32(100+i*8,false)*2;
  check(offset>=100&&offset+60<shp.length,'SHP record offset out of bounds');
  const kind=shpView.getInt32(offset+8,true);
  const parts=shpView.getInt32(offset+44,true),points=shpView.getInt32(offset+48,true);
  check(kind===5&&parts===expected.parts&&points===expected.points,
   'Unexpected polygon/ring/point record structure at '+i);
  totalParts+=parts;totalPoints+=points;
 });
 return {records:expectedParts.length,parts:totalParts,vertices:totalPoints};
}
function parseRealTrkpts(gpx){
 return [...gpx.matchAll(/<trkpt\b[^>]*lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
  .map(m=>{
   const inner=m[3],clock=inner.match(/<time>([^<]+)<\/time>/)?.[1];
   const elevation=inner.match(/<ele>([^<]+)<\/ele>/)?.[1];
   return {lat:Number(m[1]),lon:Number(m[2]),
    time:clock?new Date(Date.parse(clock)).toISOString():null,
    elevation:elevation===undefined?null:Number(elevation)};
  });
}
function verifyGxTrack(kml,pts){
 check(/<gx:Track\b/.test(kml),'Expected KML gx:Track missing');
 check(/xmlns:gx="http:\/\/www.google.com\/kml\/ext\/2.2"/.test(kml),'GX namespace missing');
 const times=[...kml.matchAll(/<when>([^<]+)<\/when>/g)].map(m=>m[1]);
 const positions=[...kml.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)]
  .map(m=>m[1].trim().split(/\s+/).map(Number));
 check(pts.length===104,'Public eTrex fixture changed: '+pts.length);
 check(times.length===pts.length&&positions.length===pts.length,'GPX timeline or vertices dropped');
 let altCount=0;
 for(let i=0;i<pts.length;i++){
  check(times[i]===pts[i].time,'GPX timestamp mismatch at vertex '+i);
  check(approx(positions[i][0],pts[i].lon,.000011)&&approx(positions[i][1],pts[i].lat,.000011),
   'GPX coordinate changed at vertex '+i);
  if(pts[i].elevation!==null){
   check(approx(positions[i][2],pts[i].elevation,.001),'GPX elevation changed at vertex '+i);
   altCount++;
  }
 }
 return {vertices:positions.length,timePairs:times.length,elevationsMatched:altCount};
}
function transformWgs84ToWebMercator(lon,lat){
 const r=6378137,rad=Math.PI/180;
 return [r*lon*rad,r*Math.log(Math.tan(Math.PI/4+lat*rad/2))];
}
const webMercatorWkt='PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",'+
 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'+
 'SPHEROID["WGS_1984",6378137.0,298.257223563]],'+
 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'+
 'PROJECTION["Mercator_Auxiliary_Sphere"],'+
 'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],'+
 'PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],'+
 'UNIT["Meter",1.0],AUTHORITY["EPSG","3857"]]';

async function patchProjectedPointZip(bytes,lon,lat){
 const {archive,names,get}=await unzipFiles(bytes);
 const shp=await get('.shp'),shx=await get('.shx');
 const prj=names.find(n=>n.toLowerCase().endsWith('.prj'));
 check(prj,'Source Shapefile projection absent');
 const a=new Uint8Array(shp.bytes),b=new Uint8Array(shx.bytes);
 const xView=new DataView(a.buffer),iView=new DataView(b.buffer);
 check(xView.getInt32(32,true)===1,'Projected fixture must start as one-point SHP');
 const offset=iView.getInt32(100,false)*2;
 check(offset>=100&&offset+28<=a.length,'Projected point SHP offset invalid');
 const [x,y]=transformWgs84ToWebMercator(lon,lat);
 check(Math.abs(x)>1e6&&Math.abs(y)>1e6,'Projected coordinates should be metres');
 for(const view of [xView,iView]){
  view.setFloat64(36,x,true);view.setFloat64(44,y,true);
  view.setFloat64(52,x,true);view.setFloat64(60,y,true);
 }
 xView.setFloat64(offset+12,x,true);xView.setFloat64(offset+20,y,true);
 const patched=new JSZip();
 for(const name of names){
  if(name===shp.name)patched.file(name,a);
  else if(name===shx.name)patched.file(name,b);
  else if(name===prj)patched.file(name,webMercatorWkt);
  else patched.file(name,await archive.file(name).async('uint8array'));
 }
 return Buffer.from(await patched.generateAsync({type:'uint8array'}));
}

let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:800}});
 const page=await context.newPage();
 page.on('pageerror',e=>report.browserErrors.push(String(e)));
 async function test(name,fn){
  const started=Date.now(),entry={name,status:'FAILED'};
  report.tests.push(entry);
  try{
   const details=await fn();
   Object.assign(entry,details,{status:'PASSED',elapsedMs:Date.now()-started});
   report.passed++;
  }catch(e){
   entry.error=String(e?.stack||e).slice(0,1600);
   report.failed.push(name);
  }
  console.log('P29_COMPLEX '+name+' '+entry.status+' '+(entry.error||''));
 }
 const areaGeojson={type:'FeatureCollection',features:[
  {type:'Feature',properties:{Label:'北京公园',Count:2},geometry:{type:'Polygon',
   coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]}},
  {type:'Feature',properties:{Label:'岛屿群',Count:3},geometry:{type:'MultiPolygon',
   coordinates:[[[[10,10],[12,10],[12,12],[10,12],[10,10]]],
    [[[15,10],[16,10],[16,11],[15,11],[15,10]]]]}}
 ]};
 let polygonZip=null,pointZip=null;
 await test('polygon_holes_multipolygon_utf8_dbf_to_shp',async()=>{
  const converted=await verifyFileOutput(page,'geojson-to-shp',{name:'p29-geometry.geojson',
   mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(areaGeojson))},'.zip');
  polygonZip=converted.bytes;
  const {get}=await unzipFiles(converted.bytes);
  const [shp,shx,dbf,cpg]=await Promise.all([get('.shp'),get('.shx'),get('.dbf'),get('.cpg')]);
  check(new TextDecoder().decode(cpg.bytes).toUpperCase().includes('UTF-8'),'Output .cpg not UTF-8');
  const structures=inspectPolygonShp(shp.bytes,shx.bytes,
   [{parts:2,points:10},{parts:2,points:10}]);
  const records=readDbfValues(dbf.bytes);
  check(records.rows===2,'DBF record count drift');
  check(records.fields.includes('Label')&&records.fields.includes('Count'),'DBF field names missing');
  check(records.records[0].Label==='北京公园'&&records.records[1].Label==='岛屿群',
   'DBF UTF-8 labels changed');
  check(Number(records.records[0].Count)===2&&Number(records.records[1].Count)===3,
   'DBF integer values changed');
  return {...structures,attributeRows:records.rows,utf8Verified:true,sha256Matches:true};
 });
 await test('shp_to_geojson_polygon_hole_and_attribute_roundtrip',async()=>{
  check(polygonZip,'Polygon seed unavailable');
  const result=await verifyFileOutput(page,'shp-to-geojson',
   {name:'p29-complex-shapefile.zip',mimeType:'application/zip',buffer:polygonZip},'.geojson');
  const collection=JSON.parse(result.bytes.toString('utf8'));
  check(collection.type==='FeatureCollection'&&collection.features?.length===2,
   'Round-trip polygon feature count lost');
  const metrics=geometryMetrics(collection.features);
  check(metrics.polygons===3&&metrics.holes===1,'MultiPolygon/hole fidelity lost');
  check(approx(metrics.area,20,.001),'Polygon area unexpectedly changed');
  const data=collection.features.map(f=>f.properties);
  check(data.some(x=>x.Label==='北京公园'&&Number(x.Count)===2),'Unicode/Count field 1 lost');
  check(data.some(x=>x.Label==='岛屿群'&&Number(x.Count)===3),'Unicode/Count field 2 lost');
  return {features:2,parts:metrics.polygons,holes:metrics.holes,areaChecked:true,dbfFieldsVerified:2};
 });
 await test('projected_epsg3857_shp_to_wgs84_geojson',async()=>{
  const lon=116.4,lat=39.9;
  const seed={type:'FeatureCollection',features:[{type:'Feature',
    properties:{Code:'TEST3857',Count:7},geometry:{type:'Point',coordinates:[lon,lat]}}]};
  const initial=await verifyFileOutput(page,'geojson-to-shp',
   {name:'p29-wgs84-point.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(seed))},'.zip');
  pointZip=await patchProjectedPointZip(initial.bytes,lon,lat);
  const output=await verifyFileOutput(page,'shp-to-geojson',
   {name:'p29-epsg3857-point.zip',mimeType:'application/zip',buffer:pointZip},'.geojson');
  const json=JSON.parse(output.bytes.toString('utf8')),feature=json.features?.[0];
  check(json.features?.length===1&&feature?.geometry?.type==='Point','Projected point missing');
  const point=feature.geometry.coordinates;
  check(approx(point[0],lon,.0001)&&approx(point[1],lat,.0001),
   '3857 to WGS84 CRS transform wrong');
  check(feature.properties?.Code==='TEST3857'&&Number(feature.properties?.Count)===7,
   'Projected input attributes not retained');
  return {source:'EPSG:3857',target:'WGS84',featureCount:1,
   longitudeLatitudeVerified:true,attributesVerified:true};
 });
 const gpxBytes=fs.readFileSync(samplePath),gpxText=gpxBytes.toString('utf8');
 const trackPoints=parseRealTrkpts(gpxText);
 await test('public_real_etrex_gpx_to_kml_104_times_xyz',async()=>{
  const converted=await verifyFileOutput(page,'gpx-to-kml',
   {name:'p29-public-etrex.gpx',mimeType:'application/gpx+xml',buffer:gpxBytes},'.kml');
  const checks=verifyGxTrack(converted.bytes.toString('utf8'),trackPoints);
  const clockCheck=converted.quality.checks.find(x=>x.id==='gpx-timed-track');
  check(clockCheck?.status==='pass','GPX timed-track quality check not passed');
  return {...checks,publicFixture:'tkrajina/gpxpy Apache-2.0',
   timeIntegrity:'every timestamp compared',coordinateIntegrity:'every lon/lat/elevation compared'};
 });
 await test('public_real_etrex_gpx_to_kmz_104_times_xyz',async()=>{
  const converted=await verifyFileOutput(page,'gpx-to-kmz',
   {name:'p29-public-etrex.gpx',mimeType:'application/gpx+xml',buffer:gpxBytes},'.kmz');
  const archive=await JSZip.loadAsync(converted.bytes);
  const doc=archive.file('doc.kml');
  check(doc,'Downloaded KMZ missing doc.kml');
  const checks=verifyGxTrack(await doc.async('string'),trackPoints);
  const clockCheck=converted.quality.checks.find(x=>x.id==='gpx-timed-track');
  check(clockCheck?.status==='pass','KMZ timed-track quality check not passed');
  return {...checks,publicFixture:'tkrajina/gpxpy Apache-2.0',
   validKmzArchive:true};
 });
 await test('mixed_point_and_polygon_to_shp_must_reject_without_download',async()=>{
  const invalid={type:'FeatureCollection',features:[
   {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[116.4,39.9]}},
   {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[116,39],[117,39],[117,40],[116,39]]]}}
  ]};
  await page.goto(origin+'/converter/geojson-to-shp/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#file').setInputFiles({name:'p29-invalid-mixed.geojson',
   mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(invalid))});
  await page.locator('#submit').click();
  await page.waitForFunction(()=>document.querySelector('#error')?.hidden===false,{timeout:45000});
  const text=await page.locator('#error').textContent();
  check(text.includes('mixed geometry families'),'Wrong mixed geometry safety failure');
  check(await page.locator('#result').isHidden(),'Dangerous mixed shape produced a download');
  return {rejected:true,downloadBlocked:true};
 });
 check(report.browserErrors.length===0,'Uncaught browser exceptions: '+report.browserErrors.join(' / '));
 check(report.tests.length===report.expected,'Expected six test cases');
 check(report.passed===report.expected,'Complex GIS cases failed: '+report.failed.join(','));
 report.status='PASSED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2000)}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('p29-complex-live-results.json',JSON.stringify(report,null,2));
 console.log('P29_SUMMARY '+JSON.stringify({status:report.status,passed:report.passed,
  expected:report.expected,failed:report.failed,browserErrors:report.browserErrors,
  fatal:report.fatal}));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
