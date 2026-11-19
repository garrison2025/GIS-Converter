/**
 * P50 true browser GDAL/WASM acceptance for CSV/KML/KMZ/GeoJSON attributes.
 * Synthetic values only. Normal fields must survive or trigger DATA_LOSS.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import JSZip from 'jszip';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8792').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const out=local?'p50-cross-format-browser-local.json':'p50-cross-format-browser-public.json';
const report={kind:'p50-real-browser-cross-format-attribute-integrity',origin:base,
 status:'FAILED',expected:6,cases:[],note:'Synthetic data only; raw names/values not saved'};
let server,browser;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,message)=>{if(!ok)throw Error(message)};
const csv=value=>Buffer.from('longitude,latitude,Name,RefCode,Comment\n116.4,39.9,Sample Place,'+
 value+',"Café & 中文"\n');
const sourceKml='<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'+
 '<name>Sample Place</name><ExtendedData>'+
 '<Data name="RefCode"><value>AB-00123</value></Data>'+
 '<Data name="Comment"><value>Café &amp; 中文</value></Data>'+
 '</ExtendedData><Point><coordinates>116.4,39.9,0</coordinates></Point>'+
 '</Placemark></Document></kml>';
const sourceGeo=JSON.stringify({type:'FeatureCollection',features:[{
 type:'Feature',properties:{Name:'Sample Place',RefCode:'AB-00123',Comment:'Café & 中文',Count:3000000000000},
 geometry:{type:'Point',coordinates:[116.4,39.9]}
}]});
async function fileDownload(page,selector){
 const [d]=await Promise.all([page.waitForEvent('download',{timeout:25000}),
  page.locator(selector).click()]);
 return fs.readFileSync(await d.path());
}
async function convert(page,slug,name,bytes,mime){
 const res=await page.goto(base+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
 check(res?.ok(),'Requested converter route unavailable');
 await page.locator('#file').setInputFiles({name,mimeType:mime,buffer:Buffer.from(bytes)});
 await page.locator('#submit').click();
 await Promise.race([
  page.locator('#result').waitFor({state:'visible',timeout:120000}).catch(()=>{}),
  page.locator('#error').waitFor({state:'visible',timeout:120000}).catch(()=>{})
 ]);
 if(!await page.locator('#result').isVisible()){
  const reason=await page.locator('#recovery-panel').getAttribute('data-guidance');
  check(reason==='data-loss','Conversion failed for an unrelated reason');
  check(await page.locator('#result').isHidden(),'Unsafe output remains visible');
  return {status:'withheld'};
 }
 const output=await fileDownload(page,'#download');
 const quality=JSON.parse((await fileDownload(page,'#quality-download')).toString('utf8'));
 const fidelity=quality.checks?.find(x=>x.id==='cross-format-attributes');
 check(Boolean(fidelity),'Cross-format attribute inspection missing from real output report');
 check(fidelity.status!=='review','A known attribute loss was downloadable');
 return {status:'delivered',output,quality,fidelity:fidelity.status};
}
async function actualText(bytes,fmt){
 if(fmt!=='kmz')return bytes.toString('utf8');
 const zip=await JSZip.loadAsync(bytes);
 return zip.file('doc.kml')?.async('string')||'';
}
async function test(name,fn){
 const row={name,status:'FAILED'};
 report.cases.push(row);
 const page=await browser.newPage({acceptDownloads:true});
 try{
  const result=await fn(page);
  Object.assign(row,result,{status:'PASSED'});
  console.log('P50_BROWSER '+name+' PASSED');
 }catch(e){
  row.error=String(e?.stack||e).slice(0,1200);
  console.error('P50_BROWSER '+name+' FAILED '+row.error);
 }finally{await page.close()}
}
try{
 if(local){
  let ready=false;
  try{ready=(await fetch(base+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8792','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<70;i++){
    try{ready=(await fetch(base+'/')).ok;if(ready)break}catch{}
    await wait(210);
   }
  }
  check(ready,'Local preview unavailable');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await test('CSV_to_KML_multilingual_named_attributes',async page=>{
  const x=await convert(page,'csv-to-kml','points.csv',csv('AB-00123'),'text/csv');
  if(x.status==='withheld')return {outcome:'withheld-on-confirmed-attribute-loss'};
  const text=await actualText(x.output,'kml');
  check(text.includes('AB-00123')&&text.includes('Café')&&text.includes('中文'),
   'Delivered KML lost known string attributes');
  return {outcome:'preserved',quality:x.fidelity};
 });
 await test('CSV_to_KMZ_multilingual_named_attributes',async page=>{
  const x=await convert(page,'csv-to-kmz','points.csv',csv('AB-00123'),'text/csv');
  if(x.status==='withheld')return {outcome:'withheld-on-confirmed-attribute-loss'};
  const text=await actualText(x.output,'kmz');
  check(text.includes('AB-00123')&&text.includes('Café')&&text.includes('中文'),
   'Delivered KMZ lost known string attributes');
  return {outcome:'preserved',quality:x.fidelity};
 });
 await test('CSV_leading_zero_numeric_identifier',async page=>{
  const x=await convert(page,'csv-to-kml','ids.csv',csv('00123'),'text/csv');
  if(x.status==='withheld')return {outcome:'withheld-on-loss'};
  const text=await actualText(x.output,'kml');
  check(text.includes('00123'),'Delivered KML silently stripped leading zeros');
  return {outcome:'identifier-preserved',quality:x.fidelity};
 });
 await test('GeoJSON_to_KML_multilingual_and_exact_integer',async page=>{
  const x=await convert(page,'geojson-to-kml','source.geojson',Buffer.from(sourceGeo),
   'application/geo+json');
  if(x.status==='withheld')return {outcome:'withheld-on-confirmed-attribute-loss'};
  const text=await actualText(x.output,'kml');
  check(text.includes('AB-00123')&&text.includes('3000000000000'),
   'Delivered KML lost original identifier or integer');
  return {outcome:'values-preserved',quality:x.fidelity};
 });
 await test('KML_to_GeoJSON_extended_data',async page=>{
  const x=await convert(page,'kml-to-geojson','synthetic.kml',Buffer.from(sourceKml),
   'application/vnd.google-earth.kml+xml');
  if(x.status==='withheld')return {outcome:'withheld-on-confirmed-attribute-loss'};
  const json=JSON.parse(x.output.toString('utf8'));
  const properties=json.features?.[0]?.properties;
  check(properties?.RefCode==='AB-00123'&&properties?.Comment==='Café & 中文',
   'Delivered GeoJSON lost KML ExtendedData values');
  return {outcome:'extended-data-preserved',quality:x.fidelity};
 });
 await test('KML_to_CSV_extended_data',async page=>{
  const x=await convert(page,'kml-to-csv','synthetic.kml',Buffer.from(sourceKml),
   'application/vnd.google-earth.kml+xml');
  if(x.status==='withheld')return {outcome:'withheld-on-confirmed-attribute-loss'};
  const text=x.output.toString('utf8');
  check(text.includes('AB-00123')&&text.includes('Café & 中文'),
   'Delivered CSV silently removed KML ExtendedData values');
  return {outcome:'extended-data-preserved',quality:x.fidelity};
 });
 report.status=report.cases.length===report.expected&&
  report.cases.every(c=>c.status==='PASSED')?'PASSED':'FAILED';
}catch(e){report.error=String(e?.stack||e).slice(0,1200)}
finally{
 await browser?.close();
 if(server)server.kill();
 fs.writeFileSync(out,JSON.stringify(report,null,2));
 console.log('P50_BROWSER_REPORT '+JSON.stringify({status:report.status,
  passed:report.cases.filter(c=>c.status==='PASSED').length,expected:report.expected}));
}
if(report.status!=='PASSED')process.exitCode=1;
