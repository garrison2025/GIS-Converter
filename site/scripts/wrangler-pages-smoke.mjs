import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {chromium} from 'playwright';
const port=8792,root='http://127.0.0.1:'+port;
const proc=spawn('./node_modules/.bin/wrangler',['pages','dev','dist','--ip','127.0.0.1','--port',String(port),'--compatibility-date','2026-11-11'],{stdio:['ignore','pipe','pipe']});
let logs='',browser;
proc.stdout.on('data',d=>logs+=d.toString());proc.stderr.on('data',d=>logs+=d.toString());
const report={status:'RUNNING',wranglerPort:port,rawWasmAbsent:!fs.existsSync('dist/engine/gdal3/gdal3WebAssembly.wasm')};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 if(!report.rawWasmAbsent)throw Error('Raw 28MB WASM is still in Pages build');
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(root+'/')).ok){ready=true;break}}catch{}
  if(proc.exitCode!==null)throw Error('Wrangler terminated early: '+logs.slice(-1500));
  await sleep(350);
 }
 if(!ready)throw Error('Wrangler did not start: '+logs.slice(-1800));
 const bytesResponse=await fetch(root+'/engine/gdal3/gdal3WebAssembly.wasm');
 report.wasmStatus=bytesResponse.status;
 report.contentEncoding=bytesResponse.headers.get('content-encoding');
 const bytes=await bytesResponse.arrayBuffer();
 report.decodedWasmBytes=bytes.byteLength;
 const magic=Buffer.from(bytes).subarray(0,4).toString('hex');
 if(!bytesResponse.ok||magic!=='0061736d'||bytes.byteLength!==28219835)throw Error('Pages Function gzip WASM invalid status/bytes: '+JSON.stringify(report));
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(root+'/internal/matrix/');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:120000});
 report.matrix=await page.evaluate(()=>window.__matrixResult);report.pageErrors=errors;
 if(report.matrix.status!=='PASSED'||report.matrix.tested.length!==6||errors.length)throw Error('Wrangler Pages function browser GDAL failed');
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e);report.tailLogs=logs.slice(-2200)}
finally{
 fs.writeFileSync('wrangler-pages-result.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 await browser?.close();proc.kill('SIGTERM');
}
if(report.status!=='PASSED')process.exitCode=1;
