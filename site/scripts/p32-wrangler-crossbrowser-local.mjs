/**
 * P32 locally exercise the exact Cloudflare Pages Function that serves
 * compressed GDAL WebAssembly, then run the same Chromium/Firefox/WebKit
 * acceptance suite used on the public Pages URL.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8798,origin='http://127.0.0.1:'+port;
const proc=spawn('./node_modules/.bin/wrangler',
 ['pages','dev','dist','--ip','127.0.0.1','--port',String(port),
  '--compatibility-date','2026-11-11'],
 {stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let logs='',child,code=1;
proc.stdout.on('data',d=>{logs=(logs+d.toString()).slice(-3500)});
proc.stderr.on('data',d=>{logs=(logs+d.toString()).slice(-3500)});
const evidence={kind:'p32-wrangler-compressed-webassembly-preflight',
 status:'FAILED',origin,rawWasmAbsent:!fs.existsSync('dist/engine/gdal3/gdal3WebAssembly.wasm'),
 gzipWasmPresent:fs.existsSync('dist/engine/gdal3/gdal3WebAssembly.wasm.gz')};
try{
 if(!evidence.rawWasmAbsent||!evidence.gzipWasmPresent)
  throw Error('Refusing P32 local test without true Cloudflare gzip-only WASM package');
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(origin+'/',{signal:AbortSignal.timeout(1500)})).ok){ready=true;break}}
  catch{}
  if(proc.exitCode!==null)throw Error('Wrangler exited: '+logs);
  await sleep(300);
 }
 if(!ready)throw Error('Wrangler did not start: '+logs);
 const res=await fetch(origin+'/engine/gdal3/gdal3WebAssembly.wasm',
  {signal:AbortSignal.timeout(60000)});
 const wasm=new Uint8Array(await res.arrayBuffer());
 evidence.wasmStatus=res.status;
 evidence.uncompressedBytes=wasm.byteLength;
 evidence.magic=Buffer.from(wasm.subarray(0,4)).toString('hex');
 if(!res.ok||evidence.magic!=='0061736d'||evidence.uncompressedBytes<25*1024*1024)
  throw Error('Wrangler Pages Function failed to decompress real GDAL WASM');
 evidence.status='PASSED';
 child=spawn(process.execPath,['scripts/live-crossbrowser-qa.mjs'],{
  env:{...process.env,GIS_BASE_URL:origin,
    GIS_CROSSBROWSER_REPORT:'p32-crossbrowser-local-results.json'},
  stdio:'inherit'
 });
 code=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',exitCode=>resolve(exitCode??1));
 });
}catch(e){evidence.failure=String(e?.stack||e).slice(0,1700)}
finally{
 fs.writeFileSync('p32-wrangler-preflight.json',JSON.stringify(evidence,null,2));
 console.log('P32_WRANGLER '+JSON.stringify(evidence));
 if(code!==0&&!fs.existsSync('p32-crossbrowser-local-results.json'))
  fs.writeFileSync('p32-crossbrowser-local-results.json',
   JSON.stringify({status:'FAILED',reason:'P32 cross-browser browser tests were not run'},null,2));
 child?.kill();proc.kill('SIGTERM');
}
if(code!==0)process.exitCode=1;
