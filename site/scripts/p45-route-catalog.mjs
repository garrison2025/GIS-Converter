import assert from 'node:assert/strict';
import {routes,FORMAT_CODES} from '../src/lib/converter-routes.mjs';
import {routeHrefFor,routeSlugFor,availableTargetsFor} from '../src/lib/route-picker.mjs';
import {routes as gdalRoutes} from '../src/lib/gdal-matrix.mjs';
import {formats,notes} from '../src/data/content.mjs';
import {routeGuides} from '../src/data/route-guides.mjs';

assert.equal(routes.length,19,'All 19 registered routes must remain in the lightweight catalog');
assert.deepEqual(gdalRoutes,routes,'GDAL engine must use exact same route catalog as UI');
const slugs=new Set(),pairs=new Set();
for(const [slug,source,target] of routes){
 assert.equal(slug,source+'-to-'+target,'The converter URL must match the format pair');
 assert(FORMAT_CODES.includes(source)&&FORMAT_CODES.includes(target),'Unknown input or output format');
 assert.notEqual(source,target,'Identity routes must not be claimed as conversion routes');
 assert(!slugs.has(slug),'Duplicate converter slug');
 assert(!pairs.has(source+':'+target),'Duplicate conversion pair');
 slugs.add(slug);pairs.add(source+':'+target);
 assert.equal(routeHrefFor(source,target),'/converter/'+slug+'/','Invalid route navigation');
 assert.equal(routeSlugFor(source,target),slug);
 assert(availableTargetsFor(source).includes(target),'Existing destination missing');
 assert(formats[source]?.name&&formats[target]?.help,'Unknown format instructions');
 assert(notes[slug]?.context&&notes[slug]?.caution,'Missing per-route caution');
 assert(routeGuides[slug]?.inputs&&routeGuides[slug]?.output&&
  routeGuides[slug]?.verify&&routeGuides[slug]?.mistake&&
  routeGuides[slug]?.faq?.length===2,'Incomplete per-route practical guidance');
 for(const str of [routeGuides[slug].inputs,routeGuides[slug].output,
   routeGuides[slug].verify,routeGuides[slug].mistake])
   assert(str.length>=35,'Route practical guidance too vague on '+slug);
}
assert.equal(slugs.size,19);
for(const source of FORMAT_CODES){
 const targets=availableTargetsFor(source);
 assert(targets.length>0,'All supported sources should have a route: '+source);
 assert.equal(new Set(targets).size,targets.length,'Target options cannot duplicate');
 for(const target of FORMAT_CODES){
  const expected=routes.find(([,s,t])=>s===source&&t===target);
  assert.equal(routeSlugFor(source,target),expected?.[0]||null,
   'Unsupported pair must not receive a fabricated URL');
  assert.equal(routeHrefFor(source,target),expected?'/converter/'+expected[0]+'/':null);
 }
}
assert.deepEqual(availableTargetsFor('unknown'),[]);
assert.equal(routeHrefFor('shp','gpx'),null,'No invented SHP to GPX route');
assert.equal(routeHrefFor('csv','shp'),null,'No invented CSV to SHP route');
assert.equal(routeHrefFor('__proto__','kml'),null,'Untrusted source cannot access prototype');
assert.equal(routeHrefFor('kml','toString'),null,'Untrusted output cannot access prototype');
console.log('P45_ROUTE_CATALOG PASSED: 19 unique real routes, 6 sources, 36 exact pair checks, no invented paths, full practical copy and GDAL/UX parity');
