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
 catch{throw Error('GIS browser converter failed for '+slug+': '+await page.locator('#error').textContent())}
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
 const polygon=await convert(page,'geojson-to-shp',
  {name:'p43-polygon.geojson',mimeType:'application/geo+json',buffer:Buffer.from(source)},'.zip');
 await unzipShape(polygon.bytes,'p43-browser-polygon');
 check(polygon.quality.checks.find(c=>c.id==='feature-count')?.status==='pass',
  'Browser Shapefile polygon counts not verified');
 evidence.cases.push({name:'browser_geojson_to_shp_polyholes_utf8',
  bytes:polygon.bytes.length,sha256:sha(polygon.bytes),featureCount:2,
  qualityStatus:polygon.quality.status});

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
