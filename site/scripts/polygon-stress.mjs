/**
 * P17 engineering gate: real GDAL/WASM, 3,000 polygon features with holes.
 * Independently checks SHP ring records/SHX offsets and DBF UTF-8 field values.
 * Process RSS is a CI runner observation, not a device memory requirement or WebAssembly heap size.
 */
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {chromium} from 'playwright';
import JSZip from 'jszip';
const origin='http://127.0.0.1:8784', N=3000, report={status:'RUNNING',features:N};
const server=spawn('python3',['-m','http.server','8784','--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(v,m){if(!v)throw Error(m)}
const near=(a,b,epsilon=2e-7)=>Math.abs(a-b)<epsilon;
let browser,tick;
function browserRSS(pid){
 if(!pid)return null;
 try{
  const rows=execFileSync('ps',['-e','-o','pid=,ppid=,rss='],{encoding:'utf8',timeout:1500}).trim().split('\n').map(row=>row.trim().split(/\s+/).map(Number));
  const parents=new Map(rows.map(([id,parent])=>[id,parent]));
  const childOf=id=>{
   const seen=new Set();
   while(id>0&&!seen.has(id)){
    if(id===pid)return true;
    seen.add(id);id=parents.get(id)||0;
   }
   return false;
  };
  return rows.filter(([id])=>childOf(id)).reduce((n,row)=>n+(row[2]||0),0);
 }catch{return null}
}
try{
 let available=false;
 for(let i=0;i<60;i++){try{if((await fetch(origin+'/')).ok){available=true;break}}catch{}await sleep(200)}
 check(available,'Local built-site web server unavailable');
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-precise-memory-info']});
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:800}});
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 await page.addInitScript(()=>{
  const Base=window.Worker;window.__workers={created:0,terminated:0};
  window.Worker=class extends Base{
   constructor(...args){super(...args);window.__workers.created++}
   terminate(){window.__workers.terminated++;return super.terminate()}
  };
 });
 const features=Array.from({length:N},(_,i)=>{
  const x=100+(i%100)*.011,y=19+Math.floor(i/100)*.011;
  const outer=[[x,y],[x,y+.008],[x+.008,y+.008],[x+.008,y],[x,y]];
  const inner=[[x+.002,y+.002],[x+.005,y+.002],[x+.005,y+.005],[x+.002,y+.005],[x+.002,y+.002]];
  return {type:'Feature',properties:{Label:'北京Polygon-'+i,Seq:i,LongPropertyOne:'A'+i,LongPropertyTwo:'B'+i},
   geometry:{type:'Polygon',coordinates:[outer,inner]}};
 });
 const geojson=JSON.stringify({type:'FeatureCollection',features});
 report.inputBytes=Buffer.byteLength(geojson);
 check(report.inputBytes>300000 && report.inputBytes<15*1048576,'Synthetic fixture size invalid');
 await page.goto(origin+'/converter/geojson-to-shp/',{waitUntil:'domcontentloaded'});
 await page.locator('#file').setInputFiles({name:'large-polygons.geojson',mimeType:'application/geo+json',buffer:Buffer.from(geojson)});
 const before=await page.metrics(),pid=browser.process()?.pid;
 let peak=0,samples=0;
 const sample=()=>{const rss=browserRSS(pid);if(rss!==null){peak=Math.max(rss,peak);samples++}};
 sample();tick=setInterval(sample,220);
 const start=Date.now();
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
 catch{throw Error('Polygon conversion failed: '+await page.locator('#error').textContent()+' / '+await page.locator('#status').textContent())}
 report.elapsedMs=Date.now()-start;
 clearInterval(tick);tick=null;sample();
 report.memory={chromiumProcessTreePeakRssKiB:peak||null,rssSampleCount:samples,
   jsHeapBeforeBytes:before.JSHeapUsedSize,jsHeapAfterBytes:(await page.metrics()).JSHeapUsedSize,
   caveat:'RSS is summed from Chromium processes on a GitHub CI runner and may double-count shared pages; JSHeapUsedSize excludes WASM linear memory.'};
 const qualityPromise=page.waitForEvent('download');
 await page.locator('#quality-download').click();
 const qualityDownload=await qualityPromise;
 const quality=JSON.parse(fs.readFileSync(await qualityDownload.path(),'utf8'));
 const findCheck=id=>quality.checks.find(c=>c.id===id);
 check(quality.input.features===N && quality.output.features===N,'Quality report polygon feature counts differ');
 check(findCheck('feature-count')?.status==='pass','Quality report polygon feature count did not pass');
 check(findCheck('shp-field-limits')?.status==='review','Long Shapefile property names did not trigger review');
 check(findCheck('attribute-fidelity')?.status==='unavailable','Quality report falsely certified attributes');
 report.quality={status:quality.status,featuresIn:quality.input.features,featuresOut:quality.output.features,
   fieldLimit:findCheck('shp-field-limits')?.status,attributes:findCheck('attribute-fidelity')?.status};
 const dp=page.waitForEvent('download');
 await page.locator('#download').click();
 const downloaded=await dp;
 const archive=fs.readFileSync(await downloaded.path());
 const zip=await JSZip.loadAsync(archive);
 const names=Object.keys(zip.files);
 const get=async(ext)=>{
  const name=names.find(n=>n.toLowerCase().endsWith(ext));
  check(name,'Missing Shapefile component '+ext);
  return zip.file(name).async('uint8array');
 };
 const [shp,shx,dbf,prj,cpg]=await Promise.all([get('.shp'),get('.shx'),get('.dbf'),get('.prj'),get('.cpg')]);
 const shpView=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
 const shxView=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
 const dbfView=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 check(shpView.getInt32(0,false)===9994,'Unexpected SHP header code');
 check(shpView.getInt32(32,true)===5,'Expected polygon type 5');
 check(dbfView.getUint32(4,true)===N,'DBF record count does not match');
 check((shx.byteLength-100)/8===N,'SHX record count does not match');
 check(new TextDecoder().decode(cpg).toUpperCase().includes('UTF-8'),'UTF-8 code page missing');
 check(new TextDecoder().decode(prj).includes('WGS'),'WGS coordinate reference missing');
 const headerLength=dbfView.getUint16(8,true),recordLength=dbfView.getUint16(10,true);
 const fields=[];let startField=1;
 for(let at=32;at+32<=headerLength&&dbf[at]!==0x0d;at+=32){
  const nameBytes=dbf.subarray(at,at+11);const nullAt=nameBytes.indexOf(0);
  const name=new TextDecoder().decode(nullAt>=0?nameBytes.subarray(0,nullAt):nameBytes).trim();
  const length=dbf[at+16],type=String.fromCharCode(dbf[at+11]);
  check(name.length>0&&length>0,'Corrupted DBF field descriptor');
  fields.push({name,width:length,type,start:startField});
  startField+=length;
 }
 const fieldNames=fields.map(f=>f.name.toUpperCase());
 check(new Set(fieldNames).size===fields.length,'DBF field names collide');
 check(fields.every(f=>new TextEncoder().encode(f.name).length<=10),'DBF field name exceeds 10 bytes');
 const label=fields.find(f=>f.name.toLowerCase()==='label'),seq=fields.find(f=>f.name.toLowerCase()==='seq');
 check(label&&seq,'Short Label and Seq fields missing in DBF');
 check(fields.some(f=>f.name.toLowerCase().startsWith('longprop')),'Truncated long field name not found');
 check(headerLength+N*recordLength<=dbf.length,'DBF records outside file');
 const stringValue=(i,f)=>new TextDecoder('utf-8',{fatal:true}).decode(dbf.subarray(headerLength+i*recordLength+f.start,
  headerLength+i*recordLength+f.start+f.width)).trim();
 let featureRingIssues=0;
 const samples=[0,517,1500,N-1];const sampleCoords=[];
 for(let i=0;i<N;i++){
  const off=shxView.getInt32(100+i*8,false)*2;
  check(off>=100&&off+56<shp.length,'SHP index out of bounds '+i);
  const kind=shpView.getInt32(off+8,true),parts=shpView.getInt32(off+44,true);
  const count=shpView.getInt32(off+48,true);
  if(kind!==5||parts!==2||count!==10)featureRingIssues++;
  if(samples.includes(i)){
   const p0=shpView.getInt32(off+52,true);
   const p1=shpView.getInt32(off+56,true);
   check(p0===0&&p1===5,'Polygon hole part index changed '+i);
   const base=off+8+44+8;
   const x=shpView.getFloat64(base,true),y=shpView.getFloat64(base+8,true);
   const expected=features[i].geometry.coordinates[0][0];
   check(near(x,expected[0])&&near(y,expected[1]),'Sample polygon point drift '+i);
   check(stringValue(i,label)==='北京Polygon-'+i,'Unicode DBF label mismatch '+i);
   check(Number(stringValue(i,seq))===i,'Numeric DBF Seq mismatch '+i);
   sampleCoords.push({index:i,point:[x,y],labelOk:true,seqOk:true});
  }
 }
 check(featureRingIssues===0,'One or more polygon rings/parts changed: '+featureRingIssues);
 check(pageErrors.length===0,'Uncaught browser errors '+pageErrors.join('; '));
 const workers=await page.evaluate(()=>window.__workers);
 check(workers.created===1&&workers.terminated===1,'Worker lifecycle leak: '+JSON.stringify(workers));
 report.samples=sampleCoords;report.outputBytes=archive.length;report.shapefile={shapeType:5,
  featureCount:N,holeRings:N,fieldCount:fields.length,truncatedFieldNames:fields.filter(f=>f.name.toLowerCase().startsWith('longprop')).length,
  encoding:'UTF-8',sampledFields:sampleCoords.length};
 report.workers=workers;report.pageErrors=pageErrors;report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{if(tick)clearInterval(tick);fs.writeFileSync('gis-polygon-stress.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
