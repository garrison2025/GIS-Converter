/**
 * P41 deterministic, bounded geometry-fidelity scale regression.
 * Synthetic fixtures are generated here; no private file is used.
 * Execution-time figures are CI observations, not guaranteed device speeds.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {inspectComplexGeometryFidelity} from '../src/lib/complex-geometry-fidelity.mjs';

const bytes=s=>new TextEncoder().encode(s);
const polygon=(x,y,alter=false)=>{
 const fx=n=>Number(n.toFixed(6));
 const outer=[[x,y],[x,y+.008],[x+.008,y+.008],[x+.008,y],[x,y]]
  .map(([a,b])=>[fx(a),fx(b)]);
 const inner=[[x+.002,y+.002],[x+.005,y+.002],[x+.005,y+.005],
  [x+.002,y+.005],[x+.002,y+.002]].map(([a,b])=>[fx(a),fx(b)]);
 if(alter)inner[2][0]=fx(x+.006);
 return [outer,inner];
};
const xmlPolygon=rings=>'<Polygon>'+rings.map((ring,i)=>
 '<'+(i?'innerBoundaryIs':'outerBoundaryIs')+'><LinearRing><coordinates>'+
 ring.map(p=>p.join(',')).join(' ')+'</coordinates></LinearRing></'+
 (i?'innerBoundaryIs':'outerBoundaryIs')+'>').join('')+'</Polygon>';
const geojson=geoms=>JSON.stringify({type:'FeatureCollection',features:
 geoms.map(coordinates=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates}}))});
const kml=geoms=>'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+
 geoms.map(r=>'<Placemark>'+xmlPolygon(r)+'</Placemark>').join('')+'</Document></kml>';

const N=3500,geoms=Array.from({length:N},(_,i)=>
 polygon(100+(i%100)*.011,18+Math.floor(i/100)*.011));
const source=bytes(geojson(geoms)),shuffled=bytes(kml([...geoms].reverse()));
assert(source.length<15*1024*1024,'Generated source exceeds 15 MiB upload limit');
let start=performance.now();
let result=await inspectComplexGeometryFidelity(source,'geojson',shuffled,'kml');
const passWallMs=Math.round(performance.now()-start);
assert.equal(result.status,'pass','All 3,500 reordered distinct polygon shells and holes must pass');
assert(result.detail.includes('Polygon=3500'),'Report must account for entire polygon collection');
const altered=[...geoms].reverse();
altered[1500]=polygon(100+((N-1-1500)%100)*.011,
 18+Math.floor((N-1-1500)/100)*.011,true);
start=performance.now();
result=await inspectComplexGeometryFidelity(source,'geojson',bytes(kml(altered)),'kml');
const changedWallMs=Math.round(performance.now()-start);
assert.equal(result.status,'review',
 'Changed hole inside identical outer bbox must be detected even in 3,500 features');

const duplicate=bytes(geojson([geoms[0],geoms[0]]));
const duplicateOut=bytes(kml([geoms[0],geoms[0]]));
result=await inspectComplexGeometryFidelity(duplicate,'geojson',duplicateOut,'kml');
assert.equal(result.status,'unavailable',
 'Ambiguous duplicate geometry correspondence must not falsely certify or block');

const justOver=bytes(geojson([...geoms,...geoms.slice(0,501)]));
result=await inspectComplexGeometryFidelity(justOver,'geojson',shuffled,'kml');
assert.equal(result.status,'unavailable','Hard feature limit must fail closed');

const LONG=60000;
const line=Array.from({length:LONG},(_,i)=>[Number((80+i*.000002).toFixed(6)),
 Number((20+(i%23)*.000002).toFixed(6))]);
const lineGeo=JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:line}}]});
const lineKml='<?xml version="1.0"?><kml><Document><Placemark><LineString><coordinates>'+
 line.map(p=>p.join(',')).join(' ')+'</coordinates></LineString></Placemark></Document></kml>';
start=performance.now();
result=await inspectComplexGeometryFidelity(bytes(lineGeo),'geojson',bytes(lineKml),'kml');
const longLineWallMs=Math.round(performance.now()-start);
assert.equal(result.status,'pass','60,000-vertex line must retain its actual XY sequence');

// Limits avoid quadratic matching / excessive heap. This is deliberately
// permissive to avoid flaky runner effects, while rejecting severe O(N²)
// regressions that would make 3,500-polygon independent checks unusable.
assert(passWallMs<15000&&changedWallMs<15000&&longLineWallMs<15000,
 'P41 geometry verification exceeded the broad 15-second CI safety budget');
const summary={status:'PASSED',features:N,polygonRings:N*2,polygonVertices:N*10,
 longLineVertices:LONG,sourceBytes:source.length,targetBytes:shuffled.length,
 reorderedPolygonCheckMs:passWallMs,changedHoleDetectionMs:changedWallMs,
 longLineCheckMs:longLineWallMs,
 heapUsedAfterBytes:process.memoryUsage().heapUsed,
 caveat:'Local Node/GitHub runner timing/heap figures only; not browser-device benchmarks or WAN conversion latency'};
console.log('P41_LARGE_GEOMETRY '+JSON.stringify(summary));
