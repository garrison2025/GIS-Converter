/**
 * P27: manual, read-only live Pages release attestation.
 * No Cloudflare token, cookies, upload, payment API, or private state.
 * A missing manifest or mismatched SHA is a failed validation — never
 * infer the deployed version from GitHub Actions CI success.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const base=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const expected=(process.env.GIS_EXPECTED_COMMIT||process.env.GITHUB_SHA||
  execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()).toLowerCase();
const expectedBranch=process.env.GIS_EXPECTED_BRANCH||'main';
const report={kind:'p27-live-release-verification',site:base,expectedCommit:expected,
 expectedBranch,checkedAt:new Date().toISOString(),status:'FAILED',checks:[]};
const hash=/^[a-f0-9]{40}$/;
function assert(ok,message){if(!ok)throw Error(message)}
async function read(path){
 const response=await fetch(base+path,{signal:AbortSignal.timeout(30000),
  headers:{Accept:path==='/release.json'?'application/json':'text/html,*/*;q=0.8',
   'Cache-Control':'no-cache','User-Agent':'GIS-Converter-P27-ReadOnly-Release-Audit/1.0'}});
 assert(response.ok,'Origin returned HTTP '+response.status+' for '+path);
 const content=await response.text();
 assert(content.length<3*1024*1024,'Unexpected oversized live response at '+path);
 return {text:content,headers:response.headers,status:response.status};
}
async function check(label,fn){const details=await fn();report.checks.push({name:label,status:'PASSED',...details})}
try{
 const parsed=new URL(base);
 assert(parsed.protocol==='https:'||parsed.hostname==='127.0.0.1'||
  parsed.hostname==='localhost','Only HTTPS site URLs are accepted');
 assert(hash.test(expected),'Expected live GitHub SHA must be exactly 40 hex characters');
 assert(/^[a-zA-Z0-9._/-]{1,150}$/.test(expectedBranch),'Expected branch name invalid');
 await check('Public Pages release JSON is real and matches this GitHub commit',async()=>{
  const r=await read('/release.json');
  assert(!/^\s*<!doctype html/i.test(r.text),'Cloudflare fallback returned homepage instead of release JSON');
  let manifest;try{manifest=JSON.parse(r.text)}catch{throw Error('Live release.json is not JSON; deployment remains unverified')}
  assert(manifest.schemaVersion===1&&manifest.site==='GIS Converter','Unexpected Pages release schema');
  assert(manifest.commit===expected,'Deployed SHA mismatch: '+String(manifest.commit)+' != '+expected);
  assert(manifest.branch===expectedBranch,'Unexpected deployed branch: '+String(manifest.branch));
  assert(manifest.phase==='engineering-preview','Site release phase changed without release QA');
  assert(manifest.indexing==='noindex','Preview indexing not explicitly blocked in release manifest');
  assert(manifest.converterRoutes===19,'Live release says wrong number of converter routes');
  report.observed={commit:manifest.commit,branch:manifest.branch,
   phase:manifest.phase,buildProvider:manifest.buildProvider,builtAt:manifest.builtAt};
  return {commitMatches:true,buildProvider:manifest.buildProvider};
 });
 await check('Preview robots remains blocked on deployed Pages site',async()=>{
  const r=await read('/robots.txt');
  assert(/User-agent:\s*\*/i.test(r.text)&&/Disallow:\s*\//i.test(r.text),
   'The actual preview robots.txt no longer blocks indexing');
  return {robotsDisallow:true};
 });
 await check('Live homepage shows 19 conversion links and noindex directive',async()=>{
  const r=await read('/');
  assert(/name="robots"\s+content="noindex,nofollow"/i.test(r.text),'Homepage live robots meta absent');
  const links=new Set([...r.text.matchAll(/href="(\/converter\/[a-z-]+\/)"/g)].map(m=>m[1]));
  assert(links.size===19,'Live homepage converter route count='+links.size+'; expected 19');
  return {links:links.size,noindex:true};
 });
 await check('Three representative live GIS conversion pages are real and noindex',async()=>{
  const slugs=['gpx-to-kml','shp-to-geojson','geojson-to-shp'];
  for(const slug of slugs){
   const r=await read('/converter/'+slug+'/');
   assert(r.text.includes('<html')&&r.text.includes('<title>'),'Not an HTML GIS converter: '+slug);
   assert(/name="robots"\s+content="noindex,nofollow"/i.test(r.text),'Noindex missing: '+slug);
  }
  return {pages:slugs.length};
 });
 report.status='PASSED';
}catch(e){report.failure=String(e?.message||e)}
finally{
 fs.writeFileSync('live-release-gate.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
