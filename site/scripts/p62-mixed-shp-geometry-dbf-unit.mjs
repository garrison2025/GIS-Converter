/** P62: independent mixed Point/Line/Polygon Shapefile ZIP + DBF regression. */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {DEMO_LINE,DEMO_POLYGON} from '../src/lib/demo-gis-scenarios.mjs';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from
 '../src/lib/quality-report.mjs';

const PRJ='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'+
 'SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],'+
 'UNIT["Degree",0.0174532925199433]]';
const ext=['shp','shx','dbf','prj','cpg'];
const clone=v=>new Uint8Array(v);
const bounds=parts=>{
 const points=parts.flat();
 return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),
  Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
};
function header(length,type,box){
 const b=new Uint8Array(100),v=new DataView(b.buffer);
 v.setInt32(0,9994,false);v.setInt32(24,length/2,false);
 v.setInt32(28,1000,true);v.setInt32(32,type,true);
 box.forEach((n,i)=>v.setFloat64(36+i*8,n,true));
 return b;
}
function makeShp(type,features){
 const all=features.map(f=>f.parts),allPoints=all.flat(2);
 const box=bounds(all.flat());
 const contents=all.map(parts=>44+4*parts.length+16*parts.flat().length);
 const shpLength=100+contents.reduce((n,c)=>n+8+c,0);
 const shxLength=100+8*features.length;
 const shp=new Uint8Array(shpLength),shx=new Uint8Array(shxLength);
 shp.set(header(shpLength,type,box));shx.set(header(shxLength,type,box));
 const s=new DataView(shp.buffer),x=new DataView(shx.buffer);
 let offset=50,byte=100;
 for(let i=0;i<features.length;i++){
  const parts=all[i],points=parts.flat(),content=contents[i],end=byte+8+content;
  s.setInt32(byte,i+1,false);s.setInt32(byte+4,content/2,false);
  const at=byte+8,bb=bounds(parts);
  s.setInt32(at,type,true);bb.forEach((n,j)=>s.setFloat64(at+4+j*8,n,true));
  s.setInt32(at+36,parts.length,true);s.setInt32(at+40,points.length,true);
  let start=0;
  parts.forEach((part,j)=>{s.setInt32(at+44+j*4,start,true);start+=part.length});
  let xy=at+44+4*parts.length;
  for(const [lon,lat] of points){s.setFloat64(xy,lon,true);s.setFloat64(xy+8,lat,true);xy+=16}
  x.setInt32(100+i*8,offset,false);x.setInt32(104+i*8,content/2,false);
  offset+=4+content/2;byte=end;
 }
 assert.equal(byte,shp.length);
 return {shp,shx};
}
function makeDbf(features){
 const headerLength=97,recordLength=31;
 const dbf=new Uint8Array(headerLength+features.length*recordLength+1);
 const v=new DataView(dbf.buffer);
 dbf[0]=3;dbf[1]=126;dbf[2]=11;dbf[3]=20;
 v.setUint32(4,features.length,true);v.setUint16(8,headerLength,true);
 v.setUint16(10,recordLength,true);
 dbf.set(new TextEncoder().encode('Name'),32);dbf[43]=0x43;dbf[48]=24;
 dbf.set(new TextEncoder().encode('Code'),64);dbf[75]=0x4e;dbf[80]=6;
 dbf[96]=0x0d;
 for(let i=0;i<features.length;i++){
  const at=headerLength+i*recordLength;
  dbf[at]=0x20;dbf.fill(0x20,at+1,at+31);
  const name=new TextEncoder().encode(features[i].name);
  assert(name.length<=24);
  dbf.set(name,at+1);
  dbf.set(new TextEncoder().encode(String(features[i].code).padStart(6,' ')),at+25);
 }
 dbf[dbf.length-1]=0x1a;
 return dbf;
}
function makeLayer(stem,type,features,{cpg='UTF-8'}={}){
 const {shp,shx}=makeShp(type,features);
 const entries=new Map([
  ['shp',shp],['shx',shx],['dbf',makeDbf(features)],
  ['prj',new TextEncoder().encode(PRJ)],['cpg',new TextEncoder().encode(cpg)]
 ]);
 return {stem,entries};
}
async function bundle(layers,{omitCpg=[]}={}){
 const zip=new JSZip();
 for(const layer of layers){
  for(const [suffix,data] of layer.entries){
   if(suffix==='cpg'&&omitCpg.includes(layer.stem))continue;
   zip.file(layer.stem+'.'+suffix,data);
  }
 }
 return new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'STORE'}));
}

