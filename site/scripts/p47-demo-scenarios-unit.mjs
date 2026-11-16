import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {makeScenarioGISFile,supportedDemoScenarios,DEMO_LINE,DEMO_POLYGON,
 SCENARIO_LABELS} from '../src/lib/demo-gis-scenarios.mjs';
import {routes} from '../src/lib/converter-routes.mjs';
import {preflightGISInput} from '../src/lib/input-preflight.mjs';
assert.equal(Object.keys(SCENARIO_LABELS).length,3);
const formats=['kml','kmz','shp','geojson','gpx','csv'];
const dest=['kml','kmz','shp','geojson','gpx','csv'];
const compatible=[];
for(const [slug,source,target] of routes){
 const choices=supportedDemoScenarios(source,target);
 assert.equal(choices[0],'point',slug+' must retain P46 default sample');
 assert.equal(new Set(choices).size,choices.length,'Duplicate scenario on '+slug);
 assert(choices.every(choice=>['point','line','polygon'].includes(choice)));
 if(target==='csv')assert.deepEqual(choices,['point'],'CSV output must not advertise line or polygon');
 if(target==='gpx')assert(!choices.includes('polygon'),'GPX cannot encode polygon hole');
 if(source==='csv')assert.deepEqual(choices,['point'],'CSV has no polyline or polygon source');
 if(source==='gpx')assert(!choices.includes('polygon'),'GPX cannot carry polygon');
 compatible.push({slug,source,target,choices});
}
for(const src of formats)for(const dst of dest){
 const choices=supportedDemoScenarios(src,dst);
 const expected=routes.some(([,s,t])=>s===src&&t===dst);
 if(expected)assert(choices.length>=1,'Supported converter has no example');
}
assert.deepEqual(supportedDemoScenarios('evil','shp'),[]);
assert.deepEqual(supportedDemoScenarios('kml','evil'),[]);
assert.equal(DEMO_LINE.length,3);
assert.equal(DEMO_POLYGON.length,2);
assert.deepEqual(DEMO_POLYGON[0][0],DEMO_POLYGON[0].at(-1));
assert.deepEqual(DEMO_POLYGON[1][0],DEMO_POLYGON[1].at(-1));
const ringArea=ring=>ring.reduce((sum,p,i)=>i===ring.length-1?sum:
 sum+(p[0]*ring[i+1][1]-ring[i+1][0]*p[1]),0)/2;
assert(ringArea(DEMO_POLYGON[0])<0,'SHP exterior must be clockwise');
assert(ringArea(DEMO_POLYGON[1])>0,'SHP hole must be counter-clockwise');
let count=0;
for(const src of ['kml','kmz','geojson','gpx','shp']){
 for(const scenario of src==='gpx'?['line']:['line','polygon']){
  const sample=await makeScenarioGISFile(src,scenario);
  assert(sample.name.startsWith('gis-example-'+scenario+'.'));
  assert(sample.size>0&&sample.size<16384);
  const target=routes.find(([,from,to])=>from===src&&
   supportedDemoScenarios(from,to).includes(scenario))?.[2];
  assert(target,'No valid sample output route for '+src+' '+scenario);
  await preflightGISInput(sample,src,target);
  if(src==='geojson'){
   const geo=JSON.parse(await sample.text());
   assert.equal(geo.features.length,1);
   assert.equal(geo.features[0].geometry.type,scenario==='line'?'LineString':'Polygon');
   assert.equal(geo.features[0].geometry.coordinates.length,scenario==='line'?3:2);
  }
  if(src==='kml'){
   const xml=await sample.text();
   assert(xml.includes('<'+(scenario==='line'?'LineString':'Polygon')+'>'));
   if(scenario==='polygon')assert(xml.includes('<innerBoundaryIs>'));
  }
  if(src==='gpx'){
   const xml=await sample.text();
   assert.equal((xml.match(/<trkpt /g)||[]).length,3);
   assert.equal((xml.match(/<time>/g)||[]).length,3);
  }
  if(src==='kmz'){
   const archive=await JSZip.loadAsync(await sample.arrayBuffer());
   assert.deepEqual(Object.keys(archive.files),['doc.kml']);
   const text=await archive.file('doc.kml').async('string');
   assert(text.includes(scenario==='line'?'<LineString>':'<innerBoundaryIs>'));
  }
  if(src==='shp'){
   const archive=await JSZip.loadAsync(await sample.arrayBuffer());
   assert.deepEqual(Object.keys(archive.files).sort(),
    ['example.shp','example.shx','example.dbf','example.prj','example.cpg'].sort());
   const shp=await archive.file('example.shp').async('uint8array');
   const shx=await archive.file('example.shx').async('uint8array');
   const dbf=await archive.file('example.dbf').async('uint8array');
   const v=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
   const x=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
   const type=scenario==='line'?3:5;
   assert.equal(v.getInt32(0,false),9994);
   assert.equal(v.getInt32(24,false),shp.length/2);
   assert.equal(v.getInt32(32,true),type);
   assert.equal(v.getInt32(104,false),(shp.length-108)/2);
   assert.equal(v.getInt32(108,true),type);
   assert.equal(v.getInt32(144,true),scenario==='line'?1:2);
   assert.equal(v.getInt32(148,true),scenario==='line'?3:10);
   assert.equal(x.getInt32(100,false),50);
   assert.equal(x.getInt32(104,false),(shp.length-108)/2);
   assert.equal(dbf[127],scenario==='line'?50:51);
   const pos=152+4*(scenario==='line'?1:2);
   assert.equal(v.getFloat64(pos,true),116.4);
   assert.equal(v.getFloat64(pos+8,true),39.9);
   assert.equal(new TextDecoder().decode(dbf.slice(98,98+scenario.length+8)).startsWith('Example'),true);
  }
  count++;
 }
}
assert.equal(count,9);
await assert.rejects(()=>makeScenarioGISFile('csv','line'),/Unsupported line example/);
await assert.rejects(()=>makeScenarioGISFile('gpx','polygon'),/Unsupported polygon example/);
await assert.rejects(()=>makeScenarioGISFile('kml','fake'),/Unsupported demo scenario/);
console.log('P47_SCENARIOS_UNIT PASSED: 19 routes verified, 9 line/polygon inputs preflighted, real SHP PolyLine/Polygon record byte checks, polygon ring winding and strict unsupported geometry exclusions');
