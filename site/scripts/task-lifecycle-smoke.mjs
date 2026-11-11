import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8790,root='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;const report={status:'RUNNING',cases:[]};
try{
 let ready=false;
 for(let i=0;i<50;i++){try{if((await fetch(root+'/')).ok){ready=true;break}}catch{}await sleep(250)}
 if(!ready)throw Error('Cannot start staging HTTP server');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const unit=await browser.newPage();
 await unit.goto(root+'/internal/task-lifecycle/');
 await unit.waitForFunction(()=>document.body.dataset.done==='true',{timeout:20000});
 report.unit=await unit.evaluate(()=>window.__lifecycleResult);
 if(report.unit.status!=='PASSED'||report.unit.cases.length!==5)throw Error('Task lifecycle unit regression failed '+JSON.stringify(report.unit));
 const page=await browser.newPage({acceptDownloads:true});
 await page.addInitScript(()=>{
  const Native=window.Worker;
  window.__workerStarts=0;window.__workerStops=0;window.__holdFirstTask=true;
  window.Worker=class extends Native{
   constructor(...args){super(...args);window.__workerStarts++}
   postMessage(...args){
    if(window.__holdFirstTask){window.__holdFirstTask=false;return;}
    return super.postMessage(...args);
   }
   terminate(){window.__workerStops++;return super.terminate()}
  };
 });
 await page.goto(root+'/converter/kml-to-geojson/');
 const kml='<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Retry</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></kml>';
 await page.locator('#file').setInputFiles({name:'retry.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kml)});
 await page.locator('#submit').click();
 await page.locator('#cancel').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('cancelled'),{timeout:10000});
 const before=await page.evaluate(()=>({starts:window.__workerStarts,stops:window.__workerStops,resultHidden:document.querySelector('#result').hidden,canSubmit:!document.querySelector('#submit').disabled,canChoose:!document.querySelector('#file').disabled}));
 if(before.starts!==1||before.stops!==1||!before.resultHidden||!before.canSubmit||!before.canChoose)throw Error('Real cancellation did not clean up UI and worker: '+JSON.stringify(before));
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:60000})}
 catch{throw Error('Retry conversion failed: '+await page.locator('#error').textContent())}
 const dlPromise=page.waitForEvent('download');
 await page.locator('#download').click();
 const dl=await dlPromise;
 const output=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));
 const coords=output.features?.[0]?.geometry?.coordinates;
 if(!coords||Math.abs(coords[0]-116.4)>.0001||Math.abs(coords[1]-39.9)>.0001)throw Error('Retry output coordinates mismatched');
 const after=await page.evaluate(()=>({starts:window.__workerStarts,stops:window.__workerStops,cancelHidden:document.querySelector('#cancel').hidden}));
 if(after.starts!==2||after.stops!==2||!after.cancelHidden)throw Error('Retry did not clean up worker: '+JSON.stringify(after));
 report.browser={status:'PASSED',before,after,coords};
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{fs.writeFileSync('task-lifecycle-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
