import assert from 'node:assert/strict';
import {makeOutputGeometryPreview,PREVIEW_MAX_FEATURES} from '../src/lib/output-geometry-preview.mjs';
const f=(g,p)=>({type:'Feature',geometry:g,properties:p});
const polygon=f({type:'Polygon',coordinates:[
 [[0,0],[4,0],[4,4],[0,4],[0,0]],
 [[1,1],[2,1],[2,2],[1,2],[1,1]]
]}, {Name:'User <script>alert(1)</script>',Count:2,nested:{risk:true}});
const line=f({type:'LineString',coordinates:[[116.4,39.9],[114.1,22.5]]},{Name:'route'});
const point=f({type:'Point',coordinates:[12.5,48.1]},{Name:'site'});
const ready=makeOutputGeometryPreview({type:'FeatureCollection',features:[polygon,line,point]});
assert.equal(ready.status,'ready');
assert.equal(ready.displayed,3);
assert.equal(ready.totalKnown,3);
assert.equal(ready.geometryCounts.point,1);
assert.equal(ready.geometryCounts.line,1);
assert.equal(ready.geometryCounts.polygon,1);
assert.equal(ready.features[0].coordinates.length,2,'Polygon hole disappeared');
assert.equal(ready.features[0].properties.Name,'User <script>alert(1)</script>');
assert(!Object.hasOwn(ready.features[0].properties,'nested'));
assert.deepEqual(ready.bbox,[0,0,116.4,48.1]);
const huge=makeOutputGeometryPreview({type:'FeatureCollection',features:Array.from({length:100},(_,i)=>f({
 type:'Point',coordinates:[10+i*.01,20]},{Index:i}))});
assert.equal(huge.displayed,PREVIEW_MAX_FEATURES);
assert.equal(huge.totalKnown,100);
assert.equal(huge.truncated,true);
const notWgs=makeOutputGeometryPreview({type:'FeatureCollection',crs:{type:'name',properties:{name:'EPSG:3857'}},features:[point]});
assert.equal(notWgs.status,'unavailable');
assert.match(notWgs.reason,/CRS/);
assert.equal(makeOutputGeometryPreview({type:'FeatureCollection',features:[f({type:'Point',coordinates:[200,20]})]}).status,'unavailable');
assert.equal(makeOutputGeometryPreview({type:'FeatureCollection',features:[f({type:'Point',coordinates:[Infinity,20]})]}).status,'unavailable');
assert.equal(makeOutputGeometryPreview({type:'FeatureCollection',features:[f({type:'GeometryCollection',geometries:[]})]}).status,'unavailable');
assert.equal(makeOutputGeometryPreview('not json').status,'unavailable');
const dense=makeOutputGeometryPreview({type:'FeatureCollection',features:[
 f({type:'LineString',coordinates:Array.from({length:3100},(_,i)=>[i*.001,0])})]});
assert.equal(dense.status,'unavailable');
console.log('P35_PREVIEW_UNIT PASSED: polygon hole, mixed geometry, 60-feature sample, CRS, limits, metadata, invalid input');
