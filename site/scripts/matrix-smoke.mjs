import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const server=spawn('python3',['-m','http.server','8767','--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
try{
 let online=false;
 for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:8767/');if(r.ok){online=true;break}}catch{}await sleep(250)}
 if(!online)throw Error('Static server unavailable');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8767/internal/matrix/?all=1');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:180000});
 const result=await page.evaluate(()=>window.__matrixResult);result.pageErrors=errors;
 writeFileSync('gdal-route-matrix.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(result.status!=='PASSED'||errors.length)process.exitCode=1;
}catch(e){console.error(e);process.exitCode=1}
finally{await browser?.close();server.kill()}
