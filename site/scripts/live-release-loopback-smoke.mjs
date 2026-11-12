/**
 * P27: exercise the read-only live release verifier against an actual HTTP
 * server over loopback, including old-SHA and HTML-fallback rejection.
 * No external web traffic or Cloudflare authentication is involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const dist=path.resolve('dist'),report={kind:'p27-release-loopback',status:'FAILED',cases:[]};
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'release.json'),'utf8'));
let serveFallback=false,server;
const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
async function runVerifier(port,expectedCommit){
 const env={...process.env,GIS_BASE_URL:'http://127.0.0.1:'+port,
  GIS_EXPECTED_COMMIT:expectedCommit,GIS_EXPECTED_BRANCH:manifest.branch};
 const child=spawn(process.execPath,['scripts/live-release-gate.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',d=>stdout+=d);
 child.stderr.on('data',d=>stderr+=d);
 const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});
 const latest=JSON.parse(fs.readFileSync('live-release-gate.json','utf8'));
 return {code,latest,stderr:stderr.slice(-450),stdout:stdout.slice(-450)};
}
try{
 server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname.includes('..')||pathname.includes('\0')){res.writeHead(400).end();return}
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
  const candidate=path.join(dist,relative);
  const resolved=fs.statSync(candidate,{throwIfNoEntry:false})?.isDirectory()?
   path.join(candidate,'index.html'):candidate;
  let actual=resolved;
  if(serveFallback&&pathname==='/release.json')actual=path.join(dist,'index.html');
  if(!actual.startsWith(dist+path.sep)||!fs.existsSync(actual)){
   res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not Found');return
  }
  const type=types[path.extname(actual)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
  fs.createReadStream(actual).pipe(res);
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 const port=server.address().port;
 const valid=await runVerifier(port,manifest.commit);
 assert.equal(valid.code,0,'Valid release verifier failed: '+valid.stderr+' '+valid.stdout);
 assert.equal(valid.latest.status,'PASSED');
 assert.equal(valid.latest.checks.length,4);
 report.cases.push({name:'Matching live JSON SHA and 19 noindex converter links',status:'PASSED'});
 const older='f'.repeat(40)===manifest.commit?'e'.repeat(40):'f'.repeat(40);
 const mismatch=await runVerifier(port,older);
 assert.notEqual(mismatch.code,0,'Mismatching deployed SHA was wrongly accepted');
 assert.equal(mismatch.latest.status,'FAILED');
 assert.match(mismatch.latest.failure,/SHA mismatch/);
 report.cases.push({name:'Older/incorrect Pages deployed SHA fails closed',status:'PASSED'});
 serveFallback=true;
 const fallback=await runVerifier(port,manifest.commit);
 assert.notEqual(fallback.code,0,'HTML homepage masquerading as release JSON was accepted');
 assert.equal(fallback.latest.status,'FAILED');
 assert.match(fallback.latest.failure,/fallback|not JSON/i);
 report.cases.push({name:'Cloudflare-style 200 HTML fallback is rejected as fake release.json',status:'PASSED'});
 report.status='PASSED';
}catch(e){report.failure=String(e?.stack||e)}
finally{
 await new Promise(resolve=>server?.close(resolve)??resolve());
 fs.writeFileSync('p27-live-loopback-results.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
