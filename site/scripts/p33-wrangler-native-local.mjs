/**
 * Run the same P33 native GDAL interoperability tests against an actual local
 * Cloudflare Wrangler Pages Function (gzip-only WASM). No production writes.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8799,origin='http://127.0.0.1:'+port;
const server=spawn('./node_modules/.bin/wrangler',
 ['pages','dev','dist','--ip','127.0.0.1','--port',String(port),
  '--compatibility-date','2026-11-11'],
 {stdio:['ignore','pipe','pipe']});
let logs='',child,status=1;
for(const stream of [server.stdout,server.stderr])stream.on('data',d=>{
 logs=(logs+d.toString()).slice(-2600);
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={kind:'p33-native-ogr-local-wrangler-precondition',origin,status:'FAILED',
 rawWasmAbsent:!fs.existsSync('dist/engine/gdal3/gdal3WebAssembly.wasm'),
 compressedWasmPresent:fs.existsSync('dist/engine/gdal3/gdal3WebAssembly.wasm.gz')};
try{
 if(!report.rawWasmAbsent||!report.compressedWasmPresent)
  throw Error('P33 requires real Cloudflare gzip-only GDAL WASM staging');
 let ready=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(origin+'/',{signal:AbortSignal.timeout(1500)})).ok){ready=true;break}}catch{}
  if(server.exitCode!==null)throw Error('Wrangler exited: '+logs);
  await sleep(250);
 }
 if(!ready)throw Error('P33 Wrangler local Pages site not ready: '+logs);
 const response=await fetch(origin+'/engine/gdal3/gdal3WebAssembly.wasm',
  {signal:AbortSignal.timeout(60000)});
 const buffer=Buffer.from(await response.arrayBuffer());
 report.wasmBytes=buffer.length;
 report.wasmMagic=buffer.subarray(0,4).toString('hex');
 if(!response.ok||buffer.length!==28219835||report.wasmMagic!=='0061736d')
  throw Error('P33 Wrangler compressed Pages function returned invalid GDAL WebAssembly bytes');
 report.status='PASSED';
 child=spawn(process.execPath,['scripts/p33-native-ogr-compat.mjs'],
  {env:{...process.env,GIS_BASE_URL:origin},stdio:'inherit'});
 status=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
}catch(e){report.error=String(e?.stack||e).slice(0,2000)}
finally{
 child?.kill();
 server.kill('SIGTERM');
 fs.writeFileSync('p33-native-local-preflight.json',JSON.stringify(report,null,2));
 console.log('P33_WRANGLER_SUMMARY '+JSON.stringify(report));
 if(!fs.existsSync('p33-native-local-results.json'))
  fs.writeFileSync('p33-native-local-results.json',
   JSON.stringify({status:'FAILED',reason:'P33 native browser tester did not run'},null,2));
}
if(status!==0)process.exitCode=1;
