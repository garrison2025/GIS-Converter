// Multi-feature real GDAL browser stress regression; no made-up memory benchmark.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {chromium} from 'playwright';
import JSZip from 'jszip';
const server=spawn('python3',['-m','http.server','8778','--directory','dist'],{stdio:'ignore'});
const root='http://127.0.0.1:8778';
let browser;
const N=12000;
const report={status:'RUNNING',features:N};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function assert(v,message){if(!v)throw Error(message)}
try{
 let ready=false;
 for(let i=0;i<50;i++){try{if((await fetch(root+'/')).ok){ready=true;break}}catch{}await sleep(250)}
 assert(ready,'local staging HTTP server unavailable');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({acceptDownloads:true});
 const errors=[];page.on('pageerror',err=>errors.push(String(err)));
 await page.addInitScript(()=>{
   const NativeWorker=window.Worker;
   window.__stressWorkerCreated=0;window.__stressWorkerStopped=0;
   window.Worker=class extends NativeWorker{
     constructor(...args){super(...args);window.__stressWorkerCreated++}
     terminate(){window.__stressWorkerStopped++;return super.terminate()}
   }
 });
 const features=Array.from({length:N},(_,i)=>({
   type:'Feature',properties:{Name:i%2?'北京':'Island '+i,seq:i},
   geometry:{type:'Point',coordinates:[116.4+(i%200)*.0001,39.9+Math.floor(i/200)*.0001]}
 }));
 const geojson=JSON.stringify({type:'FeatureCollection',features});
 report.inputBytes=Buffer.byteLength(geojson);
 assert(report.inputBytes<15*1024*1024,'stress fixture exceeds engineering input limit');
 await page.goto(root+'/converter/geojson-to-shp/');
 await page.locator('#file').setInputFiles({name:'many.geojson',mimeType:'application/geo+json',buffer:Buffer.from(geojson)});
 const start=Date.now();await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:90000})}
 catch{throw Error('Large fixture conversion failed: '+await page.locator('#error').textContent())}
 report.conversionWallMs=Date.now()-start;
 const dp=page.waitForEvent('download');await page.locator('#download').click();
 const download=await dp;
 assert(download.suggestedFilename()==='converted-shapefile.zip','wrong download name');
 const file=fs.readFileSync(await download.path()),zip=await JSZip.loadAsync(file);
 const names=Object.keys(zip.files);
 const dbfName=names.find(n=>n.endsWith('.dbf')),shpName=names.find(n=>n.endsWith('.shp')),shxName=names.find(n=>n.endsWith('.shx'));
 assert(dbfName&&shpName&&shxName,'missing shapefile components');
 const [dbf,shp,shx]=await Promise.all([zip.file(dbfName).async('uint8array'),zip.file(shpName).async('uint8array'),zip.file(shxName).async('uint8array')]);
 const dbfView=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 const shpView=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
 const shxView=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
 const count=dbfView.getUint32(4,true);
 assert(count===N,'DBF record count changed '+count);
 assert((shx.byteLength-100)/8===N,'SHX index record count changed');
 const prj=names.find(n=>n.endsWith('.prj')),cpg=names.find(n=>n.endsWith('.cpg'));
 assert(prj&&cpg,'CRS or charset metadata missing');
 const encoding=await zip.file(cpg).async('string');
 assert(encoding.toUpperCase().includes('UTF-8'),'UTF-8 marker missing');
 function pointFromIndex(index){
  const off16=shxView.getInt32(100+index*8,false);
  const offset=off16*2;
  assert(offset+28<=shp.byteLength,'SHP record offset outside file');
  const shapeType=shpView.getInt32(offset+8,true);
  assert(shapeType===1,'Expected point shape '+shapeType);
  return [shpView.getFloat64(offset+12,true),shpView.getFloat64(offset+20,true)];
 }
 for(const i of [0,123,N-1]){
  const point=pointFromIndex(i);
  assert(Math.abs(point[0]-features[i].geometry.coordinates[0])<1e-7 && Math.abs(point[1]-features[i].geometry.coordinates[1])<1e-7,'point '+i+' coordinates changed');
 }
 const workers=await page.evaluate(()=>({created:window.__stressWorkerCreated,terminated:window.__stressWorkerStopped}));
 assert(workers.created===1&&workers.terminated===1,'Worker lifetime not cleaned '+JSON.stringify(workers));
 assert(errors.length===0,'Uncaught page errors '+errors.join(';'));
 report.status='PASSED';
 report.records=count;
 report.zipBytes=file.length;report.shpBytes=shp.byteLength;
 report.workers=workers;report.pageErrors=errors;
 report.samples=[0,123,N-1].map(i=>({i,point:pointFromIndex(i)}));
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{fs.writeFileSync('gis-stress-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
