import fs from 'node:fs';
import path from 'node:path';
import {writeReleaseManifest} from './write-release-manifest.mjs';
import {writeSeoAssets} from './write-seo-assets.mjs';
const root=path.resolve('dist');
const binary=path.join(root,'engine/gdal3/gdal3WebAssembly.wasm');
const gzip=binary+'.gz', limit=25*1048576;
if(!fs.existsSync(gzip))throw Error('Gzip WASM not built');
if(!fs.existsSync(binary))throw Error('Expected raw WASM for staging cleanup');
fs.unlinkSync(binary); // Never deploy raw >25 MiB file.
// Verify that the entire Astro HTML set has the same SEO mode as its
// final static robots, sitemap and headers policy.
const seo=writeSeoAssets({dir:root});
// Provide a public immutable build identity so the live Pages URL can be
// compared to GitHub main without privileged Cloudflare API access.
const release=writeReleaseManifest({dir:root});
const all=[];
function walk(dir){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else all.push({path:path.relative(root,p),bytes:fs.statSync(p).size});}}
walk(root);
const bad=all.filter(f=>f.bytes>limit);
if(bad.length)throw Error('Oversized Pages files: '+JSON.stringify(bad));
if(!fs.existsSync(path.join(root,'_routes.json')))throw Error('Missing selective Function routes');
const rules=JSON.parse(fs.readFileSync(path.join(root,'_routes.json'),'utf8'));
const uri='/engine/gdal3/gdal3WebAssembly.wasm';
if(JSON.stringify(rules.include)!==JSON.stringify([uri]))throw Error('Unexpected Pages Function routes');
const result={seo,release:{commit:release.commit,branch:release.branch,buildProvider:release.buildProvider,indexing:release.indexing},safeToPackage:true,liveCloudflareVerified:false,rawWasmExcluded:!fs.existsSync(binary),gzipBytes:fs.statSync(gzip).size,totalFiles:all.length,functionRoute:uri,maxAssetBytes:Math.max(...all.map(f=>f.bytes))};
fs.writeFileSync('pages-preview-package-report.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
