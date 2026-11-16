/**
 * P48 real browser, full GDAL/WASM data fidelity and recovery acceptance.
 *
 * Synthetic attributes only. Privately processes GIS bytes in the browser.
 * A reference DBF reader independently inspects downloaded ZIP sidecars.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {readUtf8ShapefileDbf,readComparableDbfValue} from '../src/lib/dbf-fidelity.mjs';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8792').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const output=local?'p48-attribute-browser-local.json':'p48-attribute-browser-public.json';
const report={kind:'p48-real-GDAL-attribute-precision',origin:base,status:'FAILED',
 expected:4,cases:[],errors:[],note:'No private data or raw field values saved to test report'};
let browser,server;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,message)=>{if(!ok)throw Error(message)};
const FIXTURE={
 type:'FeatureCollection',features:[
  {type:'Feature',properties:{Name:'测绘图层',Accent:'Café Málaga',Count:3000000000000,Rate:12.125},
   geometry:{type:'Point',coordinates:[116.4,39.9]}},
  {type:'Feature',properties:{Name:'上海图层',Accent:'Béziers',Count:3000000000001,Rate:12.25},
   geometry:{type:'Point',coordinates:[116.5,39.95]}}
 ]};
const input=(name,collection)=>({
 name,mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(collection))
});
async function download(page,selector){
 const [item]=await Promise.all([page.waitForEvent('download',{timeout:25000}),page.locator(selector).click()]);
 return fs.readFileSync(await item.path());
}
async function open(page,path){
 const r=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:45000});
 check(r?.ok(),'Converter page not found: '+path);
}
async function finish(page){
 await page.locator('#submit').click();
 await Promise.race([
  page.locator('#result').waitFor({state:'visible',timeout:120000}).catch(()=>{}),
  page.locator('#error').waitFor({state:'visible',timeout:120000}).catch(()=>{})
 ]);
 return await page.locator('#result').isVisible();
}
async function test(name,fn){
 const row={name,status:'FAILED'};report.cases.push(row);
 try{Object.assign(row,await fn(),{status:'PASSED'});
  console.log('P48_BROWSER '+name+' PASSED')}
 catch(e){row.error=String(e?.stack||e).slice(0,1800);
  console.error('P48_BROWSER '+name+' FAILED '+row.error)}
}
try{
 if(local){
  let ready=false;
  try{ready=(await fetch(base+'/')).ok}catch{}
  if(!ready){
   server=spawn('python3',['-m','http.server','8792','--directory','dist'],{stdio:'ignore'});
   for(let i=0;i<70;i++){try{ready=(await fetch(base+'/')).ok;if(ready)break}catch{}await wait(210)}
  }
  check(ready,'Local build server unavailable');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await test('full_UTF8_text_large_safe_integers_and_GeoJSON_SHP_GeoJSON_roundtrip',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  page.on('pageerror',e=>report.errors.push(String(e)));
  try{
   await open(page,'/converter/geojson-to-shp/');
   await page.locator('#file').setInputFiles(input('safe-attributes.geojson',FIXTURE));
   check(await finish(page),'GDAL rejected ordinary comparable UTF-8 attributes: '+
    (await page.locator('#error').textContent()));
   const packed=await download(page,'#download');
   const zip=await JSZip.loadAsync(packed);
   const names=Object.keys(zip.files);
   for(const ext of ['.shp','.shx','.dbf','.prj','.cpg'])
    check(names.some(n=>n.endsWith(ext)),'Shapefile download missing '+ext);
   const dbf=await readUtf8ShapefileDbf(new Uint8Array(packed));
   check(dbf.count===2,'Shapefile has wrong DBF row count');
   for(const [index,feature] of FIXTURE.features.entries()){
    for(const [key,value] of Object.entries(feature.properties)){
     const field=dbf.lookup.get(key);
     check(Boolean(field),'GDAL omitted safe expected DBF attribute column');
     const actual=readComparableDbfValue(dbf,index,field);
     check(actual.value===value,'GDAL altered source DBF value under strict equality');
    }
   }
   const quality=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
   const fidelity=quality.checks.find(c=>c.id==='dbf-attribute-values');
   check(fidelity?.status==='pass',
    'Comparable GeoJSON→SHP attribute fidelity was not independently certified');
   await open(page,'/converter/shp-to-geojson/');
   await page.locator('#file').setInputFiles({name:'original.zip',mimeType:'application/zip',buffer:packed});
   check(await finish(page),'Reverse GDAL conversion failed: '+await page.locator('#error').textContent());
   const restored=JSON.parse((await download(page,'#download')).toString('utf8'));
   check(restored.features.length===2,'Round-trip lost features');
   for(let i=0;i<2;i++){
    for(const [key,value] of Object.entries(FIXTURE.features[i].properties))
     check(restored.features[i].properties[key]===value,'Roundtrip changed independently safe value');
   }
   const reverseReport=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
   check(reverseReport.checks.find(c=>c.id==='shp-geojson-attributes')?.status==='pass',
    'Reverse numeric/UTF8 attribute fidelity not independently verified');
   return {forwardDbfValuesChecked:8,roundTripUtf8AndExactIntegers:true,
    dbfAndReverseQuality:'pass',shapefileSidecars:5};
  }finally{await page.close()}
 });
 await test('short_Chinese_UTF8_field_name_either_preserved_or_safely_rejected',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  try{
   await open(page,'/converter/geojson-to-shp/');
   const change={...FIXTURE.features[0].properties,'名称':'测绘信息'};
   const doc={type:'FeatureCollection',features:[{
    type:'Feature',properties:change,geometry:{type:'Point',coordinates:[116.4,39.9]}
   }]};
   await page.locator('#file').setInputFiles(input('cjk-field.geojson',doc));
   const success=await finish(page);
   if(!success){
    const code=await page.locator('#recovery-panel').getAttribute('data-guidance');
    check(code==='data-loss','CJK field was rejected without critical data-loss guidance');
    check(await page.locator('#result').isHidden(),'Unsafe CJK field output was offered to download');
    return {cjkFieldStatus:'safely-rejected',inconsistentValueNotDelivered:true};
   }
   const bytes=await download(page,'#download');
   const dbf=await readUtf8ShapefileDbf(new Uint8Array(bytes));
   const name=dbf.lookup.get('名称');
   check(Boolean(name),'CJK DBF field name silently changed despite successful output');
   check(readComparableDbfValue(dbf,0,name).value==='测绘信息',
    'CJK DBF field value silently changed');
   const quality=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
   check(quality.checks.find(c=>c.id==='dbf-attribute-values')?.status==='pass',
    'CJK field was emitted without independent exact-fidelity pass');
   return {cjkFieldStatus:'preserved',byteLevelUnicodeVerified:true};
  }finally{await page.close()}
 });
 await test('long_collision_null_and_unsafe_number_are_explicitly_not_certified',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  try{
   await open(page,'/converter/geojson-to-shp/');
   const doc={type:'FeatureCollection',features:[{
    type:'Feature',
    properties:{Name:'Synthetic',verylongfield_alpha:'A',verylongfield_beta:'B',
     Nullable:null,UnsafeInteger:9007199254740992},
    geometry:{type:'Point',coordinates:[116.4,39.9]}
   }]};
   await page.locator('#file').setInputFiles(input('schema-risk.geojson',doc));
   if(!await finish(page)){
    check(await page.locator('#recovery-panel').getAttribute('data-guidance')==='data-loss',
     'Risky schema rejected without reason');
    return {schemaRisk:'withheld-due-to-confirmed-loss'};
   }
   const quality=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
   check(quality.checks.find(c=>c.id==='shp-field-limits')?.status==='review',
    'Long colliding names were not identified as risky');
   check(quality.checks.find(c=>c.id==='shp-value-limits')?.status==='review',
    'Nullable/unsafe integer not identified as risky');
   check(quality.checks.find(c=>c.id==='dbf-attribute-values')?.status!=='pass',
    'Unsupported schema was falsely certified as fully preserved');
   const text=JSON.stringify(quality);
   check(!text.includes('verylongfield_alpha')&&!text.includes('Synthetic'),
    'Report accidentally echoed private field names or values');
   return {schemaRisk:'reported-not-certified',fieldAndValueReview:true};
  }finally{await page.close()}
 });
 await test('high_decimal_precision_is_either_exact_or_blocked_before_download',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  try{
   await open(page,'/converter/geojson-to-shp/');
   const value=12.123456789001;
   const doc={type:'FeatureCollection',features:[{
    type:'Feature',properties:{Label:'Example',Rate:value},
    geometry:{type:'Point',coordinates:[116.4,39.9]}
   }]};
   await page.locator('#file').setInputFiles(input('decimal.geojson',doc));
   const success=await finish(page);
   if(!success){
    check(await page.locator('#recovery-panel').getAttribute('data-guidance')==='data-loss',
     'High precision failure not flagged as DATA_LOSS');
    check(await page.locator('#download').getAttribute('href')===null,
     'Unsafe high-precision output remains downloadable');
    return {decimalOutcome:'withheld-on-detected-drift'};
   }
   const pack=await download(page,'#download');
   const dbf=await readUtf8ShapefileDbf(new Uint8Array(pack));
   const field=dbf.lookup.get('Rate');
   check(Boolean(field),'High precision decimal field missing after success');
   check(readComparableDbfValue(dbf,0,field).value===value,
    'Numeric change delivered without integrity block');
   const q=JSON.parse((await download(page,'#quality-download')).toString('utf8'));
   check(q.checks.find(c=>c.id==='dbf-attribute-values')?.status==='pass',
    'Precise decimal delivered without exact DBF comparison');
   return {decimalOutcome:'exact-in-independent-output'};
  }finally{await page.close()}
 });
 report.status=report.cases.length===4&&report.cases.every(c=>c.status==='PASSED')&&
   report.errors.length===0?'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2000)}
finally{
 await browser?.close();server?.kill();
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log('P48_ATTRIBUTE_BROWSER_SUMMARY '+JSON.stringify({
  status:report.status,expected:4,passed:report.cases.filter(c=>c.status==='PASSED').length,
  failed:report.cases.filter(c=>c.status!=='PASSED').map(c=>c.name),
  pageErrors:report.errors,fatal:report.fatal
 }));
}
if(report.status!=='PASSED')process.exitCode=1;
