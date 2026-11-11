import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const file='public/engine/gdal3/gdal3WebAssembly.wasm';
if(!fs.existsSync(file))throw Error('Missing real GDAL binary');
const raw=fs.readFileSync(file),packed=gzipSync(raw,{level:9});
fs.writeFileSync(file+'.gz',packed);
const report={rawBytes:raw.length,gzipBytes:packed.length,sha256:createHash('sha256').update(packed).digest('hex'),fitsPages25MiB:packed.length<=25*1048576,readableWithoutDecompression:false};
fs.writeFileSync('gdal-gzip-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.fitsPages25MiB)process.exitCode=1;
// Raw 28MB WASM remains in dist for local browser test only.
// Do NOT deploy dist directly to Cloudflare Pages.
