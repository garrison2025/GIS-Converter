import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd();
const pkg = path.join(root, 'node_modules/gdal3.js');
const dist = path.join(pkg,'dist/package');
const out = path.join(root,'public/engine/gdal3');
const files = ['gdal3.js','gdal3WebAssembly.wasm','gdal3WebAssembly.data'];
fs.mkdirSync(out,{recursive:true});
const report = {package:'gdal3.js@2.8.1',productionDeployAllowed:false,files:[],pagesAssetLimitBytes:25*1048576};
for (const name of files) {
  const input=path.join(dist,name);
  if(!fs.existsSync(input))throw new Error('Missing GDAL runtime: '+input);
  const buf=fs.readFileSync(input);
  if(name.endsWith('.wasm') && buf.subarray(0,4).toString('hex')!=='0061736d') throw new Error('Invalid WASM magic');
  if(buf.length===0)throw new Error('Empty GDAL asset: '+name);
  fs.writeFileSync(path.join(out,name),buf);
  report.files.push({name,bytes:buf.length,sha256:crypto.createHash('sha256').update(buf).digest('hex'),withinCloudflarePagesFileLimit:buf.length<=report.pagesAssetLimitBytes});
}
const license=['LICENSE','LICENSE.md','LICENSE.txt','COPYING','COPYING.LESSER'].find(n=>fs.existsSync(path.join(pkg,n)));
if(!license)throw new Error('GDAL package license absent; fail closed');
fs.copyFileSync(path.join(pkg,license),path.join(out,'GDAL3_PACKAGE_LICENSE.txt'));
fs.writeFileSync(path.join(root,'gdal-runtime-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
