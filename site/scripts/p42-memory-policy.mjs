import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {suggestedMemorySavingMode,checkMemorySavingSelection,
 LOW_MEMORY_BATCH_INPUT_BYTES,LOW_MEMORY_BATCH_OUTPUT_BYTES,shouldRenderOptionalPreview}
 from '../src/lib/resource-budget.mjs';
import {makeMiniBatchArchive} from '../src/lib/mini-batch.mjs';
import {runIsolatedConversion} from '../src/lib/isolated-task.mjs';
const MiB=1024*1024;
assert.equal(suggestedMemorySavingMode(1),true);
assert.equal(suggestedMemorySavingMode(2),true);
assert.equal(suggestedMemorySavingMode(4),false);
assert.equal(suggestedMemorySavingMode(undefined),false);
assert.equal(suggestedMemorySavingMode(NaN),false);
assert.equal(suggestedMemorySavingMode(-1),false);
assert.equal(shouldRenderOptionalPreview(true),false);
assert.equal(shouldRenderOptionalPreview(false),true);
assert.equal(checkMemorySavingSelection([{size:9*MiB}],true),null,
 'Large single-file limits remain the original 15 MiB');
assert.equal(checkMemorySavingSelection([{size:6*MiB},{size:6*MiB}],true),null);
assert.match(checkMemorySavingSelection([{size:7*MiB},{size:6*MiB}],true),/12 MiB/);
assert.equal(checkMemorySavingSelection([{size:7*MiB},{size:6*MiB}],false),null);
assert.equal(LOW_MEMORY_BATCH_INPUT_BYTES,12*MiB);
assert.equal(LOW_MEMORY_BATCH_OUTPUT_BYTES,24*MiB);
const files=[{name:'a.geojson',size:1024},{name:'b.geojson',size:1024}];
const results=['a','b'].map((name,i)=>({
 name:name+'.geojson',bytes:new TextEncoder().encode('{"number":'+i+'}'),
 quality:{status:'checked',checks:[],input:{features:1},output:{features:1}}
}));
const packed=await makeMiniBatchArchive({source:'geojson',target:'geojson',files,
 results,conserveMemory:true});
const zip=await JSZip.loadAsync(packed.bytes);
assert.equal(zip.file('converted/01-a.geojson')._data.compression.magic,'\x00\x00',
 'Memory-conserving ZIP must use STORE, not a second DEFLATE working buffer');
assert.equal((await zip.file('converted/02-b.geojson').async('string')),'{"number":1}');
assert.equal((await zip.file('manifest.json').async('string')).includes('gis-converter-local-mini-batch'),true);
const oversized=[
 {name:'a.geojson',bytes:new Uint8Array(13*MiB),quality:results[0].quality},
 {name:'b.geojson',bytes:new Uint8Array(12*MiB),quality:results[1].quality}
];
await assert.rejects(()=>makeMiniBatchArchive({source:'geojson',target:'geojson',
 files,results:oversized,conserveMemory:true}),/96 MiB mini-batch packaging limit|output exceeds/i,
 'Constrained mode must reject 25 MiB total before allocating ZIP');
const workers=[];
function workerFactory(){
 const fake={
  sent:null,terminated:false,onmessage:null,onerror:null,onmessageerror:null,
  postMessage(msg){
   this.sent=msg;
   queueMicrotask(()=>this.onmessage?.({data:{
    id:'conversion',type:'success',bytes:new Uint8Array([1]),quality:{checks:[]}
   }}));
  },
  terminate(){this.terminated=true}
 };
 workers.push(fake);return fake;
}
const converted=runIsolatedConversion({file:new File(['a'],'a.kml'),
 source:'kml',target:'geojson',conserveMemory:true,workerFactory});
await converted.promise;
assert.equal(workers.length,1);
assert.equal(workers[0].sent.conserveMemory,true);
assert.equal(workers[0].terminated,true);
console.log('P42_RESOURCE_BUDGET PASSED: conservative device-memory hints, manual saver policy, safe 12/24 MiB batch caps, STORE ZIP, real worker resource flag and cleanup');
