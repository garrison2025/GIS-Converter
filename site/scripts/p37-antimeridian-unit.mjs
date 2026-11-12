/**
 * P37 antimeridian regression tests for the preview sample only.
 * Original converted output, geographic coordinates and true bounding box
 * must remain unchanged; only an SVG-local shifted frame may be added.
 */
import assert from 'node:assert/strict';
import {makeOutputGeometryPreview} from '../src/lib/output-geometry-preview.mjs';

const feature=(type,coordinates,properties={})=>({
 type:'Feature',geometry:{type,coordinates},properties
});
const collection=(...features)=>({type:'FeatureCollection',features});
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,
 'Expected '+actual+' ~= '+expected);

const datelineLine=feature('LineString',[[179.5,12],[-179.5,13]],{Name:'Dateline line'});
const original=JSON.stringify(collection(datelineLine));
const line=makeOutputGeometryPreview(collection(datelineLine));
assert.equal(JSON.stringify(collection(datelineLine)),original,'Source was mutated');
assert.equal(line.status,'ready');
assert.equal(line.antimeridianView,true);
assert.deepEqual(line.bbox,[-179.5,12,179.5,13],'Original bbox must stay WGS84');
assert.deepEqual(line.features[0].coordinates,datelineLine.geometry.coordinates,
 'Raw coordinates must remain from converted output');
assert.deepEqual(line.displayBbox,[179.5,12,180.5,13]);
close(line.features[0].displayCoordinates[1][0]-line.features[0].displayCoordinates[0][0],1);
assert(line.warnings.some(w=>/shortest.longitude.arc/i.test(w)),
 'Unsafe short-arc assumption must be visible');
assert(line.warnings.some(w=>/original WGS84/i.test(w)),
 'Shifted drawing must be distinguished from converted output');

const polygon=feature('Polygon',[
 [[179,10],[-179,10],[-179,13],[179,13],[179,10]],
 [[179.3,11],[-179.3,11],[-179.3,12],[179.3,12],[179.3,11]]
],{Name:'Dateline donut'});
const multi=makeOutputGeometryPreview(collection(polygon,feature('Point',[179.9,11])));
assert.equal(multi.status,'ready');
assert.equal(multi.geometryCounts.polygon,1);
assert.equal(multi.features[0].coordinates.length,2,
 'Original polygon hole must remain present');
assert.equal(multi.features[0].displayCoordinates.length,2,
 'Transformed polygon must preserve the hole ring');
assert.deepEqual(multi.features[0].displayCoordinates[0][0],
 multi.features[0].displayCoordinates[0].at(-1),
 'Polygon closure must remain intact');
const outer=multi.features[0].displayCoordinates[0].map(p=>p[0]);
const inner=multi.features[0].displayCoordinates[1].map(p=>p[0]);
close(Math.min(...outer),179);close(Math.max(...outer),181);
close(Math.min(...inner),179.3);close(Math.max(...inner),180.7);

const eastToWest=makeOutputGeometryPreview(collection(
 feature('MultiLineString',[
  [[-179.7,-5],[179.7,-4]],
  [[179.8,-3],[-179.8,-2]]
 ])
));
assert.equal(eastToWest.status,'ready');
assert.equal(eastToWest.antimeridianView,true);
for(const segment of eastToWest.features[0].displayCoordinates)
 assert(Math.abs(segment[1][0]-segment[0][0])<1.0,
 'MultiLineString should not draw a 359 degree connector');

const ordinary=makeOutputGeometryPreview(collection(
 feature('LineString',[[116.4,39.9],[117.2,40.1]])));
assert.equal(ordinary.status,'ready');
assert.equal(ordinary.antimeridianView,undefined);
assert.equal(ordinary.displayBbox,undefined);
assert.equal(ordinary.features[0].displayCoordinates,undefined);

const dispersed=makeOutputGeometryPreview(collection(
 feature('MultiPoint',[[-170,5],[0,5],[170,5]])));
assert.equal(dispersed.status,'unavailable',
 'Ambiguous global (>180 degree minimal arc) sample must not show false geography');
assert.match(dispersed.reason,/ambiguous/i);

const sameMeridian=makeOutputGeometryPreview(collection(
 feature('LineString',[[180,0],[-180,1]])));
assert.equal(sameMeridian.status,'ready');
assert.equal(sameMeridian.antimeridianView,true);
close(sameMeridian.displayBbox[2]-sameMeridian.displayBbox[0],0);

console.log('P37_ANTIMERIDIAN_UNIT PASSED: dateline lines, polygon holes, multiple parts, geographic bounds, globally ambiguous fail closed, exact +/-180, non-dateline no-op');
