/** P29 local static-server preflight for the exact same real browser suite used on public Pages. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const port=8786,origin='http://127.0.0.1:'+port;
const server=spawn('python3',['-m','http.server',String(port),'--directory','dist'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let status=1;
try{
 let ready=false;
 for(let i=0;i<65;i++){
  try{if((await fetch(origin+'/')).ok){ready=true;break}}catch{}
  if(server.exitCode!==null)throw Error('P29 test web server exited before accepting requests');
  await sleep(300);
 }
 if(!ready)throw Error('P29 local GIS QA web server was not ready');
 const child=spawn(process.execPath,['scripts/p29-live-complex-gis.mjs'],
  {env:{...process.env,GIS_BASE_URL:origin},stdio:'inherit'});
 status=await new Promise((resolve,reject)=>{
  child.on('exit',code=>resolve(code??1));
  child.on('error',reject);
 });
}catch(e){
 console.error('P29 local preflight failure: '+String(e?.stack||e));
}finally{
 server.kill();
 if(fs.existsSync('p29-complex-live-results.json')){
  try{
   const original=JSON.parse(fs.readFileSync('p29-complex-live-results.json','utf8'));
   original.environment='local-static-server';
   fs.writeFileSync('p29-complex-local-results.json',JSON.stringify(original,null,2));
  }catch(e){console.error('Unable to save P29 local report '+String(e))}
 }
}
if(status!==0)process.exitCode=1;
