import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const server=spawn('python3',['-m','http.server','8765','--directory','dist'],{stdio:'ignore'});
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let ready=false;
 for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:8765/');if(r.ok){ready=true;break}}catch{} await sleep(300)}
 if(!ready)throw new Error('Local staging server did not start');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const consoleErrors=[];page.on('pageerror',e=>consoleErrors.push(String(e)));
 await page.goto('http://127.0.0.1:8765/internal/gdal-smoke/',{waitUntil:'load'});
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:120000});
 const report=await page.evaluate(()=>window.__gdalResult);
 report.pageErrors=consoleErrors;
 fs.writeFileSync('gdal-browser-result.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='PASSED'||consoleErrors.length)process.exitCode=1;
}catch(err){console.error(err);process.exitCode=1}finally{await browser?.close();server.kill()}
