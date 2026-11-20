/** P60: real binary multi-layer Point/DBF geometry-bound association tests. */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {makeDemoGISFile} from '../src/lib/demo-gis-files.mjs';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from
 '../src/lib/quality-report.mjs';

const original=await JSZip.loadAsync(
 await (await makeDemoGISFile('shp')).arrayBuffer());
const exts=['shp','shx','dbf','prj','cpg'];
const base=new Map();
for(const ext of exts)
 base.set(ext,await original.file('example.'+ext).async('uint8array'));
function get(x,y,name,code,{unknownCpg=false}={}){
 const o=new Map([...base].map(([k,v])=>[k,new Uint8Array(v)]));
 for(const ext of ['shp','shx']){
  const v=new DataView(o.get(ext).buffer);
  for(const offset of [36,52])v.setFloat64(offset,x,true);
  for(const offset of [44,60])v.setFloat64(offset,y,true);
  if(ext==='shp'){
   v.setFloat64(112,x,true);v.setFloat64(120,y,true);
  }
 }
 const dbf=o.get('dbf');
 dbf.fill(0x20,98,128);
 const encoded=new TextEncoder().encode(name);
 assert(encoded.length<=24);
 dbf.set(encoded,98);
 dbf.set(new TextEncoder().encode(String(code).padStart(6,' ')),122);
 if(unknownCpg)o.set('cpg',new TextEncoder().encode('CP1252'));
 return o;
}
const samples=[
 {xy:[116.4,39.9],name:'North',code:17,stem:'first'},
 {xy:[116.5,40.1],name:'South',code:29,stem:'second'},
 {xy:[116.6,40.2],name:'East',code:35,stem:'third'}
];
async function pack(items){
 const zip=new JSZip();
 for(const item of items){
  const parts=get(...item.xy,item.name,item.code,item.options||{});
  for(const [ext,bytes] of parts)zip.file(item.stem+'.'+ext,bytes);
 }
 return new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'STORE'}));
}
const bytes=await pack(samples);
function geojson(items){
 return new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',
  features:items.map(i=>({type:'Feature',
   properties:{Name:i.name,Code:i.code},
   geometry:{type:'Point',coordinates:i.xy}}))
 }));
}
const run=async (input,output)=>createGISQualityReport(
 new File([input],'synthetic-multi.zip'),'shp',output,'geojson');
const check=(r,id)=>r.checks.find(c=>c.id===id)?.status;
let tests=0;
{
 const r=await run(bytes,geojson(samples.slice().reverse()));
 assert.equal(r.input.shpLayers,3);
 assert.equal(r.input.features,3);
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'shp-geojson-attributes'),'pass',
  'All 3 layers must be paired by coordinates despite reversed row order');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 assert(!JSON.stringify(r).includes('North')&&
  !JSON.stringify(r).includes('South')&&
  !JSON.stringify(r).includes('first.shp'));
 tests++;
}
{
 const shuffled=samples.slice().reverse().map(s=>({...s}));
 shuffled[1].name='North'; // wrong layer name, counts/bbox stay correct
 const r=await run(bytes,geojson(shuffled));
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'shp-geojson-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const shuffled=samples.slice().reverse().map(s=>({...s}));
 shuffled[1].code=99;
 const r=await run(bytes,geojson(shuffled));
 assert.equal(check(r,'shp-geojson-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const features=JSON.parse(new TextDecoder().decode(geojson(samples)));
 delete features.features[1].properties.Name;
 const r=await run(bytes,new TextEncoder().encode(JSON.stringify(features)));
 assert.equal(check(r,'shp-geojson-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const moved=samples.map(s=>({...s,xy:s.xy.slice()}));
 moved[1].xy[0]+=0.01;
 const r=await run(bytes,geojson(moved));
 assert.equal(check(r,'shp-geojson-attributes'),'review',
  'Verified point geometry move is not a valid row association');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const dup=[samples[0],{...samples[1],xy:samples[0].xy}];
 const input=await pack(dup);
 const r=await run(input,geojson(dup));
 assert.equal(check(r,'shp-geojson-attributes'),'unavailable',
  'Duplicate XY never proves row/DBF identity');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const cp=[samples[0],{...samples[1],options:{unknownCpg:true}}];
 const r=await run(await pack(cp),geojson(cp));
 assert.equal(check(r,'shp-geojson-attributes'),'unavailable',
  'CP1252 content needs separate verified decoder');
 tests++;
}
{
 const line=await makeScenarioGISFile('shp','line');
 const archive=await JSZip.loadAsync(await line.arrayBuffer());
 const mixed=new JSZip();
 const orig=await JSZip.loadAsync(await pack([samples[0]]));
 for(const [n,f] of Object.entries(orig.files)){
  if(!f.dir)mixed.file(n,await f.async('uint8array'));
 }
 for(const ext of exts){
  const v=archive.file('example.'+ext);
  if(v)mixed.file('line.'+ext,await v.async('uint8array'));
 }
 const source=new Uint8Array(await mixed.generateAsync({type:'uint8array'}));
 const r=await run(source,geojson([samples[0],samples[1]]));
 assert.equal(r.input.shpLayers,2);
 assert.equal(check(r,'shp-geojson-attributes'),'unavailable',
  'Mixed line/point geometries require separate certified full-geometry pairing');
 tests++;
}
{
 const r=await run(bytes,geojson(samples.slice(0,2)));
 assert.equal(check(r,'feature-count'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 // Do not misapply multi-layer logic to the legacy single-layer route.
 const single=await pack([samples[0]]);
 const r=await run(single,geojson([samples[0]]));
 assert.equal(r.input.shpLayers,1);
 assert.equal(check(r,'shp-geojson-attributes'),'pass');
 tests++;
}
console.log('P60_MULTI_LAYER_POINT_DBF PASSED '+tests+
 ' cases: geometry-linked three-layer field preservation, cross-layer value/name/number loss,'+
 ' missing fields, moved/duplicate points, unsupported encoding, mixed geometry and count loss');
