/** P34 verify real UI mini-batch on the built Astro/GDAL static site. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8784,origin='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],
 {stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,status=1;
try{
 let ready=false;
 for(let i=0;i<80;i++){
  try{if((await fetch(origin+'/')).ok){ready=true;break}}catch{}
  if(server.exitCode!==null)throw Error('Local static server exited early');
  await pause(250);
 }
 if(!ready)throw Error('Local P34 Astro bundle was not ready');
 child=spawn(process.execPath,['scripts/p34-mini-batch-qa.mjs'],{
  env:{...process.env,GIS_BASE_URL:origin},stdio:'inherit'});
 status=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
}catch(e){console.error('P34 local smoke failure '+String(e?.stack||e))}
finally{
 child?.kill();server.kill('SIGTERM');
 if(!fs.existsSync('p34-mini-batch-local-results.json'))
  fs.writeFileSync('p34-mini-batch-local-results.json',
   JSON.stringify({status:'FAILED',reason:'QA did not run'}));
}
if(status!==0)process.exitCode=1;
