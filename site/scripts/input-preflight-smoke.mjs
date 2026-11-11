import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const port=8797,root='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
let browser;
const report={status:'RUNNING',cases:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let ok=false;for(let i=0;i<60;i++){try{if((await fetch(root+'/')).ok){ok=true;break}}catch{}await sleep(250)}
 if(!ok)throw Error('HTTP not running');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(String(e)));
 await page.goto(root+'/internal/preflight/');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:40000});
 const tests=await page.evaluate(()=>window.__preflightResult);
 report.cases=tests.cases;report.pageErrors=runtimeErrors;
 if(tests.status!=='PASSED'||tests.cases.length!==19||runtimeErrors.length)
  throw Error('Preflight checks failed: '+JSON.stringify(report));
 // Verify actual converter worker rejects a malformed KMZ before fetching the GDAL WASM.
 const upload=await browser.newPage();
 const requests=[];upload.on('request',request=>{if(request.url().includes('gdal3WebAssembly.wasm'))requests.push(request.url())});
 await upload.goto(root+'/converter/kmz-to-shp/');
 await upload.locator('#file').setInputFiles({name:'forged.kmz',mimeType:'application/zip',buffer:Buffer.from('NOT A ZIP')});
 await upload.locator('#submit').click();
 await upload.waitForFunction(()=>document.querySelector('#error')?.hidden===false,{timeout:20000});
 const text=await upload.locator('#error').textContent();
 if(!text.includes('invalid ZIP')||requests.length)throw Error('Unsafe ZIP reached WASM runtime or wrong error: '+JSON.stringify({text,requests}));
 report.workerSafety={passed:true,reason:text,gdalWasmRequests:requests.length};
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{writeFileSync('input-preflight-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;