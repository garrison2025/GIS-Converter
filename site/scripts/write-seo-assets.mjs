/**
 * P30: write tightly coupled robots, sitemap and Cloudflare Pages header
 * policies into the final static bundle. Only an explicitly approved
 * custom-domain production build can change the existing noindex preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getSeoLaunchConfig} from '../src/lib/seo-launch-config.mjs';
import {routes} from '../src/lib/gdal-matrix.mjs';
const files=['index.html',...routes.map(([slug])=>'converter/'+slug+'/index.html')];
function ensure(test,message){if(!test)throw Error('P30 SEO build gate: '+message)}
const escapeXml=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function writeSeoAssets({dir='dist',env=process.env}={}){
 const root=path.resolve(dir),seo=getSeoLaunchConfig(env);
 const read=filename=>fs.readFileSync(path.join(root,filename),'utf8');
 const write=(filename,text)=>fs.writeFileSync(path.join(root,filename),text,'utf8');
 ensure(fs.statSync(root,{throwIfNoEntry:false})?.isDirectory(),'Astro dist folder missing');
 ensure(files.length===20,'Canonical pages matrix changed');
 for(const [i,file] of files.entries()){
  const html=read(file),canonical=seo.indexable?seo.sitemapUrls[i]:null;
  ensure(html.includes('<meta name="robots" content="'+seo.robots+'"'),
   'Incorrect robots directive on '+file);
  if(seo.indexable){
   ensure(html.includes('<link rel="canonical" href="'+canonical+'"'),
    'Missing or incorrect canonical for '+file);
   ensure(!html.includes('noindex,nofollow'),'Indexable page still contains noindex '+file);
  }else ensure(!/<link\s+rel="canonical"\b/i.test(html),
   'Engineering preview must not publish an unapproved canonical '+file);
 }
 const rawHeaders=read('_headers'),robots=read('robots.txt');
 const hasNoindexHeader=/^\s*X-Robots-Tag:\s*noindex\b/im.test(rawHeaders);
 if(!seo.indexable){
  ensure(hasNoindexHeader,'Preview must have X-Robots-Tag noindex');
  ensure(/Disallow:\s*\/(?:\s|$)/i.test(robots),'Preview robots.txt must disallow crawling');
  ensure(!fs.existsSync(path.join(root,'sitemap.xml')),
   'Preview must not publish an unapproved production sitemap');
  return {
   mode:seo.mode,indexing:'noindex',canonicalCount:0,sitemapUrlCount:0,
   sitemap:null,customDomain:null,previewRobotsBlocked:true
  };
 }
 ensure(hasNoindexHeader,'Unexpected original Pages header format: cannot guarantee removal of global noindex');
 ensure(!fs.existsSync(path.join(root,'sitemap.xml')),'Unexpected existing XML sitemap; refusing overwrite');
 ensure(!/\bSitemap:/i.test(robots),'Unexpected existing public sitemap; refusing duplicate declarations');
 // Do not alter the source _headers file: the current Pages project must
 // remain protected by default, even if an isolated rehearsal is performed.
 const headerLines=rawHeaders.split(/\r?\n/).filter(line=>!/^\s*X-Robots-Tag:\s*noindex\b/i.test(line));
 const cleanHeaders=headerLines.join('\n').trimEnd()+'\n\n'+[
  '/internal/*','  X-Robots-Tag: noindex, nofollow, noarchive','',
  '/release.json','  X-Robots-Tag: noindex, nofollow, noarchive','',
  '/engine/*','  X-Robots-Tag: noindex, nofollow, noarchive','',
  // Cloudflare Pages serves the same production deployment on both the
  // custom domain and the pages.dev mirror. Never index either mirror host.
  'https://gis-converter.pages.dev/*','  X-Robots-Tag: noindex, nofollow, noarchive','',
  'https://:version.gis-converter.pages.dev/*','  X-Robots-Tag: noindex, nofollow, noarchive',''
 ].join('\n');
 ensure(!/\/\*\s*\n\s*X-Robots-Tag:\s*noindex\b/im.test(cleanHeaders),
  'Global noindex survived activation');
 write('_headers',cleanHeaders);
 write('robots.txt','User-agent: *\nAllow: /\nSitemap: '+seo.publicOrigin+'/sitemap.xml\n');
 const sitemap='<?xml version="1.0" encoding="UTF-8"?>\n'+
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
  seo.sitemapUrls.map(url=>'  <url><loc>'+escapeXml(url)+'</loc></url>').join('\n')+
  '\n</urlset>\n';
 write('sitemap.xml',sitemap);
 return {
  mode:seo.mode,indexing:'index',canonicalCount:files.length,
  sitemapUrlCount:seo.sitemapUrls.length,
  sitemap:seo.publicOrigin+'/sitemap.xml',
  customDomain:seo.publicOrigin,previewRobotsBlocked:false
 };
}
const self=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(self)console.log(JSON.stringify(writeSeoAssets(),null,2));
