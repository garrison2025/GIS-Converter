/**
 * P30: independently verify an isolated production-SEO rehearsal.
 *
 * The reserved .example origin and GIS_SEO_TEST_MODE=1 are deliberately
 * restricted to a non-Cloudflare, non-deployed CI build. No real domain is
 * implied, and this test never changes the deployed pages.dev preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {routes} from '../src/lib/gdal-matrix.mjs';
import {getSeoLaunchConfig} from '../src/lib/seo-launch-config.mjs';

const root=path.resolve('dist'),publicOrigin='https://gis-launch.example';
const report={kind:'p30-isolated-seo-production-rehearsal',status:'FAILED',
  domain:'reserved .example fixture (NOT registered, NOT deployed)',
  testedPages:0,checks:[],errors:[]};
const read=filename=>fs.readFileSync(path.join(root,filename),'utf8');
function check(name,fn){fn();report.checks.push({name,status:'PASSED'})}
const fixture={GIS_SEO_LAUNCH:'approved',GIS_PUBLIC_ORIGIN:publicOrigin,
 GIS_SEO_TEST_MODE:'1',GITHUB_REF_NAME:'dev/p30-guarded-seo-production-rehearsal'};
const prod={GIS_SEO_LAUNCH:'approved',GIS_PUBLIC_ORIGIN:'https://valid-gis-example-website.org',
 GITHUB_REF_NAME:'main'};
try{
 check('Default mode never activates public indexing, canonical or sitemap',()=>{
  const mode=getSeoLaunchConfig({});
  assert.equal(mode.indexable,false);
  assert.equal(mode.mode,'engineering-preview');
  assert.equal(mode.robots,'noindex,nofollow');
  assert.deepEqual(mode.sitemapUrls,[]);
 });
 check('Unknown SEO launch switch fails closed',()=>{
  assert.throws(()=>getSeoLaunchConfig({GIS_SEO_LAUNCH:'on'}),/exactly off or approved/);
 });
 check('Approved launch missing an exact HTTPS custom domain is forbidden',()=>{
  assert.throws(()=>getSeoLaunchConfig({GIS_SEO_LAUNCH:'approved',GITHUB_REF_NAME:'main'}),
   /explicit HTTPS/);
  assert.throws(()=>getSeoLaunchConfig({...prod,GIS_PUBLIC_ORIGIN:'http://valid-gis-example-website.org'}),/HTTPS/);
 });
 check('Pages, reserved, IP and credential origins may never become canonical',()=>{
  for(const host of ['https://gis-converter.pages.dev','https://example.com',
   'https://preview.local','https://127.0.0.1','https://gis-launch.example',
   'https://gis.example.org','https://user:pass@valid-gis-example-website.org',
   'https://valid-gis-example-website.org/unsafe-path']){
   assert.throws(()=>getSeoLaunchConfig({...prod,GIS_PUBLIC_ORIGIN:host}),
    undefined,'Accepted unsafe production SEO host '+host);
  }
 });
 check('Accidental preview-branch SEO activation fails unless isolated test mode',()=>{
  assert.throws(()=>getSeoLaunchConfig({...prod,CF_PAGES_BRANCH:'dev/p30-feature'}),/main/);
  assert.throws(()=>getSeoLaunchConfig({...fixture,CF_PAGES:'1',CF_PAGES_BRANCH:'main'}),/test|reserved|provider/i);
  assert.throws(()=>getSeoLaunchConfig({...fixture,CF_PAGES_COMMIT_SHA:'a'.repeat(40),
   CF_PAGES_BRANCH:'main'}),/test|reserved|provider/i);
 });
 check('Future real custom-domain main branch policy produces exactly 20 canonical URLs',()=>{
  const mode=getSeoLaunchConfig(prod);
  assert.equal(mode.indexable,true);
  assert.equal(mode.publicOrigin,prod.GIS_PUBLIC_ORIGIN);
  assert.equal(mode.sitemapUrls.length,20);
  assert.equal(mode.canonical('/converter/gpx-to-kml/'),
   prod.GIS_PUBLIC_ORIGIN+'/converter/gpx-to-kml/');
  assert.throws(()=>mode.canonical('//evil.com'),/Unsafe canonical/);
 });
 check('Isolated reserved test origin is accepted only for local rehearsal',()=>{
  const mode=getSeoLaunchConfig(fixture);
  assert.equal(mode.mode,'seo-launch');
  assert.equal(mode.indexable,true);
  assert.equal(mode.sitemapUrls.length,20);
  assert(mode.sitemapUrls.every(url=>url.startsWith(publicOrigin+'/')));
 });
 check('Built sitemap contains 20 unique absolute canonical HTML URLs, no imaginary lastmod',()=>{
  const sitemap=read('sitemap.xml');
  assert(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
  const paths=['/',...routes.map(([slug])=>'/converter/'+slug+'/')];
  assert.equal(paths.length,20);
  assert.equal(urls.length,20);
  assert.equal(new Set(urls).size,20);
  assert.deepEqual(urls,paths.map(p=>publicOrigin+p));
  assert(!sitemap.includes('<lastmod>'),'Fictitious lastmod data present');
  for(const url of urls)assert(url.startsWith('https://'),'Non-HTTPS canonical present');
  report.sitemapUrls=urls.length;
 });
 check('All 20 rendered pages self-canonicalize and are indexable only in test build',()=>{
  const paths=['/',...routes.map(([slug])=>'/converter/'+slug+'/')];
  for(const pagePath of paths){
   const file=pagePath==='/'?'index.html':pagePath.slice(1)+'index.html';
   const html=read(file);
   assert(html.includes('<meta name="robots" content="index,follow"'),'Index meta missing '+file);
   const matches=[...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)];
   assert.equal(matches.length,1,'Canonical count incorrect '+file);
   assert.equal(matches[0][1],publicOrigin+pagePath,'Wrong self-canonical '+file);
   assert(!html.includes('noindex,nofollow'),'Conflicting noindex HTML '+file);
   report.testedPages++;
  }
  assert.equal(report.testedPages,20);
 });
 check('Production robots allows crawling and uses the same sitemap as canonicals',()=>{
  const robots=read('robots.txt');
  assert.match(robots,/User-agent:\s*\*/i);
  assert.match(robots,/Allow:\s*\/(?:\s|$)/i);
  assert.match(robots,new RegExp('Sitemap:\\s*'+publicOrigin.replace(/\./g,'\\.')+'/sitemap\\.xml'));
  assert(!/Disallow:\s*\/\s*$/m.test(robots));
 });
 check('X-Robots-Tag global noindex is absent but private audit routes remain noindex',()=>{
  const headers=read('_headers');
  assert(!/\/\*\s*\n\s*X-Robots-Tag:\s*noindex\b/im.test(headers));
  assert.match(headers,/\/internal\/\*\s*\n\s*X-Robots-Tag:\s*noindex/i);
  assert.match(headers,/\/release\.json\s*\n\s*X-Robots-Tag:\s*noindex/i);
  assert.match(headers,/\/engine\/\*\s*\n\s*X-Robots-Tag:\s*noindex/i);
  assert.match(headers,/X-Content-Type-Options:\s*nosniff/i);
  assert.match(headers,/Permissions-Policy:/i);
 });
 check('Release manifest accurately discloses test launch mode and source commit',()=>{
  const manifest=JSON.parse(read('release.json'));
  assert.equal(manifest.phase,'seo-launch');
  assert.equal(manifest.indexing,'index');
  assert.equal(manifest.converterRoutes,19);
  assert(/^[0-9a-f]{40}$/.test(manifest.commit));
  assert(!JSON.stringify(manifest).includes('GIS_SEO_TEST_MODE'));
  report.testCommit=manifest.commit;
 });
 report.status='PASSED';
}catch(error){report.errors.push(String(error?.stack||error))}
finally{
 fs.writeFileSync('p30-seo-production-rehearsal.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
