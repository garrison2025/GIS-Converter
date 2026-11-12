/**
 * P39 cross-format, output-byte point-fidelity regression.
 * Synthetic private-coordinate samples are never sent to a service; reports
 * contain aggregate statuses and counts only.
 */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {inspectPointCoordinateFidelity} from '../src/lib/point-coordinate-fidelity.mjs';
import {createGISQualityReport,inspectGISData,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';

const bytes=s=>new TextEncoder().encode(s);
const feature=(xy,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates:xy},properties});
const geojson=(coords,crs)=>JSON.stringify({type:'FeatureCollection',
 ...(crs?{crs:{type:'name',properties:{name:crs}}}:{}),
 features:coords.map(x=>feature(x))});
const kml=(coords)=>'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+
 coords.map(([x,y])=>'<Placemark><Point><coordinates>'+x+','+y+',0</coordinates></Point></Placemark>').join('')+
 '</Document></kml>';
const source=[[-10,0],[0.153219,2.421738],[10,10]];
const altered=[[-10,0],[1.153219,3.421738],[10,10]]; // extrema unchanged
const get=(r,id)=>r.checks.find(x=>x.id===id);
let r=await createGISQualityReport(new File([geojson(source)],'in.geojson'),
 'geojson',bytes(kml(altered)),'kml');
assert.equal(get(r,'feature-count').status,'pass');
assert.equal(get(r,'coordinate-bounds').status,'pass',
 'Matching bounding boxes cannot prove interior XY values are intact');
assert.equal(get(r,'point-coordinate-values').status,'review');
assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'},
 'A middle point moved within the unchanged bounding box must block the output');
assert(!get(r,'point-coordinate-values').detail.includes('0.153219'),
 'Do not disclose input point coordinates in downloadable report details');

r=await createGISQualityReport(new File([kml(source)],'in.kml'),
 'kml',bytes(geojson([...source].reverse())),'geojson');
assert.equal(get(r,'point-coordinate-values').status,'pass',
 'Point ordering is not an invariant across GDAL format conversion');
assert.equal(assertNoDetectedCriticalDataLoss(r),true);

const csv='longitude,latitude,Name\r\n'+
 '-10,0,"First, a comma"\r\n0.153219,2.421738,"Second"\r\n10,10,"Third"\r\n';
r=await createGISQualityReport(new File([csv],'in.csv'),'csv',bytes(kml(source)),'kml');
assert.equal(get(r,'point-coordinate-values').status,'pass',
 'CSV escaped values and all three WGS84 points should match converted KML');

const kmzArchive=new JSZip();kmzArchive.file('doc.kml',kml(source));
const kmz=await kmzArchive.generateAsync({type:'uint8array',compression:'DEFLATE'});
const comparison=await inspectPointCoordinateFidelity(kmz,'kmz',bytes(geojson(source)),'geojson');
assert.equal(comparison.status,'pass');

const gpx='<gpx xmlns="http://www.topografix.com/GPX/1/1">'+
 source.map(([x,y])=>'<wpt lon="'+x+'" lat="'+y+'"><name>A</name></wpt>').join('')+
 '</gpx>';
r=await createGISQualityReport(new File([gpx],'in.gpx'),'gpx',bytes(kml(source)),'kml');
assert.equal(get(r,'point-coordinate-values').status,'pass','Waypoint-only GPX is certifiable');

const multiline='<gpx><trk><trkseg><trkpt lon="10" lat="20"/>'+
 '<trkpt lon="11" lat="21"/></trkseg></trk></gpx>';
r=await createGISQualityReport(new File([multiline],'in.gpx'),'gpx',bytes(kml([[10,20],[11,21]])),'kml');
assert.equal(get(r,'point-coordinate-values').status,'unavailable',
 'GPX track output must use separate route/line fidelity, not point comparison');

const multipoint=JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',properties:{},geometry:{type:'MultiPoint',coordinates:[[1,2],[3,4]]}}
]});
assert.equal((await inspectPointCoordinateFidelity(bytes(multipoint),'geojson',
 bytes(kml([[1,2],[3,4]])),'kml')).status,'unavailable');

r=await createGISQualityReport(new File([geojson(source,'EPSG:3857')],'in.geojson'),
 'geojson',bytes(kml(source)),'kml');
assert.equal(get(r,'point-coordinate-values').status,'unavailable',
 'Projected input cannot be treated as geographic WGS84 without reprojection');

r=await createGISQualityReport(new File([geojson([[0,0]])],'in.geojson'),
 'geojson',bytes(kml([[0,0]])),'kml');
assert.equal(get(r,'point-coordinate-values').status,'pass',
 'A true 0/0 coordinate must remain valid');

const swapped=await inspectPointCoordinateFidelity(
 bytes(geojson([[20,30],[20,31],[21,31]])),'geojson',
 bytes(kml([[20,31],[21,31],[20,30]])),'kml');
assert.equal(swapped.status,'pass','Shared longitude with different latitude is safe to match');

const duplicates=await inspectPointCoordinateFidelity(
 bytes(geojson([[0,0],[0,0]])),'geojson',bytes(kml([[0,0],[0,0]])),'kml');
assert.equal(duplicates.status,'unavailable',
 'Repeated points cannot yield false certain coordinate matching');
const seam=await inspectPointCoordinateFidelity(
 bytes(geojson([[180,10]])),'geojson',bytes(kml([[-180,10]])),'kml');
assert.equal(seam.status,'unavailable','Date-line coordinate equivalents are ambiguous');

// The quality-report's fast structural inspector must not earn a "pass"
// through JS Number(' ')==0, hexadecimal CSV or invalid WGS84 latitude.
for(const [format,sourceText] of [
 ['kml','<kml><Placemark><Point><coordinates>,12</coordinates></Point></Placemark></kml>'],
 ['gpx','<gpx><wpt lat="12" lon=" "/></gpx>'],
 ['csv','longitude,latitude\n0x10,12\n'],
 ['geojson',geojson([[190,12]])]
]){
 const meta=await inspectGISData(format,bytes(sourceText));
 assert.equal(meta.complete,false,
  format+' quality inspector must reject invalid WGS84 or coerced coordinates');
}
const multiMeta=await inspectGISData('geojson',bytes(multipoint));
assert.equal(multiMeta.pointOnly,false,
 'MultiPoint must not qualify for one-position-per-feature bbox certification');

const dangerous='{"secret":"PRIVATE_PERSON_abc123",not-valid-json}';
const failClosed=await inspectPointCoordinateFidelity(
 bytes(dangerous),'geojson',bytes(kml([[0,0]])),'kml');
assert.equal(failClosed.status,'unavailable');
assert(!JSON.stringify(failClosed).includes('PRIVATE_PERSON_abc123'),
 'Malformed private GIS file text must not leak in quality report details');

const drift=await inspectPointCoordinateFidelity(
 bytes(geojson(source)),'geojson',
 bytes(kml([source[0],[0.153219+0.000003,2.421738],[10,10]])),'kml');
assert.equal(drift.status,'pass','Conservative 0.000005° output rounding budget');
console.log('P39_POINT_FIDELITY PASSED: moved middle points with matching bbox blocked, reordered points, CSV/KML/KMZ, GPX waypoint-only, complex/unconfirmed CRS fail-closed, anti-meridian and duplicate ambiguity, privacy-safe errors');
