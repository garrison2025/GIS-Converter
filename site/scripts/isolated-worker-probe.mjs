import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import fs from 'node:fs';
const server=spawn('python3',['-m','http.server','8788','--directory','dist'],{stdio:'ignore'});
let browser; const report={status:'RUNNING'};
try{
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:8788/')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:8788/');
 const result=await page.evaluate(async()=>{
  return await new Promise(resolve=>{
   const w=new Worker('/internal/isolated/worker.js');
   const timer=setTimeout(()=>{w.terminate();resolve({type:'timeout'})},60000);
   w.onmessage=e=>{clearTimeout(timer);w.terminate();resolve(e.data)};
   w.onerror=e=>{clearTimeout(timer);w.terminate();resolve({type:'onerror',error:e.message})};
   w.postMessage({type:'convert'});
  });
 });
 report.test=result;
 if(result.type!=='done')throw new Error(JSON.stringify(result));
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{fs.writeFileSync('isolated-worker-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
