import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import JSZip from 'jszip';
const port=8771;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root='http://127.0.0.1:'+port;
let browser;
const report={status:'RUNNING',pages:0,tests:[],pageErrors:[]};
try{
 let ready=false;
 for(let i=0;i<50;i++){try{if((await fetch(root+'/')).ok){ready=true;break}}catch{}await sleep(300)}
 if(!ready)throw Error('Cannot start staging server');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({acceptDownloads:true});
 await page.addInitScript(() => {const Original=window.Worker;window.__workerCreated=0;window.Worker=class extends Original{constructor(...args){super(...args);window.__workerCreated++}}});
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 await page.goto(root+'/');
 report.pages=await page.locator('a[href^="/converter/"]').count();
 if(report.pages!==19)throw Error('Expected 19 tool links, found '+report.pages);
 const kml='<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>UI Test</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
 const csv='longitude,latitude,Name\n116.4,39.9,UI Test\n';
 const kmzZip=new JSZip();kmzZip.file('doc.kml',kml);
 const samples=[
   {slug:'kml-to-geojson',name:'test.kml',mime:'application/vnd.google-earth.kml+xml',bytes:Buffer.from(kml),ext:'.geojson'},
   {slug:'csv-to-kml',name:'test.csv',mime:'text/csv',bytes:Buffer.from(csv),ext:'.kml'},
   {slug:'kmz-to-shp',name:'test.kmz',mime:'application/vnd.google-earth.kmz',bytes:Buffer.from(await kmzZip.generateAsync({type:'uint8array'})),ext:'.zip'}
 ];
 for(const t of samples){
   await page.goto(root+'/converter/'+t.slug+'/');
   if(await page.locator('meta[name="robots"]').getAttribute('content')!=='noindex,nofollow')throw Error('Unreleased page not noindexed');
   await page.locator('#file').setInputFiles({name:t.name,mimeType:t.mime,buffer:t.bytes});
   await page.locator('#submit').click();
   try{await page.locator('#result').waitFor({state:'visible',timeout:60000})}
   catch(e){throw Error(t.slug+' failed: '+await page.locator('#error').textContent())}
   const downloadWait=page.waitForEvent('download');
   await page.locator('#download').click();
   const download=await downloadWait;
   if(!download.suggestedFilename().endsWith(t.ext))throw Error(t.slug+' wrong extension');
   const path=await download.path();const content=fs.readFileSync(path);
   if(content.length===0)throw Error('Empty downloaded output');
   if(t.ext==='.geojson'){
      const f=JSON.parse(content.toString()).features;
      if(!f?.length || Math.abs(f[0].geometry.coordinates[0]-116.4)>.001)throw Error('UI GeoJSON geometry incorrect');
   }
   if(t.ext==='.kml'&&!content.toString().includes('<kml'))throw Error('UI KML invalid');
   if(t.ext==='.zip'){
      const z=await JSZip.loadAsync(content);for(const ext of ['.shp','.shx','.dbf'])if(!Object.keys(z.files).some(n=>n.endsWith(ext)))throw Error('SHP ZIP lacks '+ext);
   }
   const workers=await page.evaluate(()=>window.__workerCreated);
   if(workers<1)throw Error(t.slug+' did not initialize the expected Web Worker');
   report.tests.push({route:t.slug,status:'PASSED',bytes:content.length,createdWorkers:workers});
 }
 report.status=report.pageErrors.length?'FAILED':'PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e);console.error(report.error)}
finally{fs.writeFileSync('astro-tool-ui-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
