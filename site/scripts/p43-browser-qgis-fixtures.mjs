/**
 * P43 browser-generated GIS fixtures for an actual QGIS Qt GUI canvas test.
 * All coordinates/labels below are synthetic. No QGIS results are invented:
 * this script downloads real files from live/local GIS Converter and materializes
 * only those output bytes for a separate PyQGIS GUI reader.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const root=(process.env.GIS_BASE_URL||'http://127.0.0.1:8784').replace(/\/+$/,'');
const dest=path.resolve('p43-qgis-fixtures');
fs.mkdirSync(dest,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const geoFeature=(type,coordinates,properties)=>({type:'Feature',geometry:{type,coordinates},properties});
const featureCollection=features=>JSON.stringify({type:'FeatureCollection',features});
const coordsNear=(a,b,tol=.00011)=>Math.abs(a-b)<tol;
function makeFile(name,bytes){
 const file=path.join(dest,name);
 fs.writeFileSync(file,bytes);
 return file;
}
async function unzipShape(bytes,prefix){
 const zip=await JSZip.loadAsync(bytes);
 const names=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
 check(names.length<=12,'Shapefile ZIP has unexpected number of components');
 check(names.filter(n=>n.toLowerCase().endsWith('.shp')).length===1,'Shapefile ZIP missing unique SHP');
 const out=[];
 for(const name of names){
  check(/^[A-Za-z0-9_.-]+$/.test(name)&&!name.includes('..'),'Unsafe Shapefile ZIP entry');
  const ext=path.extname(name).toLowerCase();
  if(!['.shp','.shx','.dbf','.prj','.cpg','.qpj'].includes(ext))continue;
  const buffer=await zip.file(name).async('nodebuffer');
  out.push(makeFile(prefix+ext,buffer));
 }
 for(const ext of ['.shp','.shx','.dbf','.prj'])
  check(out.some(n=>n.endsWith(prefix+ext)),'Missing SHP companion '+ext);
 return out;
}
function nativeOgr(args){
 return execFileSync('ogr2ogr',args,{encoding:'utf8',timeout:60000,
  env:{...process.env,SHAPE_ENCODING:'CP1252'},maxBuffer:5*1024*1024});
}
async function zipNativeShape(stem){
 const zip=new JSZip();
 for(const ext of ['.shp','.shx','.dbf','.prj','.cpg','.qpj']){
  const file=stem+ext;
  if(fs.existsSync(file))zip.file(path.basename(file),fs.readFileSync(file));
 }
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function convert(page,slug,input,extension){
 const resp=await page.goto(root+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:60000});
 check(resp?.ok(),'Cannot reach '+slug);
 check((await page.locator('meta[name="robots"]').getAttribute('content'))==='noindex,nofollow',
  'Preview SEO robots not protected');
 await page.locator('#file').setInputFiles(input);
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
 catch{
  // P53 synthetic-fixture-only diagnostic: capture the worker's aggregate
  // integrity-check reason, never user files or private GIS properties.
  const internal=await page.evaluate(()=>
   (window.__p53WorkerIntegrityErrors||[]).slice(-1)[0]||'no worker integrity detail');
  throw Error('GIS browser converter failed for '+slug+': '+
   (await page.locator('#error').textContent())+
   ' / synthetic fixture integrity detail: '+internal.slice(0,1600));
 }
 const [dl]=await Promise.all([page.waitForEvent('download',{timeout:25000}),page.locator('#download').click()]);
 check(dl.suggestedFilename().endsWith(extension),'Wrong converter file extension');
 const bytes=fs.readFileSync(await dl.path());
 check(bytes.length>40,'Empty downloaded output');
 const [qualityDL]=await Promise.all([page.waitForEvent('download',{timeout:25000}),
  page.locator('#quality-download').click()]);
 const quality=JSON.parse(fs.readFileSync(await qualityDL.path(),'utf8'));
 check(Array.isArray(quality.checks),'Missing real GIS quality report');
 return {bytes,quality};
}
let browser;
const evidence={schemaVersion:1,kind:'p43-browser-generated-for-desktop-qgis-gui',
 source:'actual-browser-download',origin:root,cases:[],status:'FAILED',physicalDevice:'NOT_TESTED'};
try{
 const source=featureCollection([
  geoFeature('Polygon',[
   [[0,0],[4,0],[4,4],[0,4],[0,0]],
   [[1,1],[1,2],[2,2],[2,1],[1,1]]
  ],{Label:'公园内环',Count:2}),
  geoFeature('MultiPolygon',[
   [[[10,10],[12,10],[12,12],[10,12],[10,10]]],
   [[[15,10],[16,10],[16,11],[15,11],[15,10]]]
  ],{Label:'两个岛屿',Count:3})
 ]);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({acceptDownloads:true});
 // Synthetic GIS cases only. Listen to the actual isolated worker failure
 // *inside* Playwright CI; production error UI remains intentionally generic.
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.__p53WorkerIntegrityErrors=[];
  window.Worker=class extends NativeWorker{
   constructor(...args){
    super(...args);
    this.addEventListener('message',event=>{
     if(event.data?.type==='error')
      window.__p53WorkerIntegrityErrors.push(String(event.data.error||'unknown'));
    });
   }
  };
 });
 const polygon=await convert(page,'geojson-to-shp',
  {name:'p43-polygon.geojson',mimeType:'application/geo+json',buffer:Buffer.from(source)},'.zip');
 await unzipShape(polygon.bytes,'p43-browser-polygon');
 check(polygon.quality.checks.find(c=>c.id==='feature-count')?.status==='pass',
  'Browser Shapefile polygon counts not verified');
 evidence.cases.push({name:'browser_geojson_to_shp_polyholes_utf8',
  bytes:polygon.bytes.length,sha256:sha(polygon.bytes),featureCount:2,
  qualityStatus:polygon.quality.status});


 // P53: real browser-generated KML and round-tripped GeoJSON, independently
 // re-read by installed QGIS Qt. Do not certify swapped line attributes.
 const surveyLines=[
  {coordinates:[[116.4,39.9],[116.45,39.95],[116.5,40]],label:'Survey east',code:'R-A01'},
  {coordinates:[[117.1,39.3],[117.12,39.33],[117.14,39.35]],label:'Survey west',code:'R-B02'}
 ];
 const sourceLines=featureCollection(surveyLines.map(row=>
  geoFeature('LineString',row.coordinates,{Name:row.label,Code:row.code})));
 const lineKml=await convert(page,'geojson-to-kml',
  {name:'p53-two-survey-lines.geojson',mimeType:'application/geo+json',buffer:Buffer.from(sourceLines)},'.kml');
 check(/<kml[\s>]/i.test(lineKml.bytes.toString('utf8')),'Browser output missing KML root element');
 check(lineKml.quality.checks.find(c=>c.id==='complex-feature-attributes')?.status==='pass',
  'Browser line output attribute-to-geometry join not independently certified');
 makeFile('p53-browser-survey-lines.kml',lineKml.bytes);
 evidence.cases.push({name:'browser_two_lines_geojson_to_kml_with_attribute_pairing',
  bytes:lineKml.bytes.length,sha256:sha(lineKml.bytes),featureCount:2});
 const lineBack=await convert(page,'kml-to-geojson',
  {name:'p53-browser-survey-lines.kml',mimeType:'application/vnd.google-earth.kml+xml',
   buffer:lineKml.bytes},'.geojson');
 const roundTrip=JSON.parse(lineBack.bytes.toString('utf8'));
 check(roundTrip.features.length===2,'KML roundtrip dropped an identifiable survey line');
 for(const expected of surveyLines){
  const matches=roundTrip.features.filter(feature=>
   feature.geometry?.type==='LineString'&&
   feature.geometry.coordinates?.length===expected.coordinates.length&&
   coordsNear(feature.geometry.coordinates[0][0],expected.coordinates[0][0])&&
   coordsNear(feature.geometry.coordinates[0][1],expected.coordinates[0][1]));
  check(matches.length===1,'KML roundtrip duplicated or lost geometry identity');
  for(let index=0;index<expected.coordinates.length;index++){
   check(coordsNear(matches[0].geometry.coordinates[index][0],expected.coordinates[index][0])&&
    coordsNear(matches[0].geometry.coordinates[index][1],expected.coordinates[index][1]),
    'Intermediate survey-line vertex changed across real GDAL conversion');
  }
 }
 makeFile('p53-browser-survey-lines-roundtrip.geojson',lineBack.bytes);
 evidence.cases.push({name:'browser_two_lines_kml_to_geojson_for_independent_qgis',
  bytes:lineBack.bytes.length,sha256:sha(lineBack.bytes),featureCount:2,
  verifiedVertices:6});
 const cpSource=featureCollection([geoFeature('Point',[-4.42,36.72],
  {Label:'Café Málaga',Code:31})]);
 const cpInput=makeFile('p43-cp1252-source.geojson',cpSource);
 const cpStem=path.join(dest,'p43-native-cp1252');
 nativeOgr(['-f','ESRI Shapefile',cpStem+'.shp',cpInput,
  '-lco','ENCODING=CP1252']);
 const rawDbf=fs.readFileSync(cpStem+'.dbf');
 check(rawDbf.includes(Buffer.from([0xe9])),'Source CP1252 DBF does not contain expected legacy é byte');
 check(fs.readFileSync(cpStem+'.cpg','utf8').trim().toUpperCase()==='CP1252',
  'Native CP1252 codepage is not independently confirmed');
 fs.copyFileSync(cpStem+'.prj',cpStem+'.qpj');
 const cpArchive=await zipNativeShape(cpStem);
 const cpOut=await convert(page,'shp-to-geojson',
  {name:'p43-native-cp1252.zip',mimeType:'application/zip',buffer:cpArchive},'.geojson');
 const cpParsed=JSON.parse(cpOut.bytes.toString('utf8'));
 check(cpParsed.features.length===1&&cpParsed.features[0].properties.Label==='Café Málaga',
  'CP1252 native DBF label was not preserved in browser output');
 check(Number(cpParsed.features[0].properties.Code)===31,'CP1252 numeric field corrupted');
 check(coordsNear(cpParsed.features[0].geometry.coordinates[0],-4.42)&&
  coordsNear(cpParsed.features[0].geometry.coordinates[1],36.72),
  'CP1252 geometry coordinates corrupted');
 makeFile('p43-browser-cp1252.geojson',cpOut.bytes);
 evidence.cases.push({name:'native_cp1252_shape_to_browser_geojson',
  bytes:cpOut.bytes.length,sha256:sha(cpOut.bytes),labelsPreserved:true,qualityStatus:cpOut.quality.status});

 const projSource=featureCollection([geoFeature('Point',[116.4,39.9],{Label:'原生投影',Code:7})]);
 const sourceFile=makeFile('p43-projected-source.geojson',projSource);
 const projectedStem=path.join(dest,'p43-native-epsg3857');
 execFileSync('ogr2ogr',['-f','ESRI Shapefile',projectedStem+'.shp',sourceFile,
  '-s_srs','EPSG:4326','-t_srs','EPSG:3857','-lco','ENCODING=UTF-8'],
  {env:{...process.env,SHAPE_ENCODING:'UTF-8'},timeout:60000});
 const projectedArchive=await zipNativeShape(projectedStem);
 const transformed=await convert(page,'shp-to-geojson',
  {name:'p43-native-epsg3857.zip',mimeType:'application/zip',buffer:projectedArchive},'.geojson');
 const parsed=JSON.parse(transformed.bytes.toString('utf8'));
 check(parsed.features.length===1&&
  coordsNear(parsed.features[0].geometry.coordinates[0],116.4)&&
  coordsNear(parsed.features[0].geometry.coordinates[1],39.9),
  'Browser failed to reproject native EPSG3857 to WGS84');
 check(parsed.features[0].properties.Label==='原生投影','Projected label was not preserved');
 makeFile('p43-browser-reprojected.geojson',transformed.bytes);
 evidence.cases.push({name:'native_epsg3857_shp_to_browser_wgs84_geojson',
  bytes:transformed.bytes.length,sha256:sha(transformed.bytes),epsg4326Output:true});

 evidence.status='PASSED';
}catch(err){evidence.error=String(err?.stack||err).slice(0,1500)}
finally{
 await browser?.close();
 fs.writeFileSync(path.join(dest,'browser-evidence.json'),JSON.stringify(evidence,null,2));
 console.log('P43_QGIS_FIXTURES '+JSON.stringify({status:evidence.status,
  cases:evidence.cases.map(({name,...rest})=>({name,...rest})),error:evidence.error}));
}
if(evidence.status!=='PASSED')process.exitCode=1;
