/**
 * P27: fail-closed static build/SEO/release identity audit.
 * The site is still an engineering preview, not a public indexed SEO launch.
 * Does not contact Cloudflare, GitHub, Pancake or an analytics service.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {routes} from '../src/lib/gdal-matrix.mjs';
import {createReleaseManifest,releaseFilename} from './write-release-manifest.mjs';
const root=path.resolve('dist'),report={
 kind:'p27-static-release-gate',status:'FAILED',checks:[],source:'locally-built-Pages-package'};
function check(label,fn){
 fn();report.checks.push({label,status:'PASSED'});
}
const raw=file=>fs.readFileSync(path.join(root,file),'utf8');
const sha=/^[a-f0-9]{40}$/;
try{
 check('Cloudflare injected source commit takes precedence over GitHub SHA',()=>{
  const injected=createReleaseManifest({CF_PAGES:'1',CF_PAGES_COMMIT_SHA:'a'.repeat(40),
   CF_PAGES_BRANCH:'main',GITHUB_SHA:'b'.repeat(40),MY_PRIVATE_TOKEN:'NOT_FOR_PUBLICATION'},
   {now:new Date('2026-11-12T00:00:00Z')});
  assert.equal(injected.commit,'a'.repeat(40));
  assert.equal(injected.branch,'main');
  assert.equal(injected.buildProvider,'cloudflare-pages');
  assert(!JSON.stringify(injected).includes('NOT_FOR_PUBLICATION'));
 });
 check('GitHub builds publish a traceable immutable source SHA',()=>{
  const gh=createReleaseManifest({GITHUB_SHA:'c'.repeat(40),GITHUB_REF_NAME:'dev/p27-release',
   GITHUB_ACTIONS:'true'},{now:new Date('2026-11-12T00:00:00Z')});
  assert.equal(gh.buildProvider,'github-actions');
  assert.equal(gh.commit,'c'.repeat(40));
  assert.equal(gh.branch,'dev/p27-release');
 });
 check('Missing or malformed immutable commit cannot be published as verified',()=>{
  assert.throws(()=>createReleaseManifest({CF_PAGES_COMMIT_SHA:'fake-commit',CF_PAGES_BRANCH:'main'},
    {cwd:'/nonexistent',git:()=>null}),/SHA unavailable/);
  assert.throws(()=>createReleaseManifest({GITHUB_SHA:'f'.repeat(40),GITHUB_REF_NAME:'malicious<script>'},
    {cwd:'/nonexistent',git:()=>null}),/branch identifier/);
 });
 check('Emitted JSON contains the exact checked-out GitHub build commit',()=>{
  const manifest=JSON.parse(raw(releaseFilename));
  const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim().toLowerCase();
  assert(sha.test(actual));
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.site,'GIS Converter');
  assert.equal(manifest.commit,actual);
  assert.equal(manifest.phase,'engineering-preview');
  assert.equal(manifest.indexing,'noindex');
  assert.equal(manifest.converterRoutes,routes.length);
  assert.equal(manifest.converterRoutes,19);
  assert(['cloudflare-pages','github-actions','local'].includes(manifest.buildProvider));
  assert(!Number.isNaN(Date.parse(manifest.builtAt)));
  assert.deepEqual(Object.keys(manifest).sort(),
    ['schemaVersion','site','commit','branch','buildProvider','builtAt','phase','indexing','converterRoutes'].sort());
  report.expectedCommit=actual;report.release=manifest;
 });
 check('Robots exclusion remains active in preview',()=>{
  const robots=raw('robots.txt');
  assert.match(robots,/User-agent:\s*\*/i);
  assert.match(robots,/Disallow:\s*\/(?:\s|$)/i);
  assert.match(raw('_headers'),/X-Robots-Tag:\s*noindex/i);
 });
 check('Homepage and all 19 converter pages explicitly opt out of indexing',()=>{
  const pageFiles=['index.html',...routes.map(([slug])=>'converter/'+slug+'/index.html')];
  for(const file of pageFiles){
   const html=raw(file);
   assert.match(html,/<meta\s+name="robots"\s+content="noindex,nofollow"/i,'Missing noindex: '+file);
   assert.match(html,/<title>[^<]+<\/title>/i,'Missing title: '+file);
  }
  report.prelaunchPagesAudited=pageFiles.length;
 });
 check('Release JSON is not a fake HTML fallback or a published raw WASM',()=>{
  assert(!raw(releaseFilename).includes('<html'));
  assert(!fs.existsSync(path.join(root,'engine/gdal3/gdal3WebAssembly.wasm')));
  assert(fs.existsSync(path.join(root,'engine/gdal3/gdal3WebAssembly.wasm.gz')));
 });
 report.status='PASSED';
}catch(error){report.failure=String(error?.stack||error)}
finally{
 fs.writeFileSync('p27-static-release-gate.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
