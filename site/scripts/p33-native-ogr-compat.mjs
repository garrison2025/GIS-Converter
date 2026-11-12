/**
 * P33: Native GDAL/OGR is a second, separately installed GIS runtime used as
 * an output reader and an input fixture producer for the actual browser GDAL
 * WebAssembly site. Not QGIS GUI, not Google Earth Pro, not mobile hardware.
 *
 * All files are synthetic except a previously approved public Apache-2.0 GPX.
 * Reports never contain original track positions or timestamps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {chromium} from 'playwright';

const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const local=/^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
const filename=local?'p33-native-local-results.json':'p33-native-live-results.json';
const report={kind:'p33-native-ogr-interoperability',origin,
 mode:local?'local-wrangler':'public-cloudflare',
 startedAt:new Date().toISOString(),status:'FAILED',expected:6,passed:0,
 cases:[],failed:[],browserErrors:[],nativeOgrVersion:null};
const work=fs.mkdtempSync(path.join(os.tmpdir(),'gis-p33-'));
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const approx=(a,b,e=.0001)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=e;
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
function cli(tool,args,{env={}}={}){
 try{
  return execFileSync(tool,args,{encoding:'utf8',cwd:work,timeout:60000,
   maxBuffer:8*1024*1024,env:{...process.env,SHAPE_ENCODING:'UTF-8',...env}});
 }catch(e){
  throw Error('Native '+tool+' failed (exit '+e.status+'): '+(e.stderr?.toString()||e.message).slice(0,600));
 }
}
function make(file,data){
 const dest=path.join(work,file);
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,data);
 return dest;
}
function nativeRead(source,{layer=null,transform=null}={}){
 const args=['-f','GeoJSON','/vsistdout/',source];
 if(layer)args.push(layer);
 if(transform)args.push('-t_srs',transform);
 const json=JSON.parse(cli('ogr2ogr',args));
 assert(json.type==='FeatureCollection'&&Array.isArray(json.features),
  'Native OGR did not produce a GeoJSON FeatureCollection');
 return json;
}
async function zipShapefile(shp){
 const base=shp.slice(0,-4),archive=new JSZip();
 for(const ext of ['shp','shx','dbf','prj','cpg']){
  const file=base+'.'+ext;
  if(ext!=='cpg')assert(fs.existsSync(file),'Missing native SHP companion '+ext);
  if(fs.existsSync(file))archive.file(path.basename(file),fs.readFileSync(file));
 }
 return Buffer.from(await archive.generateAsync({type:'uint8array',compression:'DEFLATE'}));
}
async function extractShapefile(bytes,prefix){
 const zip=await JSZip.loadAsync(bytes),names=Object.keys(zip.files).filter(x=>!zip.files[x].dir);
 const root=path.join(work,prefix);
 fs.mkdirSync(root,{recursive:true});
 let shapefile=null;
 for(const name of names){
  const base=path.basename(name);
  assert(base===name&&/^[a-zA-Z0-9_.-]+$/.test(base),'Unsafe SHP archive entry');
  const dest=path.join(root,base);
  fs.writeFileSync(dest,await zip.file(name).async('nodebuffer'));
  if(base.toLowerCase().endsWith('.shp'))shapefile=dest;
 }
 assert(shapefile,'Downloaded ZIP contains no .shp file');
 for(const ext of ['.shx','.dbf','.prj']){
  assert(fs.existsSync(shapefile.slice(0,-4)+ext),'Downloaded Shapefile missing '+ext);
 }
 return shapefile;
}
function scanPolygon(features){
 const rings={parts:0,holes:0,area:0};
 const ringArea=points=>{
  let total=0;
  for(let i=0;i+1<points.length;i++)
   total+=points[i][0]*points[i+1][1]-points[i+1][0]*points[i][1];
  return Math.abs(total)/2;
 };
 for(const f of features){
  const g=f.geometry,areas=g?.type==='MultiPolygon'?g.coordinates:
   g?.type==='Polygon'?[g.coordinates]:[];
  for(const polygon of areas){
   rings.parts++;rings.holes+=Math.max(0,polygon.length-1);
   rings.area+=ringArea(polygon[0])-polygon.slice(1).reduce((a,v)=>a+ringArea(v),0);
  }
 }
 return rings;
}
async function unzipKml(bytes,prefix){
 const zip=await JSZip.loadAsync(bytes);
 const doc=zip.file('doc.kml');
 assert(doc,'Actual KMZ missing doc.kml');
 const text=await doc.async('string');
 return {xml:text,file:make(prefix+'.kml',text),archiveCount:Object.keys(zip.files).length};
}
function checkPointFeatures(features,expected,name){
 assert(features.length===expected.length,name+': wrong feature count '+features.length);
 const found=features.map(f=>f.geometry).filter(x=>x?.type==='Point').map(x=>x.coordinates);
 assert(found.length===expected.length,name+': not all data are geographic point features');
 for(const [lon,lat] of expected){
  assert(found.some(p=>approx(p[0],lon)&&approx(p[1],lat)),
   name+': expected geographic point not found');
 }
 return {features:found.length,pointCoordinatesVerified:true};
}
async function convert(page,slug,input,targetExt){
 const response=await page.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
 assert(response?.ok(),'Cannot visit '+slug);
 assert((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow',
  'Preview SEO indexing protection changed');
 await page.locator('#file').setInputFiles(input);
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:110000})}
 catch{throw Error(slug+' failed '+(await page.locator('#status').textContent())+
  ' / '+(await page.locator('#error').textContent()))}
 const [download]=await Promise.all([
  page.waitForEvent('download',{timeout:20000}),
  page.locator('#download').click()
 ]);
 assert(download.suggestedFilename().endsWith(targetExt),
  'Wrong native compatibility fixture extension for '+slug);
 const bytes=fs.readFileSync(await download.path());
 assert(bytes.length>50,slug+' produced empty download');
 const [qdl]=await Promise.all([
  page.waitForEvent('download',{timeout:20000}),
  page.locator('#quality-download').click()
 ]);
 const quality=JSON.parse(fs.readFileSync(await qdl.path(),'utf8'));
 assert(quality.kind==='local-structural-quality-report',
  'Browser download did not contain valid quality report');
 return {bytes,sha256:hash(bytes),qualityStatus:quality.status};
}
async function runCase(name,fn){
 const entry={name,status:'FAILED'};
 report.cases.push(entry);
 const start=Date.now();
 try{
  Object.assign(entry,await fn(),{status:'PASSED',durationMs:Date.now()-start});
  report.passed++;
 }catch(e){
  entry.error=String(e?.stack||e).slice(0,1300);
  report.failed.push(name);
 }
 console.log('P33_NATIVE '+name+' '+entry.status+' '+(entry.error||''));
}
let browser;
try{
 report.nativeOgrVersion=cli('ogrinfo',['--version']).trim();
 assert(/GDAL\s+\d+/.test(report.nativeOgrVersion),'Native GDAL CLI is not installed');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',e=>report.browserErrors.push(String(e)));
 const areaGeojson={type:'FeatureCollection',features:[
  {type:'Feature',properties:{Label:'公园内环',Count:2},geometry:{type:'Polygon',
   coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]}},
  {type:'Feature',properties:{Label:'两个岛屿',Count:3},geometry:{type:'MultiPolygon',
   coordinates:[[[[10,10],[12,10],[12,12],[10,12],[10,10]]],
    [[[15,10],[16,10],[16,11],[15,11],[15,10]]]]}}
 ]};
 await runCase('native_ogr_opens_browser_generated_shapefile_polygon_holes_utf8',async()=>{
  const converted=await convert(page,'geojson-to-shp',
   {name:'p33-polygon.geojson',mimeType:'application/geo+json',
    buffer:Buffer.from(JSON.stringify(areaGeojson))},'.zip');
  const shp=await extractShapefile(converted.bytes,'browser-polygon');
  const json=nativeRead(shp,{transform:'EPSG:4326'});
  assert(json.features.length===2,'Native OGR cannot open both SHP features');
  const metrics=scanPolygon(json.features);
  assert(metrics.parts===3&&metrics.holes===1&&approx(metrics.area,20,.001),
   'Native OGR polygon hole / multipolygon or area mismatch '+JSON.stringify(metrics));
  assert(json.features.some(f=>f.properties?.Label==='公园内环'&&Number(f.properties.Count)===2),
   'Native OGR could not decode first UTF-8 DBF attribute');
  assert(json.features.some(f=>f.properties?.Label==='两个岛屿'&&Number(f.properties.Count)===3),
   'Native OGR could not decode second UTF-8 DBF attribute');
  return {nativeReader:'ogr2ogr',featureCount:2,parts:3,holes:1,utf8Dbf:true,sha256:converted.sha256};
 });
 await runCase('native_created_epsg3857_shapefile_is_reprojected_by_browser_to_wgs84',async()=>{
  const point={type:'FeatureCollection',features:[{type:'Feature',
   properties:{Code:7,Label:'原生投影'},geometry:{type:'Point',coordinates:[116.4,39.9]}}]};
  const input=make('native-3857-source.geojson',JSON.stringify(point));
  const shp=path.join(work,'native-projected.shp');
  cli('ogr2ogr',['-f','ESRI Shapefile',shp,input,
   '-s_srs','EPSG:4326','-t_srs','EPSG:3857','-lco','ENCODING=UTF-8']);
  const projected=nativeRead(shp);
  const coords=projected.features[0]?.geometry?.coordinates;
  assert(Math.abs(coords?.[0])>1e6&&Math.abs(coords?.[1])>1e6,
   'Native-created 3857 fixture contains unprojected coordinates');
  const archive=await zipShapefile(shp);
  const converted=await convert(page,'shp-to-geojson',
   {name:'p33-native-projected.zip',mimeType:'application/zip',buffer:archive},'.geojson');
  const output=make('p33-wgs84-result.geojson',converted.bytes);
  const parsed=nativeRead(output);
  const f=parsed.features[0],actual=f?.geometry?.coordinates;
  assert(parsed.features.length===1&&approx(actual?.[0],116.4)&&approx(actual?.[1],39.9),
   'Native OGR could not read correctly reprojected WGS84 website output');
  assert(f.properties?.Label==='原生投影'&&Number(f.properties?.Code)===7,
   'Native OGR detected loss of projected point attributes');
  return {nativeProducer:'ogr2ogr EPSG:3857',websiteOutput:'GeoJSON EPSG:4326',
   nativeConsumer:'ogr2ogr',attributeFidelity:true,sha256:converted.sha256};
 });
 const kmlText='<?xml version="1.0" encoding="UTF-8"?>'+
  '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+
  '<Placemark><name>Sample One</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark>'+
  '<Placemark><name>Sample Two</name><Point><coordinates>114.1,22.5,0</coordinates></Point></Placemark>'+
  '</Document></kml>';
 await runCase('native_ogr_reads_browser_kml_to_kmz_extracted_document',async()=>{
  const converted=await convert(page,'kml-to-kmz',
   {name:'p33-two-points.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kmlText)},'.kmz');
  const doc=await unzipKml(converted.bytes,'p33-kmz-doc');
  const native=nativeRead(doc.file);
  const features=checkPointFeatures(native.features,[[116.4,39.9],[114.1,22.5]],'Native KML doc');
  return {...features,kmzFiles:doc.archiveCount,consumer:'Native OGR KML driver',
   sha256:converted.sha256};
 });
 await runCase('native_ogr_reads_browser_csv_to_kml_with_two_points',async()=>{
  const csv=Buffer.from('longitude,latitude,Name\n116.4,39.9,一号点\n114.1,22.5,二号点\n');
  const converted=await convert(page,'csv-to-kml',
   {name:'p33-two-points.csv',mimeType:'text/csv',buffer:csv},'.kml');
  const file=make('p33-csv-export.kml',converted.bytes);
  const native=nativeRead(file);
  const features=checkPointFeatures(native.features,[[116.4,39.9],[114.1,22.5]],'CSV KML');
  return {...features,reader:'Native OGR KML driver',sha256:converted.sha256};
 });
 await runCase('native_ogr_reads_browser_kml_to_gpx_waypoints',async()=>{
  const converted=await convert(page,'kml-to-gpx',
   {name:'p33-two-points.kml',mimeType:'application/vnd.google-earth.kml+xml',
    buffer:Buffer.from(kmlText)},'.gpx');
  const file=make('p33-out-waypoints.gpx',converted.bytes);
  // The native GPX driver's "waypoints" layer is independent of the site
  // WebAssembly output and is supported by default GDAL/OGR installations.
  const native=nativeRead(file,{layer:'waypoints'});
  const features=checkPointFeatures(native.features,[[116.4,39.9],[114.1,22.5]],'Native GPX');
  return {...features,reader:'Native OGR GPX waypoints',sha256:converted.sha256};
 });
 await runCase('gps_kmz_gx_track_schema_pairs_and_native_ogr_reads_public_gpx_source',async()=>{
  const bytes=fs.readFileSync('test-fixtures/public-gpx/etrex20x-real-track.gpx');
  const file=make('p33-public-etrex.gpx',bytes);
  cli('ogrinfo',['-ro',file]);
  const src=bytes.toString('utf8');
  const pts=[...src.matchAll(/<trkpt\b[^>]*lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
   .map(m=>({lat:Number(m[1]),lon:Number(m[2]),
    time:m[3].match(/<time>([^<]+)<\/time>/)?.[1]||null,
    ele:Number(m[3].match(/<ele>([^<]+)<\/ele>/)?.[1])}));
  assert(pts.length===104&&pts.every(x=>x.time&&Number.isFinite(x.ele)),
   'Public GPX fixture timestamp/altitude changed');
  const converted=await convert(page,'gpx-to-kmz',
   {name:'p33-public-etrex.gpx',mimeType:'application/gpx+xml',buffer:bytes},'.kmz');
  const doc=await unzipKml(converted.bytes,'p33-timed-track');
  assert(doc.xml.includes('xmlns:gx="http://www.google.com/kml/ext/2.2"'),
   'Google gx namespace missing');
  const clocks=[...doc.xml.matchAll(/<when>([^<]+)<\/when>/g)].map(m=>m[1]);
  const tuples=[...doc.xml.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)]
   .map(m=>m[1].trim().split(/\s+/).map(Number));
  assert(clocks.length===104&&tuples.length===104,
   'KML gx:Track clock coordinate arrays differ from original 104 points');
  for(let i=0;i<104;i++){
   assert(new Date(Date.parse(pts[i].time)).toISOString()===clocks[i],
    'GPS time mismatched at native interoperability vertex '+i);
   assert(approx(tuples[i][0],pts[i].lon,.000011)&&
     approx(tuples[i][1],pts[i].lat,.000011)&&
     approx(tuples[i][2],pts[i].ele,.001),
     'GPS 3D coordinates mismatch at vertex '+i);
  }
  return {nativeOriginalGpxReader:'ogrinfo',gxTrackStructuralOnly:true,
   clockCoordinateElevationPairs:104,earthDesktopPlayback:'NOT_VERIFIED',
   sha256:converted.sha256};
 });
 assert(report.browserErrors.length===0,'Browser exceptions during native acceptance');
 assert(report.cases.length===report.expected&&report.passed===report.expected,
  'Native GIS compatibility regressions '+report.failed.join(', '));
 report.status='PASSED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2000)}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(filename,JSON.stringify(report,null,2));
 console.log('P33_NATIVE_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.passed,expected:report.expected,
  failed:report.failed,version:report.nativeOgrVersion,fatal:report.fatal
 }));
 await browser?.close();
 fs.rmSync(work,{recursive:true,force:true});
}
if(report.status!=='PASSED')process.exitCode=1;
