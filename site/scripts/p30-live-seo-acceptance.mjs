/**
 * P30: opt-in live custom-domain SEO acceptance. Read-only; never changes
 * Cloudflare, DNS, indexing, Search Console, or any payment service.
 * Run only after the user buys and connects a real custom domain.
 */
import fs from 'node:fs';
import {routes} from '../src/lib/gdal-matrix.mjs';
import {getSeoLaunchConfig} from '../src/lib/seo-launch-config.mjs';

const expected=String(process.env.GIS_EXPECTED_COMMIT||process.env.GITHUB_SHA||'').toLowerCase();
const report={kind:'p30-live-custom-domain-seo-verification',
 status:'FAILED',startedAt:new Date().toISOString(),checks:[],pages:[],errors:[]};
const test=(condition,message)=>{if(!condition)throw Error(message)};
async function get(origin,pathname){
 const r=await fetch(origin+pathname,{signal:AbortSignal.timeout(18000),
  headers:{Accept:'text/html,application/xml,application/json,text/plain;q=0.8',
   'Cache-Control':'no-cache','User-Agent':'GIS-Converter-P30-SEO-ReadOnly-Audit/1.0'}});
 test(r.ok,'Public '+pathname+' returned HTTP '+r.status);
 const body=await r.text();
 test(body.length<2*1024*1024,'Oversized public response for '+pathname);
 return {body,headers:r.headers,status:r.status};
}
async function check(name,fn){
 const result=await fn();
 report.checks.push({name,status:'PASSED',...result});
}
try{
 const seo=getSeoLaunchConfig({...process.env,GIS_SEO_LAUNCH:'approved',
  GIS_SEO_TEST_MODE:'0',GITHUB_REF_NAME:'main'});
 test(seo.indexable,'Production SEO activation config not validated');
 test(/^[0-9a-f]{40}$/.test(expected),'Expected current main Git SHA must be 40 hex digits');
 const domain=seo.publicOrigin;
 report.publicOrigin=domain;report.expectedCommit=expected;
 await check('Public custom domain release manifest matches exact merged main and approved launch mode',async()=>{
  const {body}=await get(domain,'/release.json');
  let release;try{release=JSON.parse(body)}catch{throw Error('Real /release.json missing or returned HTML fallback')}
  test(release.site==='GIS Converter'&&release.schemaVersion===1,'Release JSON format changed');
  test(release.commit===expected,'Public custom domain is not running expected GitHub commit');
  test(release.branch==='main','Not the production main branch');
  test(release.phase==='seo-launch'&&release.indexing==='index','SEO launch mode not activated');
  test(release.converterRoutes===19,'Converter route count changed');
  return {matchingSha:true,branch:'main',indexable:true};
 });
 await check('Live root robots.txt allows crawling and points to the real-domain sitemap',async()=>{
  const {body}=await get(domain,'/robots.txt');
  test(/User-agent:\s*\*/i.test(body),'Robots lacks the default crawler group');
  test(/Allow:\s*\/(?:\s|$)/i.test(body),'Robots does not explicitly allow crawling');
  test(!/Disallow:\s*\/\s*$/im.test(body),'Production robots still disallows the whole site');
  test(body.includes('Sitemap: '+domain+'/sitemap.xml'),'Sitemap is not declared on the correct hostname');
  return {allowsCrawl:true};
 });
 await check('Production XML sitemap has exactly 20 matching unique absolute canonical URLs',async()=>{
  const {body,headers}=await get(domain,'/sitemap.xml');
  test(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),'Sitemap is not XML');
  test(/<urlset\s+xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/.test(body),'Invalid sitemap namespace');
  test(!/<lastmod>/.test(body),'Do not invent last modification timestamps');
  const actual=[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
  test(actual.length===20&&new Set(actual).size===20,'Sitemap URL count/uniqueness wrong');
  test(JSON.stringify(actual)===JSON.stringify(seo.sitemapUrls),'Sitemap must match exact canonical list');
  return {urls:actual.length,contentType:headers.get('content-type')};
 });
 await check('All 20 live HTML pages are indexable, self-canonical and correctly described',async()=>{
  const paths=['/',...routes.map(([slug])=>'/converter/'+slug+'/')];
  const titles=new Set();
  for(const pathname of paths){
   const {body,headers}=await get(domain,pathname);
   test(body.includes('<html')&&/<title>[^<]+<\/title>/i.test(body),'Missing title on '+pathname);
   test(/<meta\s+name="robots"\s+content="index,follow"/i.test(body),'Not indexed HTML '+pathname);
   const canonical=[...body.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/gi)];
   test(canonical.length===1&&canonical[0][1]===domain+pathname,'Canonical mismatch '+pathname);
   test(!/noindex/i.test(headers.get('x-robots-tag')||''),'Main custom domain has X-Robots noindex '+pathname);
   const title=body.match(/<title>([^<]+)<\/title>/i)?.[1];
   test(!titles.has(title),'Duplicate title '+pathname);
   titles.add(title);
   report.pages.push({path:pathname,status:'PASSED',canonicalMatches:true,htmlIndexable:true});
  }
  return {pages:paths.length,uniqueTitles:titles.size};
 });
 await check('Cloudflare Pages default mirror stays noindex after custom-domain launch',async()=>{
  const mirror='https://gis-converter.pages.dev';
  for(const pathname of ['/','/converter/gpx-to-kml/']){
   const {headers,body}=await get(mirror,pathname);
   test(/\bnoindex\b/i.test(headers.get('x-robots-tag')||''),
    'Pages.dev mirror not protected by X-Robots-Tag at '+pathname);
   test(body.includes('<link rel="canonical" href="'+domain+pathname+'"'),
    'Pages.dev mirror canonical not directed to custom domain');
  }
  return {mirrorRoutesChecked:2,header:'noindex'};
 });
 await check('Internal GIS laboratory page remains noindex even with the SEO site published',async()=>{
  const {headers}=await get(domain,'/internal/quality/');
  test(/\bnoindex\b/i.test(headers.get('x-robots-tag')||''),'Internal QA page is indexable');
  return {internalNoindex:true};
 });
 report.status='PASSED';
}catch(e){report.errors.push(String(e?.stack||e))}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('p30-live-seo-acceptance.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,pages:report.pages.length+' HTML routes'},null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