function makePointLayer(stem,features,{cpg='UTF-8'}={}){
 const coords=features.map(f=>f.xy);
 const bbox=[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1])),
  Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))];
 const shp=new Uint8Array(100+28*features.length),shx=new Uint8Array(100+8*features.length);
 shp.set(header(shp.length,1,bbox));shx.set(header(shx.length,1,bbox));
 const sv=new DataView(shp.buffer),iv=new DataView(shx.buffer);
 for(let i=0;i<features.length;i++){
  const at=100+28*i;
  sv.setUint32(at,i+1,false);sv.setUint32(at+4,10,false);
  sv.setInt32(at+8,1,true);
  sv.setFloat64(at+12,coords[i][0],true);sv.setFloat64(at+20,coords[i][1],true);
  iv.setUint32(100+8*i,at/2,false);iv.setUint32(104+8*i,10,false);
 }
 return {stem,entries:new Map([
  ['shp',shp],['shx',shx],['dbf',makeDbf(features)],
  ['prj',new TextEncoder().encode(PRJ)],['cpg',new TextEncoder().encode(cpg)]
 ])};
}
const p={name:'Village',code:11,xy:[116.4,39.9]};
const line={name:'Road',code:17,parts:[DEMO_LINE]};
const polygon={name:'Zone',code:29,parts:DEMO_POLYGON};
const baseLayers=()=>[
 makeLayer('z_zones',5,[polygon]),
 makeLayer('m_roads',3,[line]),
 makePointLayer('a_villages',[p])
];
const props=f=>({Name:f.name,Code:f.code});
const feature=(props,geometry)=>({type:'Feature',properties:props,geometry});
const mixedFeatures=()=>[
 feature(props(p),{type:'Point',coordinates:p.xy}),
 feature(props(line),{type:'LineString',coordinates:DEMO_LINE}),
 feature(props(polygon),{type:'Polygon',coordinates:DEMO_POLYGON})
];
const geojson=features=>new TextEncoder().encode(JSON.stringify({
 type:'FeatureCollection',features
}));
const run=(input,source,output,target)=>createGISQualityReport(
 new File([input],'synthetic-mixed.zip'),source,output,target);
