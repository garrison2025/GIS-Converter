/** Run the exact public P31 mobile UX suite against a real local Astro/GDAL build. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8796,origin='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let child,exitCode=1;
try{
 let ready=false;
 for(let i=0;i<70;i++){
  try{if((await fetch(origin+'/')).ok){ready=true;break}}catch{}
  if(server.exitCode!==null)throw Error('Static test server terminated unexpectedly');
  await pause(220);
 }
 if(!ready)throw Error('Built GIS site unavailable for P31 browser tests');
 child=spawn(process.execPath,['scripts/p31-mobile-ux-qa.mjs'],{
  env:{...process.env,GIS_BASE_URL:origin},stdio:'inherit'});
 exitCode=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
}catch(e){console.error('P31 local browser preflight failure '+String(e?.stack||e))}
finally{
 child?.kill();server.kill();
 if(!fs.existsSync('p31-mobile-local-results.json')){
  fs.writeFileSync('p31-mobile-local-results.json',
   JSON.stringify({status:'FAILED',reason:'QA aborted before output'}));
 }
}
if(exitCode!==0)process.exitCode=1;
