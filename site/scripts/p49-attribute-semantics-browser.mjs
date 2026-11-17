/**
 * P49 real browser GDAL/WASM attribute type and null semantics acceptance.
 * Synthetic GIS files only; reports contain no private attribute data.
 */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {readUtf8ShapefileDbf,readComparableDbfValue} from '../src/lib/dbf-fidelity.mjs';
const base=(process.env.GIS_BASE_URL||'http://127.0.0.1:8792').replace(/\/+$/,'');
const local=base.startsWith('http://127.0.0.1:');
const output=local?'p49-attribute-browser-local.json':'p49-attribute-browser-public.json';
const report={kind:'p49-GDAL-DBF-type-null-collision',origin:base,status:'FAILED',
 expected:4,cases:[],note:'Synthetic fixture only; attribute values and names are not logged'};
let server,browser;
const wait=ms=>new Promise(done=>setTimeout(done,ms));
function check(ok,message){if(!ok)throw Error(message);}
const geo=(properties)=>({type:'FeatureCollection',features:[{
 type:'Feature',properties,geometry:{type:'Point',coordinates:[116.4,39.9]}
}]});
async function open(page,route){
 const response=await page.goto(base+'/converter/'+route+'/',{waitUntil:'domcontentloaded',timeout:45000});
 check(response?.ok(),'Route page unavailable');
}
async function upload(page,fixture,name){
 await page.locator('#file').setInputFiles({name,mimeType:'application/geo+json',
  buffer:Buffer.from(JSON.stringify(fixture))});
 await page.locator('#submit').click();
 await Promise.race([
  page.locator('#result').waitFor({state:'visible',timeout:120000}).catch(()=>{}),
  page.locator('#error').waitFor({state:'visible',timeout:120000}).catch(()=>{})
 ]);
 return await page.locator('#result').isVisible();
}
async function download(page,selector){
 const [item]=await Promise.all([page.waitForEvent('download',{timeout:25000}),
  page.locator(selector).click()]);
 return fs.readFileSync(await item.path());
}
async function quality(page){
 return JSON.parse((await download(page,'#quality-download')).toString('utf8'));
}
async function caseRun(name,action){
 const row={name,status:'FAILED'};report.cases.push(row);
 const page=await browser.newPage({acceptDownloads:true});
 try{
  Object.assign(row,await action(page),{status:'PASSED'});
  console.log('P49_BROWSER '+name+' PASSED');
 }catch(e){
  row.error=String(e?.stack||e).slice(0,1000);
  console.error('P49_BROWSER '+name+' FAILED '+row.error);
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
  check(ready,'Local build server unavailable');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await caseRun('valid_ISO_calendar_date_roundtrip',async page=>{
  await open(page,'geojson-to-shp');
  check(await upload(page,geo({VisitDate:'2024-02-29',Name:'Valid sample'}),'date.geojson'),
   'Valid ISO date with a short property name was rejected');
  const bytes=await download(page,'#download');
  const dbf=await readUtf8ShapefileDbf(new Uint8Array(bytes));
  const field=dbf.lookup.get('VisitDate');
  check(Boolean(field),'Date column missing from emitted DBF');
  const date=readComparableDbfValue(dbf,0,field);
  check((date.kind==='text'||date.kind==='date')&&date.value==='2024-02-29',
   'Date bytes changed or became an unsupported DBF date');
  const q=await quality(page);
  check(q.checks.find(c=>c.id==='dbf-attribute-values')?.status==='pass',
   'Date output was delivered without independent comparable value match');
  return {datePreserved:true,fieldType:field.type,fidelity:'pass'};
 });
 await caseRun('Boolean_type_preserved_or_output_withheld',async page=>{
  await open(page,'geojson-to-shp');
  const success=await upload(page,geo({Flag:true,Title:'Booleans matter'}),'boolean.geojson');
  if(!success){
   check(await page.locator('#result').isHidden(),'Rejected Boolean output remains visible');
   return {outcome:'not-delivered'};
  }
  const dbf=await readUtf8ShapefileDbf(new Uint8Array(await download(page,'#download')));
  const field=dbf.lookup.get('Flag');
  check(field?.type==='L','Boolean converted to non-Boolean DBF type without withholding');
  check(readComparableDbfValue(dbf,0,field).value===true,'Boolean value changed');
  const q=await quality(page);
  check(q.checks.find(c=>c.id==='dbf-attribute-values')?.status==='pass',
   'Boolean was shipped without exact typed comparison');
  return {outcome:'native-logical-verified'};
 });
 await caseRun('casefold_colliding_field_names_not_certified',async page=>{
  await open(page,'geojson-to-shp');
  const success=await upload(page,geo({Name:'One',name:'Two'}),'collision.geojson');
  if(!success){
   check(await page.locator('#result').isHidden(),'Unsafe collision output shown');
   return {outcome:'not-delivered'};
  }
  const q=await quality(page);
  check(q.checks.find(c=>c.id==='shp-field-limits')?.status==='review',
   'Casefold collision risk missing from report');
  check(q.checks.find(c=>c.id==='dbf-attribute-values')?.status!=='pass',
   'Two casefold aliases were falsely certified as independent');
  return {outcome:'warning-without-certification'};
 });
 await caseRun('blank_string_NULL_and_text_not_falsely_certified',async page=>{
  await open(page,'geojson-to-shp');
  const success=await upload(page,geo({Blank:'',Nullish:null,Name:'Present'}),'blanks.geojson');
  if(!success){
   check(await page.locator('#result').isHidden(),'Failed conversion exposed result');
   return {outcome:'not-delivered'};
  }
  const q=await quality(page);
  check(q.checks.find(c=>c.id==='shp-value-limits')?.status==='review',
   'Blank/NULL compatibility risk missing');
  check(q.checks.find(c=>c.id==='dbf-attribute-values')?.status==='unavailable',
   'Blank/NULL was falsely certified as precise');
  return {outcome:'partial-validation-with-risk'};
 });
 report.status=report.cases.length===report.expected&&report.cases.every(c=>c.status==='PASSED')?'PASSED':'FAILED';
}catch(e){report.error=String(e?.stack||e).slice(0,1000)}
finally{
 await browser?.close();
 if(server)server.kill();
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log('P49_BROWSER_REPORT '+JSON.stringify({status:report.status,passed:report.cases.filter(c=>c.status==='PASSED').length,expected:report.expected}));
}
if(report.status!=='PASSED')process.exitCode=1;
