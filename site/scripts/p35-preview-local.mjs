/** P35: real local static Astro+GDAL browser preview QA with no accounts or web uploads. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8797,origin='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,status=1;
try{
 let available=false;
 for(let i=0;i<90;i++){
  try{if((await fetch(origin+'/')).ok){available=true;break}}catch{}
  if(server.exitCode!==null)throw Error('P35 static server exited early');
  await sleep(250);
 }
 if(!available)throw Error('P35 built Astro/GDAL local site unavailable');
 child=spawn(process.execPath,['scripts/p35-preview-browser-qa.mjs'],
  {env:{...process.env,GIS_BASE_URL:origin},stdio:'inherit'});
 status=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
}catch(e){console.error('P35 local browser preview QA failed '+String(e?.stack||e))}
finally{
 child?.kill();server.kill('SIGTERM');
 if(!fs.existsSync('p35-preview-local-results.json'))
  fs.writeFileSync('p35-preview-local-results.json',
   JSON.stringify({status:'FAILED',reason:'Preview browser checks did not start'},null,2));
}
if(status!==0)process.exitCode=1;
