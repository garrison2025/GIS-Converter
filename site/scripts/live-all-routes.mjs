import fs from 'node:fs';
import {chromium} from 'playwright';
import JSZip from 'jszip';
const origin='https://gis-converter.pages.dev';
const routes=[
['kmz-to-shp','kmz','shp'],['kml-to-shp','kml','shp'],['shp-to-kml','shp','kml'],
['kmz-to-gpx','kmz','gpx'],['kml-to-gpx','kml','gpx'],['gpx-to-kml','gpx','kml'],
['kmz-to-kml','kmz','kml'],['kml-to-kmz','kml','kmz'],['geojson-to-shp','geojson','shp'],
['shp-to-geojson','shp','geojson'],['geojson-to-kml','geojson','kml'],
['kml-to-geojson','kml','geojson'],['shp-to-kmz','shp','kmz'],
['kml-to-csv','kml','csv'],['kmz-to-csv','kmz','csv'],['csv-to-kml','csv','kml'],
['csv-to-kmz','csv','kmz'],['gpx-to-kmz','gpx','kmz'],['kmz-to-geojson','kmz','geojson']
];
const expected={shp:'.zip',geojson:'.geojson',kmz:'.kmz',kml:'.kml',gpx:'.gpx',csv:'.csv'};
const report={origin,startedAt:new Date().toISOString(),status:'RUNNING',results:[],errors:[],browserErrors:[],expectedRoutes:routes.length};
const approx=(a,b,tol=.001)=>Math.abs(a-b)<=tol;
function check(test,msg){if(!test)throw Error(msg)}
function pointCoordinates(line){const vals=String(line).trim().split(',');return vals.map(Number)}
function inspectKml(text){
 check(text.includes('<kml'),'Not KML');
 const matches=[...text.matchAll(/<coordinates>\s*([^<]+)\s*<\/coordinates>/gi)];
 check(matches.length>=1,'No KML coordinates');
 const coords=pointCoordinates(matches[0][1]);
 check(approx(coords[0],116.4)&&approx(coords[1],39.9),'KML coordinate drift '+coords);
 return {features:matches.length,coordinates:coords.slice(0,2)};
}
function inspectGpx(text){
 check(text.includes('<gpx'),'Not GPX');
 const match=text.match(/<(?:wpt|trkpt|rtept)\b[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>/i);
 check(match,'GPX point missing');
 check(approx(Number(match[1]),39.9)&&approx(Number(match[2]),116.4),'GPX coordinate drift');
 return {latitude:Number(match[1]),longitude:Number(match[2])};
}
async function inspect(format,bytes){
 check(bytes.length>20,'Empty downloaded output');
 if(format==='geojson'){
  const json=JSON.parse(bytes.toString('utf8'));check(json.type==='FeatureCollection' && json.features.length===1,'Bad GeoJSON feature count');
  const c=json.features[0].geometry.coordinates;check(approx(c[0],116.4)&&approx(c[1],39.9),'GeoJSON coordinate drift');
  return {features:1,coordinates:c.slice(0,2)};
 }
 if(format==='csv'){
  const text=bytes.toString('utf8');
  check(text.includes('116.4')&&text.includes('39.9'),'CSV lacks coordinates');
  check(text.trim().split(/\r?\n/).length>=2,'No CSV rows');
  return {rows:text.trim().split(/\r?\n/).length-1};
 }
 if(format==='kml')return inspectKml(bytes.toString('utf8'));
 if(format==='gpx')return inspectGpx(bytes.toString('utf8'));
 const zip=await JSZip.loadAsync(bytes);
 const names=Object.keys(zip.files);
 if(format==='kmz'){
  const doc=zip.file('doc.kml');check(doc,'KMZ doc.kml missing');
  return {...inspectKml(await doc.async('string')),entries:names.length};
 }
 if(format==='shp'){
  for(const ext of ['.shp','.shx','.dbf','.prj'])check(names.some(n=>n.toLowerCase().endsWith(ext)),'SHP ZIP missing '+ext);
  const shp=await zip.file(names.find(n=>n.toLowerCase().endsWith('.shp'))).async('uint8array');
  const shx=await zip.file(names.find(n=>n.toLowerCase().endsWith('.shx'))).async('uint8array');
  const dbf=await zip.file(names.find(n=>n.toLowerCase().endsWith('.dbf'))).async('uint8array');
  const dv=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
  check(dv.getUint32(4,true)===1,'Expected 1 DBF record');
  check((shx.length-100)/8===1,'Expected 1 SHX indexed geometry');
  const shpdv=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
  const off=new DataView(shx.buffer,shx.byteOffset,shx.byteLength).getInt32(100,false)*2;
  check(shpdv.getInt32(off+8,true)===1,'Not point SHP');
  const coord=[shpdv.getFloat64(off+12,true),shpdv.getFloat64(off+20,true)];
  check(approx(coord[0],116.4)&&approx(coord[1],39.9),'SHP coordinate drift '+coord);
  return {shpCount:1,coordinates:coord,entries:names};
 }
 throw Error('Unknown output '+format);
}
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:780}});
 const page=await ctx.newPage();
 page.on('pageerror',e=>report.browserErrors.push(String(e)));
 const kml='<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Live Matrix</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
 const gpxtxt='<?xml version="1.0" encoding="utf-8"?><gpx version="1.1" creator="QA" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="39.9" lon="116.4"><name>Live Matrix</name></wpt></gpx>';
 const csv='longitude,latitude,Name\n116.4,39.9,Live Matrix\n';
 const geojson=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{Name:'Live Matrix'},geometry:{type:'Point',coordinates:[116.4,39.9]}}]});
 const zip=new JSZip();zip.file('doc.kml',kml);
 const fixtures={
   kml:{name:'sample.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kml)},
   kmz:{name:'sample.kmz',mimeType:'application/vnd.google-earth.kmz',buffer:Buffer.from(await zip.generateAsync({type:'uint8array'}))},
   gpx:{name:'sample.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpxtxt)},
   csv:{name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from(csv)},
   geojson:{name:'sample.geojson',mimeType:'application/geo+json',buffer:Buffer.from(geojson)}
 };
 const ordered=[routes.find(r=>r[0]==='kml-to-shp'),...routes.filter(r=>r[0]!=='kml-to-shp')];
 for(const [slug,source,target] of ordered){
  const start=Date.now();
  const record={slug,source,target,status:'RUNNING'};
  report.results.push(record);
  try{
   const input=fixtures[source];
   check(input,'Missing fixture for '+source);
   const res=await page.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:40000});
   check(res?.ok(),'HTTP '+res?.status()+' '+slug);
   check((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow','Missing robots meta');
   await page.locator('#file').setInputFiles(input);
   await page.locator('#submit').click();
   try{await page.locator('#result').waitFor({state:'visible',timeout:85000})}
   catch{throw Error('Conversion failure '+(await page.locator('#error').textContent())+' status='+(await page.locator('#status').textContent()))}
   const event=page.waitForEvent('download',{timeout:10000});
   await page.locator('#download').click();
   const downloaded=await event;
   check(downloaded.suggestedFilename().endsWith(expected[target]),'Unexpected extension '+downloaded.suggestedFilename());
   const output=fs.readFileSync(await downloaded.path());
   record.output=await inspect(target,output);
   record.outputBytes=output.byteLength;
   record.elapsedMs=Date.now()-start;
   record.status='PASSED';
   if(slug==='kml-to-shp')fixtures.shp={name:'seed.zip',mimeType:'application/zip',buffer:output};
  }catch(e){
   record.status='FAILED';
   record.error=String(e?.stack||e);
   report.errors.push(slug+': '+record.error);
  }
  console.log('LIVE_MATRIX '+slug+' '+record.status+' '+record.elapsedMs+'ms '+(record.error||''));
 }
 report.failed=report.results.filter(x=>x.status!=='PASSED').map(x=>x.slug);
 report.passed=report.results.length-report.failed.length;
 report.status=report.failed.length===0&&report.results.length===19&&report.browserErrors.length===0?'PASSED':'FAILED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('live-matrix-report.json',JSON.stringify(report,null,2));
 console.log('SUMMARY '+JSON.stringify({status:report.status,passed:report.passed,failed:report.failed,errors:report.errors.slice(0,8),browserErrors:report.browserErrors}));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
