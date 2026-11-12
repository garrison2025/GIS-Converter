/**
 * P38: in-memory GPX/KML/KMZ/SHP output preview data-integrity boundaries.
 * Tests the actual generated-byte preview reader, not the source converter.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {extractConvertedOutputPreview} from '../src/lib/converted-output-preview.mjs';

const bytes=s=>new TextEncoder().encode(s);
const read=(format,text)=>extractConvertedOutputPreview(null,bytes(text),format);
const gpx=body=>'<?xml version="1.0"?><gpx version="1.1" creator="p38" '+
 'xmlns="http://www.topografix.com/GPX/1/1">'+body+'</gpx>';
const kml=body=>'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" '+
 'xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>'+
 body+'</Placemark></Document></kml>';
const point=x=>kml('<Point><coordinates>'+x+'</coordinates></Point>');
const track=(times,coords)=>kml('<gx:Track>'+times.map(t=>'<when>'+t+'</when>').join('')+
 coords.map(c=>'<gx:coord>'+c+'</gx:coord>').join('')+'</gx:Track>');
const unavailable=async(format,source,message)=>{
 const result=await read(format,source);
 assert.equal(result.status,'unavailable',message+' must not render a false GIS preview');
 assert.match(result.reason,/preview|coordinate|ring|timestamp|track|geometry|outer|invalid|numeric/i);
};

let result=await read('gpx',gpx('<wpt lat="0" lon="0"><name>Origin</name></wpt>'));
assert.equal(result.status,'ready');
assert.deepEqual(result.features[0].coordinates,[0,0]);
for(const [caseName,source] of [
 ['blank waypoint longitude',gpx('<wpt lat="12.5" lon=" "/>')],
 ['blank track latitude',gpx('<trk><trkseg><trkpt lat=" " lon="12"/><trkpt lat="13" lon="14"/></trkseg></trk>')],
 ['non-numeric route coordinate',gpx('<rte><rtept lat="13" lon="foo"/><rtept lat="12" lon="14"/></rte>')],
 ['lon lookalike attribute',gpx('<wpt lat="12" data-lon="14"/>')],
 ['non-finite waypoint exponent',gpx('<wpt lat="11" lon="1e999"/>')]
])await unavailable('gpx',source,caseName);

result=await read('kml',point('0,0,0'));
assert.equal(result.status,'ready');
assert.deepEqual(result.features[0].coordinates,[0,0]);
for(const [caseName,source] of [
 ['blank KML longitude',point(',12')],
 ['missing KML latitude',point('13,')],
 ['invalid optional altitude',point('13,12,')],
 ['too many tuple components',point('13,12,14,15')],
 ['nonfinite coordinate',point('1e999,12')]
])await unavailable('kml',source,caseName);

const a='2026-01-01T00:00:00Z',b='2026-01-01T00:01:00Z';
const validTrack=track([a,b],['179 12 20','-179 13 21']);
result=await read('kml',validTrack);
assert.equal(result.status,'ready');
assert.equal(result.antimeridianView,true,'Valid gx:Track should remain a dateline-spanning line');
assert.equal(result.geometryCounts.line,1);
for(const [caseName,source] of [
 ['missing gx time',track([a],['179 12 20','-179 13 21'])],
 ['bad gx time',track([a,'not-a-date'],['179 12 20','-179 13 21'])],
 ['missing gx altitude',track([a,b],['179 12','-179 13 21'])],
 ['empty gx longitude',track([a,b],[' ','-179 13 21'])]
])await unavailable('kml',source,caseName);

const kmz=new JSZip();kmz.file('doc.kml',validTrack);
result=await extractConvertedOutputPreview(null,
 await kmz.generateAsync({type:'uint8array',compression:'DEFLATE'}),'kmz');
assert.equal(result.status,'ready');
assert.equal(result.geometryCounts.line,1);

// SHP polygon ring encoding exercises the actual WGS84 ZIP byte parser.
const shell=[[0,0],[0,4],[4,4],[4,0],[0,0]]; // clockwise
const hole=[[1,1],[2,1],[2,2],[1,2],[1,1]]; // counterclockwise
function makeShp(rings){
 const parts=rings.length,count=rings.reduce((n,r)=>n+r.length,0);
 const contentBytes=44+parts*4+count*16,total=100+8+contentBytes;
 const raw=new Uint8Array(total),view=new DataView(raw.buffer);
 view.setInt32(0,9994,false);view.setInt32(24,total/2,false);
 view.setInt32(28,1000,true);view.setInt32(32,5,true);
 view.setInt32(100,1,false);view.setInt32(104,contentBytes/2,false);
 view.setInt32(108,5,true);
 view.setInt32(108+36,parts,true);view.setInt32(108+40,count,true);
 let idx=0,offset=108+44+parts*4;
 for(let i=0;i<parts;i++){
  view.setInt32(108+44+i*4,idx,true);
  for(const [x,y] of rings[i]){
   view.setFloat64(offset,x,true);view.setFloat64(offset+8,y,true);
   offset+=16;idx++;
  }
 }
 return raw;
}
function makeDbf(){
 const raw=new Uint8Array(65+13+1),dv=new DataView(raw.buffer);
 raw[0]=3;dv.setUint32(4,1,true);dv.setUint16(8,65,true);dv.setUint16(10,13,true);
 raw.set(bytes('Label'),32);raw[43]=67;raw[48]=12;raw[64]=13;
 raw[65]=32;raw.set(bytes('Polygon'.padEnd(12,' ')),66);raw.at(-1);
 return raw;
}
async function shapeZip(rings){
 const zip=new JSZip();
 zip.file('shapes.shp',makeShp(rings));
 zip.file('shapes.prj','GEOGCS["WGS 84",DATUM["WGS_1984"],UNIT["degree",0.0174532925199433]]');
 zip.file('shapes.dbf',makeDbf());zip.file('shapes.cpg','UTF-8');
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
result=await extractConvertedOutputPreview(null,await shapeZip([shell,hole]),'shp');
assert.equal(result.status,'ready','Valid SHP clockwise shell/counterclockwise hole should preview');
assert.equal(result.geometryCounts.polygon,1);
assert.equal(result.features[0].coordinates.length,2,'SHP hole must remain attached to shell');
assert.equal(result.features[0].properties.Label,'Polygon');
for(const [caseName,rings] of [
 ['orphan counterclockwise hole',[hole,shell]],
 ['nonclosed shell',[shell.slice(0,-1).concat([[0,0.01]])]],
 ['zero-area degenerate ring',[[[0,0],[1,0],[2,0],[0,0]]]]
]){
 const bad=await extractConvertedOutputPreview(null,await shapeZip(rings),'shp');
 assert.equal(bad.status,'unavailable',caseName+' must not fabricate topology');
}
console.log('P38_GIS_PREVIEW_BOUNDARIES PASSED: GPX/KML numeric safety, gx:Track pairing, KMZ, SHP ring closure/orientation and hole integrity');
