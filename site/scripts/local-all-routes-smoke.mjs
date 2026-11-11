import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const port=8791,base='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child;
let code=1;
try{
 let ready=false;
 for(let i=0;i<50;i++){try{if((await fetch(base+'/')).ok){ready=true;break}}catch{}await sleep(200)}
 if(!ready)throw Error('Local Astro site unavailable');
 code=await new Promise((resolve,reject)=>{
  child=spawn(process.execPath,['scripts/live-all-routes.mjs'],{env:{...process.env,GIS_BASE_URL:base},stdio:'inherit'});
  child.on('error',reject);child.on('close',status=>resolve(status??1));
 });
}catch(e){writeFileSync('all-ui-gate-error.txt',String(e?.stack||e));console.error(e)}
finally{child?.kill();server.kill()}
if(code!==0)process.exitCode=1;
