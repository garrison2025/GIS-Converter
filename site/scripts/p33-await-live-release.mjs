/**
 * P33 one-shot Cloudflare Pages live test precondition.
 * Wait for the exact merged GitHub commit SHA to appear in the public
 * release.json; never use a successful local/CI build as deployment proof.
 * Read-only. No credentials, uploads, or modifications to the remote site.
 */
import fs from 'node:fs';
const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const expected=(process.env.GIS_EXPECTED_COMMIT||process.env.GITHUB_SHA||'').toLowerCase();
const report={kind:'p33-live-deployment-wait',expectedCommit:expected,origin,
 status:'FAILED',startedAt:new Date().toISOString(),attempts:[],observedCommit:null};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 if(!/^[a-f0-9]{40}$/.test(expected))throw Error('Expected merged SHA missing or invalid');
 const parsed=new URL(origin);
 if(parsed.protocol!=='https:')throw Error('Live verification requires HTTPS origin');
 const maxAttempts=45,intervalMs=12000;
 for(let i=0;i<maxAttempts;i++){
  try{
   const url=origin+'/release.json?verify='+expected.slice(0,14)+'&attempt='+i;
   const response=await fetch(url,{signal:AbortSignal.timeout(12000),
    headers:{Accept:'application/json','Cache-Control':'no-cache',
     'User-Agent':'GIS-Converter-P33-OneShot-Live-Audit/1.0'}});
   const content=await response.text();
   let manifest;
   try{manifest=JSON.parse(content)}catch{manifest=null}
   const observed=typeof manifest?.commit==='string'?manifest.commit:null;
   report.attempts.push({number:i+1,httpStatus:response.status,
    validManifest:manifest?.schemaVersion===1,observedCommit:observed});
   report.observedCommit=observed;
   if(response.ok&&manifest?.schemaVersion===1&&manifest?.site==='GIS Converter'&&
      manifest.commit===expected&&manifest.branch==='main'&&manifest.converterRoutes===19){
    report.status='PASSED';break;
   }
  }catch(e){report.attempts.push({number:i+1,error:String(e?.message||e).slice(0,180)})}
  if(i+1<maxAttempts)await pause(intervalMs);
 }
 if(report.status!=='PASSED')throw Error('Live Cloudflare Pages release SHA still differs from merged main or is unavailable');
}catch(e){report.failure=String(e?.message||e)}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('p33-live-deployment-wait.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,attempts:report.attempts.slice(-6)},null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
