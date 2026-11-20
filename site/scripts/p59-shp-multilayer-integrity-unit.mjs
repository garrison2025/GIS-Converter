/**
 * P59: synthetic real ESRI SHP/SHX/DBF/PRJ/CPG ZIPs for more than one layer.
 * Attack cases previously passed when the inspector read only first *.shp.
 * No uploaded or private geography, no external requests.
 */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
import {inspectGISData,createGISQualityReport,assertNoDetectedCriticalDataLoss} from
 '../src/lib/quality-report.mjs';

const inputText=JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',properties:{Code:1},
  geometry:{type:'Point',coordinates:[116.4,39.9]}},
 {type:'Feature',properties:{Code:2},
  geometry:{type:'LineString',coordinates:[
   [116.4,39.9],[116.45,39.95],[116.5,40]
  ]}}
]});
const input=new File([inputText],'two-features.geojson');
const SAMPLE_EXTS=['shp','shx','dbf','prj','cpg'];
async function template(scenario){
 const file=await makeScenarioGISFile('shp',scenario);
 const data=await JSZip.loadAsync(await file.arrayBuffer());
 const components=new Map();
 for(const ext of SAMPLE_EXTS){
  const part=data.file('example.'+ext);
  if(part)components.set(ext,await part.async('uint8array'));
 }
 assert(['shp','shx','dbf'].every(ext=>components.has(ext)));
 return components;
}
const point=await template('point'),line=await template('line');
function clone(bytes){return new Uint8Array(bytes)}
async function makeBundle({
 badSecondOffset=false,badSecondXY=false,missingSecondDbf=false,
 duplicateCase=false,orphanDbf=false,layers=2,withReadme=false
}={}){
 const zip=new JSZip();
 for(let i=0;i<layers;i++){
  const stem=i===0?'a_point':i===1?'z_line':'layer_'+i;
  const sample=i===1?line:point;
  for(const [ext,original] of sample){
   if(i===1&&ext==='dbf'&&missingSecondDbf)continue;
   const bytes=clone(original);
   if(i===1&&badSecondOffset&&ext==='shx')
    new DataView(bytes.buffer).setUint32(100,51,false);
   if(i===1&&badSecondXY&&ext==='shp')
    new DataView(bytes.buffer).setFloat64(112,0,true);
   zip.file(stem+'.'+ext,bytes);
   if(i===1&&ext==='shx'&&duplicateCase)
    zip.file(stem+'.SHX',clone(bytes));
  }
 }
 if(orphanDbf)zip.file('orphan.dbf',clone(point.get('dbf')));
 if(withReadme)zip.file('README.txt','Standalone offline synthetic tests.');
 return new Uint8Array(await zip.generateAsync({
  type:'uint8array',compression:'STORE'
 }));
}
const status=(report,id)=>report.checks.find(c=>c.id===id)?.status;
let tests=0;
{
 const archive=await makeBundle({withReadme:true});
 const m=await inspectGISData('shp',archive);
 assert.equal(m.shpLayers,2);
 assert.equal(m.features,2);
 assert.equal(m.complete,true);
 assert.equal(m.shpRecordIntegrity,'pass');
 assert.equal(m.shpXYBounds,'pass');
 assert.equal(m.crs,'WGS84');
 assert.deepEqual(m.geometry,['point','line']);
 assert.deepEqual(m.bbox,[116.4,39.9,116.5,40]);
 const report=await createGISQualityReport(input,'geojson',archive,'shp');
 assert.equal(status(report,'shp-record-integrity'),'pass');
 assert.equal(status(report,'shp-xy-bounds'),'pass');
 assert.equal(status(report,'feature-count'),'pass');
 assert.equal(status(report,'complex-geometry-values'),'unavailable');
 assert.equal(status(report,'dbf-attribute-values'),'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(report),true);
 tests++;
}
{
 const m=await inspectGISData('shp',
  new Uint8Array(await (await makeScenarioGISFile('shp','point')).arrayBuffer()));
 assert.equal(m.shpLayers,1);
 assert.equal(m.features,1);
 assert.equal(m.shpRecordIntegrity,'pass');
 assert.equal(m.shpXYBounds,'pass');
 assert.equal(m.complete,true);
 tests++;
}
for(const [name,options,expect] of [
 ['second-layer corrupt SHX offset',{badSecondOffset:true},'shp-record-integrity'],
 ['second-layer corrupt XY bounds',{badSecondXY:true},'shp-xy-bounds'],
 ['second-layer DBF missing',{missingSecondDbf:true},'shp-record-integrity'],
 ['ambiguous SHX case collision',{duplicateCase:true},'shp-record-integrity'],
 ['orphan DBF sidecar',{orphanDbf:true},'shp-record-integrity'],
 ['nine layers exceed bounded inspection',{layers:9},'shp-record-integrity']
]){
 const output=await makeBundle(options);
 const meta=await inspectGISData('shp',output);
 assert.equal(meta.complete,false,name+' must not pass');
 const r=await createGISQualityReport(input,'geojson',output,'shp');
 assert.equal(status(r,expect),'review',name+' must have a critical review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'},
  name+' must withhold malformed download');
 assert(!JSON.stringify(r).includes('orphan.dbf'),
  'Do not leak user-provided archive file names');
 tests++;
}
{
 // A multi-layer ZIP source converted into a single-layer GeoJSON must not
 // silently drop the second source feature while reporting "1 -> 1 pass".
 const source=new File([await makeBundle()],'input-layers.zip');
 const onlyPoint=JSON.stringify({type:'FeatureCollection',features:[{
  type:'Feature',properties:{Code:1},
  geometry:{type:'Point',coordinates:[116.4,39.9]}
 }]});
 const report=await createGISQualityReport(source,'shp',
  new TextEncoder().encode(onlyPoint),'geojson');
 assert.equal(report.input.shpLayers,2);
 assert.equal(report.input.features,2);
 assert.equal(status(report,'feature-count'),'review');
 assert.equal(status(report,'shp-geojson-attributes'),'unavailable');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 tests++;
}
console.log('P59_MULTI_LAYER_SHP_INTEGRITY PASSED '+tests+
 ' multi-stem real binary ZIP cases: every layer index, XY, DBF, feature count, '+
 'case ambiguity, orphan sidecars and bound inspection verified');
