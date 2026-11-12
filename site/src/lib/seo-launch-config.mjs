/**
 * P30: fail-closed compile-time SEO modes. No domain has been approved yet.
 *
 * Default mode is the existing engineering preview (noindex, no sitemap).
 * Launch requires an exact affirmative switch, a validated HTTPS custom
 * domain, and a confirmed main branch. It does not enable payment features.
 */
import {routes} from './gdal-matrix.mjs';

const disallowedSuffixes=['.pages.dev','.localhost','.local','.invalid','.test','.example'];
const reservedNames=new Set(['pages.dev','localhost','example.com','example.org','example.net','example']);
const validBranch='main';

export function getSeoLaunchConfig(env=process.env){
 const switchValue=String(env.GIS_SEO_LAUNCH||'off').trim();
 if(!['off','approved'].includes(switchValue))
  throw Error('GIS_SEO_LAUNCH must be exactly off or approved');
 if(switchValue!=='approved')return Object.freeze({
  mode:'engineering-preview',indexable:false,robots:'noindex,nofollow',
  publicOrigin:null,canonical:()=>null,
  sitemapUrls:[]
 });
 const isPages=env.CF_PAGES==='1'||Boolean(env.CF_PAGES_COMMIT_SHA);
 // Synthetic .example is allowed only in an offline CI rehearsal. This
 // switch has no effect on actual Cloudflare Pages builds.
 const testMode=!isPages&&env.GIS_SEO_TEST_MODE==='1';
 const selectedBranch=env.CF_PAGES_BRANCH||env.GITHUB_REF_NAME||'';
 if(selectedBranch!==validBranch&&!testMode)
  throw Error('Refusing SEO indexing build without confirmed main production branch');
 const raw=String(env.GIS_PUBLIC_ORIGIN||'').trim();
 if(!raw||!/^https:\/\//i.test(raw))throw Error('SEO launch requires an explicit HTTPS custom-domain origin');
 let parsed;
 try{parsed=new URL(raw)}catch{throw Error('Invalid GIS_PUBLIC_ORIGIN')}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||
  parsed.pathname!=='/'||parsed.search||parsed.hash)
  throw Error('GIS_PUBLIC_ORIGIN must be a clean HTTPS origin without auth, path, port, query or fragment');
 const host=parsed.hostname.toLowerCase();
 if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||host.includes('..')||
   host.split('.').some(part=>part.startsWith('-')||part.endsWith('-'))||
   host.split('.').at(-1).length<2||/^\d+(?:\.\d+){3}$/.test(host))
  throw Error('Invalid public custom-domain hostname');
 if(reservedNames.has(host)||host.endsWith('.example.com')||
   host.endsWith('.example.org')||host.endsWith('.example.net')||
   disallowedSuffixes.some(s=>host.endsWith(s))&&!(testMode&&host.endsWith('.example')))
  throw Error('Refusing preview, test, reserved or provider domain for public SEO launch');
 if(testMode&&!host.endsWith('.example'))
  throw Error('Offline GIS_SEO_TEST_MODE must use the reserved .example test domain');
 if(!testMode&&host.endsWith('.example'))
  throw Error('Test domains may not be published');
 const publicOrigin=parsed.origin;
 const canonical=pathname=>{
  if(typeof pathname!=='string'||!/^\/(?:[a-z0-9-]+\/)*$/.test(pathname))
   throw Error('Unsafe canonical route pathname');
  return publicOrigin+pathname;
 };
 const paths=['/',...routes.map(([slug])=>'/converter/'+slug+'/')];
 if(new Set(paths).size!==20)throw Error('Duplicate public converter path');
 return Object.freeze({
  mode:'seo-launch',indexable:true,robots:'index,follow',
  publicOrigin,canonical,sitemapUrls:paths.map(canonical)
 });
}
