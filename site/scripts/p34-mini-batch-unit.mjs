import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
 MAX_BATCH_FILES,MAX_BATCH_INPUT_BYTES,MAX_FILE_BYTES,
 validateMiniBatchSelection,safeBatchEntryName,makeMiniBatchArchive,miniBatchSummary
} from '../src/lib/mini-batch.mjs';

const mk=(name,size=1)=>({name,size});
const expectThrow=(fn,re)=>assert.throws(fn,re);
expectThrow(()=>validateMiniBatchSelection([]),/at least one/);
expectThrow(()=>validateMiniBatchSelection([mk('a',0)]),/empty or invalid/);
expectThrow(()=>validateMiniBatchSelection([mk('a',MAX_FILE_BYTES+1)]),/15 MiB/);
expectThrow(()=>validateMiniBatchSelection([mk('a'),mk('b'),mk('c'),mk('d')]),/at most 3/);
expectThrow(()=>validateMiniBatchSelection([mk('a',11*1048576),mk('b',11*1048576),mk('c',11*1048576)]),/30 MiB/);
const valid=validateMiniBatchSelection([mk('A',MAX_FILE_BYTES),mk('B',MAX_FILE_BYTES)]);
assert.equal(valid.count,2);
assert.equal(valid.totalBytes,MAX_BATCH_INPUT_BYTES);
assert.equal(valid.isBatch,true);
assert.equal(MAX_BATCH_FILES,3);
assert.equal(safeBatchEntryName('../evil\\..\\nested?.geojson'),'evil-..-nested-.geojson');
assert(!safeBatchEntryName('../../x').includes('/'));
assert(!safeBatchEntryName('test\u0000.csv').includes('\0'));
const files=[mk('..\\first.kml'),mk('../first.kml')];
const results=[
 {name:'../../secret.geojson',bytes:new TextEncoder().encode('{"one":1}'),
  quality:{status:'checked',input:{features:1},output:{features:1},checks:[]}},
 {name:'../../secret.geojson',bytes:new TextEncoder().encode('{"two":2}'),
  quality:{status:'review',input:{features:2},output:{features:2},
   checks:[{id:'notice',status:'review',detail:'Check geometry'}]}}
];
const batch=await makeMiniBatchArchive({files,results,source:'kml',target:'geojson'});
assert.equal(batch.name,'gis-kml-to-geojson-batch-2.zip');
const zip=await JSZip.loadAsync(batch.bytes),paths=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
assert.equal(paths.length,5);
assert.equal(new Set(paths).size,paths.length);
assert(paths.every(p=>!p.includes('..')&&!p.startsWith('/')&&!p.includes('\\')));
assert(paths.includes('converted/01-secret.geojson'));
assert(paths.includes('converted/02-secret.geojson'));
assert(paths.includes('reports/01-inspection.json'));
assert(paths.includes('reports/02-inspection.json'));
assert.equal((await zip.file('converted/02-secret.geojson').async('string')),'{"two":2}');
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
assert.equal(manifest.kind,'gis-converter-local-mini-batch');
assert.equal(manifest.files.length,2);
assert.equal(manifest.files[1].inspectionStatus,'review');
assert(!JSON.stringify(manifest).includes('../../'));
const summary=miniBatchSummary(results,files.map(f=>f.name));
assert.equal(summary.kind,'local-mini-batch-summary');
assert.equal(summary.status,'review');
assert.equal(summary.input.features,3);
assert.equal(summary.output.features,3);
assert.equal(summary.checks.length,2);
await assert.rejects(
 ()=>makeMiniBatchArchive({files,results,source:'kml',target:'geojson',isCancelled:()=>true}),
 /cancelled/);
await assert.rejects(
 ()=>makeMiniBatchArchive({files,results:[results[0]],source:'kml',target:'geojson'}),
 /do not match/);
await assert.rejects(
 ()=>makeMiniBatchArchive({files:[files[0]],results:[results[0]],source:'kml',target:'geojson'}),
 /single-file/);
console.log('P34_MINI_BATCH_UNIT PASSED: bounded selection, safe paths, no ZIP overwrite, 2 per-file reports, manifest, summary, cancel');
