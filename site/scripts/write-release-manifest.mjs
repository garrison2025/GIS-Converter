/**
 * P27: Build-scoped, public release attestation for Cloudflare Pages.
 *
 * No passwords, account IDs, user data, payment details, or Cloudflare
 * secrets. An immutable Git SHA is exposed solely to compare deployment
 * bytes to the public repository commit that produced them.
 *
 * CF_PAGES_COMMIT_SHA/CF_PAGES_BRANCH are injected by Cloudflare Pages
 * during Git-connected builds; GitHub Actions uses GITHUB_SHA/REF_NAME.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {routes} from '../src/lib/gdal-matrix.mjs';
import {getSeoLaunchConfig} from '../src/lib/seo-launch-config.mjs';

export const releaseFilename='release.json';
const validSha=/^[0-9a-f]{40}$/i;
const validBranch=/^[a-zA-Z0-9._/-]{1,150}$/;
function gitValue(args,cwd){
 try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2500}).trim()}
 catch{return null}
}
export function createReleaseManifest(env=process.env,{cwd=process.cwd(),now=new Date(),git=gitValue}={}){
 const commit=(env.CF_PAGES_COMMIT_SHA||env.GITHUB_SHA||git(['rev-parse','HEAD'],cwd)||'').toLowerCase();
 if(!validSha.test(commit))throw Error('Build SHA unavailable; refusing an unverifiable Pages release manifest');
 const branch=env.CF_PAGES_BRANCH||env.GITHUB_REF_NAME||git(['symbolic-ref','--short','HEAD'],cwd)||'unknown';
 if(!validBranch.test(branch))throw Error('Invalid public branch identifier');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Build timestamp invalid');
 const seo=getSeoLaunchConfig(env);
 const buildProvider=env.CF_PAGES==='1'||env.CF_PAGES_COMMIT_SHA?'cloudflare-pages':
  env.GITHUB_ACTIONS==='true'?'github-actions':'local';
 return {
  schemaVersion:1,
  site:'GIS Converter',
  commit,
  branch,
  buildProvider,
  builtAt:now.toISOString(),
  phase:seo.mode,
  indexing:seo.indexable?'index':'noindex',
  converterRoutes:routes.length
 };
}
export function writeReleaseManifest({dir='dist',env=process.env,cwd=process.cwd(),now=new Date()}={}){
 if(!fs.statSync(dir,{throwIfNoEntry:false})?.isDirectory())throw Error('Build output directory missing: '+dir);
 const manifest=createReleaseManifest(env,{cwd,now});
 const destination=path.join(dir,releaseFilename);
 fs.writeFileSync(destination,JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',flag:'w'});
 return {path:destination,...manifest};
}
const self=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(self)console.log(JSON.stringify(writeReleaseManifest(),null,2));
