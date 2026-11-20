/** P61: multi-layer 2D WGS84 line/polygon geometry + DBF association regression. */
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
const lineFeature={name:'Road',code:17,parts:[DEMO_LINE]};
const polygonFeature={name:'Zone',code:29,parts:DEMO_POLYGON};
const lineGeom={type:'LineString',coordinates:DEMO_LINE};
const polygonGeom={type:'Polygon',coordinates:DEMO_POLYGON};
const baseLayers=()=>[
 makeLayer('a_roads',3,[lineFeature]),
 makeLayer('z_zones',5,[polygonFeature])
];
const props=f=>({Name:f.name,Code:f.code});
const feature=(properties,geometry)=>({type:'Feature',properties,geometry});
const geojson=features=>new TextEncoder().encode(JSON.stringify({
 type:'FeatureCollection',features
}));
const baseFeatures=()=>[
 feature(props(lineFeature),lineGeom),
 feature(props(polygonFeature),polygonGeom)
];
const run=async (source,sourceFormat,output,targetFormat)=>createGISQualityReport(
 new File([source],'synthetic-multilayer.zip'),sourceFormat,output,targetFormat);
const check=(r,id)=>r.checks.find(c=>c.id===id)?.status;
let tests=0;
{
 const input=await bundle(baseLayers()),output=geojson(baseFeatures().reverse());
 const r=await run(input,'shp',output,'geojson');
 assert.equal(r.input.shpLayers,2);
 assert.deepEqual(r.input.geometry,['line','polygon']);
 assert.equal(check(r,'feature-count'),'pass');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'pass',
  'Cross-layer attributes must follow unique line/polygon geometry after row reorder');
 assert.equal(check(r,'shp-geojson-attributes'),undefined,
  'P61 replaces the single-DBF P60 check for multi-layer complex geometries');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 assert(!JSON.stringify(r).includes('Road')&&!JSON.stringify(r).includes('Zone'));
 tests++;
}
{
 const input=geojson(baseFeatures()),output=await bundle(baseLayers());
 const r=await run(input,'geojson',output,'shp');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'pass',
  'GeoJSON source attributes must pair with all output layer DBFs');
 assert.equal(check(r,'dbf-attribute-values'),undefined);
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const f=baseFeatures().reverse().map(x=>({...x,properties:{...x.properties}}));
 f[1].properties.Code=99;
 const r=await run(await bundle(baseLayers()),'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=baseFeatures().reverse().map(x=>({...x,properties:{...x.properties}}));
 delete f[0].properties.Name;
 const r=await run(await bundle(baseLayers()),'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-feature-attributes'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=baseFeatures();
 const changed=DEMO_LINE.map(p=>[...p]);changed[1][1]+=0.001;
 f[0].geometry={type:'LineString',coordinates:changed};
 const r=await run(await bundle(baseLayers()),'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'A moved interior vertex with unchanged overall bounds must be detected');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'Changed geometry must never be used to guess the attribute association');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const f=baseFeatures();
 f[1].geometry={type:'Polygon',coordinates:[DEMO_POLYGON[0]]};
 const r=await run(await bundle(baseLayers()),'shp',geojson(f),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'review',
  'Lost polygon hole must be detected even with unchanged outer bounds');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const same=makeLayer('a_line',3,[lineFeature]);
 const same2=makeLayer('z_line',3,[{...lineFeature,name:'Other',code:88}]);
 const duplicate=[feature(props(lineFeature),lineGeom),
  feature(props({name:'Other',code:88}),lineGeom)];
 const r=await run(await bundle([same,same2]),'shp',geojson(duplicate),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'unavailable');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'Duplicate identical geometries cannot prove which DBF row belongs to which output row');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const second=DEMO_LINE.map(([x,y])=>[x+0.2,y+0.2]);
 const parts=[DEMO_LINE,second];
 const multiLine={name:'Multi road',code:37,parts};
 const multiGeom={type:'MultiLineString',coordinates:[second,DEMO_LINE]};
 const layers=[makeLayer('a_multiline',3,[multiLine]),makeLayer('z_zones',5,[polygonFeature])];
 const features=[feature(props(multiLine),multiGeom),feature(props(polygonFeature),polygonGeom)];
 const r=await run(await bundle(layers),'shp',geojson(features.reverse()),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass',
  'Multipart line components may be reordered without losing geometry');
 assert.equal(check(r,'complex-feature-attributes'),'pass');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const shift=ring=>ring.map(([x,y])=>[x+0.2,y+0.2]);
 const outer2=shift(DEMO_POLYGON[0]);
 const multiPolygon={name:'Two parcels',code:41,parts:[DEMO_POLYGON[0],DEMO_POLYGON[1],outer2]};
 const multiGeom={type:'MultiPolygon',coordinates:[
  [outer2],[DEMO_POLYGON[0],DEMO_POLYGON[1]]
 ]};
 const layers=[makeLayer('a_roads',3,[lineFeature]),makeLayer('z_multipolygon',5,[multiPolygon])];
 const features=[feature(props(lineFeature),lineGeom),feature(props(multiPolygon),multiGeom)];
 const r=await run(await bundle(layers),'shp',geojson(features),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass',
  'MultiPolygon shells and their interior rings must be preserved');
 assert.equal(check(r,'complex-feature-attributes'),'pass');
 tests++;
}
{
 const input=await bundle(baseLayers(),{omitCpg:['z_zones']});
 const r=await run(input,'shp',geojson(baseFeatures()),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'pass');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'A layer without a verified CPG encoding must not receive attribute certification');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 tests++;
}
{
 const layers=baseLayers();layers[1]=makeLayer('z_zones',5,[polygonFeature],{cpg:'CP1252'});
 const r=await run(await bundle(layers),'shp',geojson(baseFeatures()),'geojson');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'Legacy encoding is not guessed as UTF-8');
 tests++;
}
{
 const r=await run(await bundle(baseLayers()),'shp',
  geojson([baseFeatures()[0]]),'geojson');
 assert.equal(check(r,'feature-count'),'review');
 assert.equal(check(r,'complex-geometry-values'),'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 tests++;
}
{
 const pointFile=await makeScenarioGISFile('shp','point');
 const pointZip=await JSZip.loadAsync(await pointFile.arrayBuffer());
 const mixed=new JSZip();
 for(const [name,file] of Object.entries(pointZip.files))
  if(!file.dir)mixed.file(name.replace('example.','a_point.'),await file.async('uint8array'));
 const lineLayer=makeLayer('z_line',3,[lineFeature]);
 for(const [suffix,data] of lineLayer.entries)mixed.file('z_line.'+suffix,data);
 const r=await run(new Uint8Array(await mixed.generateAsync({type:'uint8array'})),
  'shp',geojson([feature({Code:1},{type:'Point',coordinates:[116.4,39.9]}),
   feature(props(lineFeature),lineGeom)]),'geojson');
 assert.equal(check(r,'complex-geometry-values'),'unavailable');
 assert.equal(check(r,'complex-feature-attributes'),'unavailable',
  'Mixed Point/Line layer archives remain outside the P61 certification scope');
 tests++;
}
console.log('P61_MULTI_LAYER_LINE_POLYGON_FIDELITY PASSED '+tests+
 ' real-binary cases: SHP->GeoJSON and GeoJSON->multi-SHP, row/layer reorder, DBF value/name loss,'+
 ' moved interior vertices, polygon holes, duplicate ambiguity, multipart lines, MultiPolygon shells,'+
 ' missing/legacy CPG, feature-count loss and mixed-geometry fail-closed behavior');