const check=(r,id)=>r.checks.find(c=>c.id===id)?.status;
const packed=await bundle(baseLayers());
let tests=0;
{
 const r=await run(packed,'shp',geojson(mixedFeatures().reverse()),'geojson');
 assert.equal(r.input.shpLayers,3);
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'pass',
  'All three geometry families must link to their own DBF row after reorder');
 assert.equal(check(r,'shp-geojson-attributes'),undefined);
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 assert(!JSON.stringify(r).includes('Village')&&!JSON.stringify(r).includes('Road')&&
  !JSON.stringify(r).includes('Zone'));
 tests++;
}
{
 const r=await run(geojson(mixedFeatures()),'geojson',packed,'shp');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'pass');
 assert.equal(check(r,'dbf-attribute-values'),undefined);
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const f=mixedFeatures().reverse();f[2].properties={...f[2].properties,Code:99};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=mixedFeatures().reverse();delete f[1].properties.Name;
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-feature-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=mixedFeatures();f[0].geometry={type:'Point',coordinates:[116.401,39.9]};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'A real Point moved outside tolerance must be detected with same total features');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=mixedFeatures();
 f[1].geometry={type:'LineString',coordinates:DEMO_LINE.map((v,i)=>i===1?[v[0]+0.001,v[1]]:v)};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'Moved middle line vertex with unchanged bounds is not a valid match');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=mixedFeatures();f[2].geometry={type:'Polygon',coordinates:[DEMO_POLYGON[0]]};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'review');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const p2={...p,name:'Other',code:66};
 const layers=[makePointLayer('a_duplicate',[p,p2]),
  makeLayer('m_roads',3,[line]),makeLayer('z_zones',5,[polygon])];
 const f=[...mixedFeatures(),feature(props(p2),{type:'Point',coordinates:p.xy})];
 const r=await run(await bundle(layers),'shp',geojson(f),'geojson');
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'unavailable');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true,
  'Two identical Points cannot be uniquely assigned to different attributes');
 tests++;
}
{
 const second={name:'Harbor',code:44,xy:[116.7,40.2]};
 const layers=[makePointLayer('a_villages',[p,second]),
  makeLayer('m_roads',3,[line]),makeLayer('z_zones',5,[polygon])];
 const f=[...mixedFeatures(),feature(props(second),{type:'Point',coordinates:second.xy})];
 f[3].geometry={type:'LineString',coordinates:[[116.7,40.2],[116.71,40.22]]};
 const r=await run(await bundle(layers),'shp',geojson(f),'geojson');
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'Changed family histogram is provable despite unchanged total feature count');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=mixedFeatures();f[0].geometry={type:'Point',coordinates:[...p.xy,10]};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'unavailable',
  'An output Point Z is outside strict P62 2D equality proof');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const layers=baseLayers();layers[1].entries.delete('cpg');
 const r=await run(await bundle(layers),'shp',geojson(mixedFeatures()),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const layers=baseLayers();
 layers[2].entries.set('cpg',new TextEncoder().encode('CP1252'));
 const r=await run(await bundle(layers),'shp',geojson(mixedFeatures()),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 tests++;
}
{
 const layers=baseLayers();
 layers[1].entries.set('prj',new TextEncoder().encode('PROJCS["Projected"]'));
 const r=await run(await bundle(layers),'shp',geojson(mixedFeatures()),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'unavailable');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable');
 tests++;
}
{
 const f=mixedFeatures().slice(1);
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'feature-count'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 // A corrupt third-layer SHX must still force DATA_LOSS on the output.
 const layers=baseLayers(),x=clone(layers[0].entries.get('shx'));
 new DataView(x.buffer).setUint32(100,51,false);
 layers[0].entries.set('shx',x);
 const r=await run(geojson(mixedFeatures()),'geojson',await bundle(layers),'shp');
 assert.equal(check(r,'shp-record-integrity'),'review');
 assert.equal(check(r,'complex-geometry-values'),'unavailable');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 // A single 2D Point layer must still use the separate P60/legacy path.
 const r=await run(geojson([mixedFeatures()[0]]),'geojson',
  await bundle([makePointLayer('a_villages',[p])]),'shp');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'Do not reclassify single-layer Point conversion as a mixed-layer certification');
 tests++;
}
{
 // The ONLY Point vanishes into a Line: the output is no longer 'mixed'.
 // The original both-sides-mixed gate would silently bypass known loss.
 const f=mixedFeatures();
 f[0].geometry={type:'LineString',coordinates:[p.xy,[116.41,39.91]]};
 const r=await run(packed,'shp',geojson(f),'geojson');
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'Changing the only Point family must not disable mixed geometry validation');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 // A multi-layer Point-only archive may be corrupted into all Lines while
 // retaining the exact number of features and DBF rows.
 const other={name:'Harbor',code:44,xy:[116.7,40.2]};
 const source=await bundle([
  makePointLayer('a_point',[p]),makePointLayer('z_point',[other])
 ]);
 const out=geojson([
  feature(props(p),{type:'LineString',coordinates:[p.xy,[116.41,39.91]]}),
  feature(props(other),{type:'LineString',coordinates:[other.xy,[116.71,40.21]]})
 ]);
 const r=await run(source,'shp',out,'geojson');
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'Point-only to Line-only family substitution is a real detectable loss');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
console.log('P62_MIXED_MULTI_LAYER_SHP PASSED '+tests+
 ' real-binary cases: three-family ZIP both directions, reordering, Point/Line/Polygon loss,'+
 ' unique DBF association, duplicate Point, family histogram, Z/CRS/CPG unknown, deleted'+
 ' features, broken SHX and single-layer regression');
