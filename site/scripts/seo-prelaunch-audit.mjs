/**
 * P28 independent route-by-route SEO prelaunch quality audit.
 * NOT a GSC, Semrush, ranking, or public indexing acceptance.
 * Do not unblock robots.txt or emit an imaginary production canonical/sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {routes} from '../src/lib/gdal-matrix.mjs';
import {routeGuides} from '../src/data/route-guides.mjs';
import {notes} from '../src/data/content.mjs';
const root=path.resolve('dist');
const report={kind:'p28-seo-prelaunch-audit',status:'FAILED',phase:'engineering-preview',
 inspected:[],errors:[],passCount:0};
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const match=(html,re)=>html.match(re)?.[1]?.trim()??'';
function meaningfulWords(input){
 return input.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]*>/g,' ').replace(/&[a-z]+;|&#\d+;/gi,' ').split(/\s+/).filter(Boolean).length;
}
function safeText(value){return value.replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;')}
try{
 assert.equal(routes.length,19);
 assert.equal(Object.keys(routeGuides).length,19);
 assert.equal(Object.keys(notes).length,19);
 const titles=new Set(),descriptions=new Set(),examples=new Set(),questions=new Set();
 const homepage=read('index.html');
 assert(homepage.includes('noindex,nofollow'),'Homepage lost noindex');
 const liveSlugs=new Set([...homepage.matchAll(/href="\/converter\/([a-z-]+)\/"/g)].map(m=>m[1]));
 assert.equal(liveSlugs.size,19,'Homepage must link to precisely the 19 supported routes');
 const failures=[];
 for(const [slug,source,target] of routes){
  const item={slug,status:'FAILED',warnings:[]};
  report.inspected.push(item);
  try{
   const guide=routeGuides[slug],note=notes[slug];
   assert(guide&&note,'Missing unique route guide/content');
   const page=read('converter/'+slug+'/index.html');
   const title=match(page,/<title>([\s\S]*?)<\/title>/i);
   const description=match(page,/<meta\s+name="description"\s+content="([^"]+)"/i);
   const h1=match(page,/<h1[^>]*>([\s\S]*?)<\/h1>/i);
   assert(title&&description&&h1,'Missing title, meta description or H1');
   assert(!titles.has(title),'Duplicate SEO title: '+title);
   assert(!descriptions.has(description),'Duplicate SEO description');
   titles.add(title);descriptions.add(description);
   // Branded format names use canonical mixed case, e.g. "GeoJSON".
   // SEO intent matching is case-insensitive without rewriting page copy.
   assert(title.toLowerCase().includes(source)&&title.toLowerCase().includes(target),
    'Title not aligned with route intent');
   assert(h1.toLowerCase().includes(source)&&h1.toLowerCase().includes(target),
    'H1 not aligned with route intent');
   assert(page.includes('name="robots" content="noindex,nofollow"'),
    'Preview route accidentally marked indexable');
   assert(!/<link\s+rel="canonical"[^>]+gis-converter\.pages\.dev/i.test(page),
    'No production canonical may be committed to the preview hostname');
   const fields=['example','inputs','output','verify','mistake'];
   for(const field of fields){
    assert(typeof guide[field]==='string'&&guide[field].length>=65,
     'Short/empty route-specific '+field+' guidance');
    assert(page.includes(safeText(guide[field].slice(0,70)))||
      page.includes(guide[field].slice(0,70)),
      'Not rendering unique route-specific '+field+' guidance');
   }
   assert(!examples.has(guide.example),'Duplicate primary scenario');
   examples.add(guide.example);
   assert(guide.faq.length===2,'Expected exactly two route-specific FAQs');
   for(const [question,answer] of guide.faq){
    assert(question.length>=20&&answer.length>=50,'Thin FAQ answer');
    assert(!questions.has(question),'FAQ question reused on unrelated route');
    questions.add(question);
    assert(page.includes(safeText(question))||page.includes(question),'FAQ question absent in rendered route');
   }
   const relatedLinks=new Set([...page.matchAll(/href="\/converter\/([a-z-]+)\/"/g)]
    .map(m=>m[1]).filter(link=>link!==slug));
   assert(relatedLinks.size>=2,'Too few relevant internal conversion links');
   assert([...relatedLinks].every(link=>liveSlugs.has(link)),'Broken cross-route link');
   const main=match(page,/<main[^>]*>([\s\S]*?)<\/main>/i);
   const wordCount=meaningfulWords(main);
   assert(wordCount>=300,'Insufficient practical content '+wordCount+' words');
   item.title=title;item.wordCount=wordCount;
   item.faqCount=guide.faq.length;item.relatedLinks=relatedLinks.size;
   item.status='PASSED';report.passCount++;
  }catch(e){item.error=String(e?.message||e);failures.push({slug,error:item.error})}
 }
 assert.equal(failures.length,0,'Route audit errors '+JSON.stringify(failures));
 assert.equal(titles.size,19);
 assert.equal(descriptions.size,19);
 assert.equal(examples.size,19);
 assert.equal(questions.size,38);
 const robots=read('robots.txt');
 assert(/Disallow:\s*\//.test(robots),'Preview robots changed without release approval');
 report.distinctTitles=titles.size;report.distinctDescriptions=descriptions.size;
 report.distinctScenarios=examples.size;report.uniqueFAQQuestions=questions.size;
 report.indexingEnabled=false;
 report.canonicalReady=false;
 report.sitemapReady=false;
 report.status='PASSED';
}catch(e){report.errors.push(String(e?.message||e))}
finally{
 fs.writeFileSync('p28-seo-prelaunch-audit.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASSED')process.exitCode=1;
