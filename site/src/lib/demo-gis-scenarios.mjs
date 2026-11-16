/**
 * P47 real scenario files for the existing browser-local conversion engine.
 * Point falls back to independently verified P46. Other synthetic geometries
 * are a 3-vertex LineString/GPX track and a Polygon with one interior hole.
 * No background requests, user file reads, external dependencies or mock GIS.
 *
 * Only advertise examples whose geometry family can be represented by both
 * the source and target. Conservative exclusions avoid false GPX polygon,
 * plain CSV lines/polygons, and unsupported CSV reprojection claims.
 */
import {makeDemoGISFile} from './demo-gis-files.mjs';

export const SCENARIO_LABELS=Object.freeze({
 point:'One WGS84 point',
 line:'Three-vertex line / GPS track',
 polygon:'Polygon with one interior hole'
});
const SOURCE_LINES=new Set(['kml','kmz','geojson','gpx','shp']);
const SOURCE_POLYGONS=new Set(['kml','kmz','geojson','shp']);
const TARGET_LINES=new Set(['kml','kmz','geojson','gpx','shp']);
const TARGET_POLYGONS=new Set(['kml','kmz','geojson','shp']);
export function supportedDemoScenarios(source,target){
 if(!['kml','kmz','geojson','gpx','shp','csv'].includes(source)||
    !['kml','kmz','geojson','gpx','shp','csv'].includes(target))return [];
 const types=['point'];
 if(SOURCE_LINES.has(source)&&TARGET_LINES.has(target))types.push('line');
 if(SOURCE_POLYGONS.has(source)&&TARGET_POLYGONS.has(target))types.push('polygon');
 return types;
}
const LINE=Object.freeze([[116.4,39.9],[116.45,39.95],[116.5,40]]);
// ESRI Shapefile exterior ring clockwise; hole counter-clockwise.
// Rings remain closed and entirely within the WGS84 synthetic bounding box.
const OUTER=Object.freeze([[116.4,39.9],[116.4,40],[116.5,40],[116.5,39.9],[116.4,39.9]]);
const HOLE=Object.freeze([[116.425,39.925],[116.475,39.925],[116.475,39.975],[116.425,39.975],[116.425,39.925]]);
export const DEMO_LINE=LINE.map(p=>[...p]);
export const DEMO_POLYGON=[OUTER,HOLE].map(r=>r.map(p=>[...p]));
const utf8=new TextEncoder();
const POINT_SOURCE_CRS='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'+
 'SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],'+
 'UNIT["Degree",0.0174532925199433]]';
function kmlBody(scenario){
 if(scenario==='line')return '<LineString><tessellate>1</tessellate><coordinates>'+
  LINE.map(p=>p.join(',')).join(' ')+'</coordinates></LineString>';
 return '<Polygon><outerBoundaryIs><LinearRing><coordinates>'+
  OUTER.map(p=>p.join(',')+',0').join(' ')+'</coordinates></LinearRing></outerBoundaryIs>'+
  '<innerBoundaryIs><LinearRing><coordinates>'+
  HOLE.map(p=>p.join(',')+',0').join(' ')+'</coordinates></LinearRing></innerBoundaryIs></Polygon>';
}
function kml(scenario){
 return '<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'+
 '<name>Example '+(scenario==='line'?'line':'polygon with a hole')+'</name>'+
 kmlBody(scenario)+'</Placemark></Document></kml>';
}
function gpxTrack(){
 return '<?xml version="1.0" encoding="UTF-8"?>'+
 '<gpx version="1.1" creator="GIS Converter synthetic example" xmlns="http://www.topografix.com/GPX/1/1">'+
 '<trk><name>Example GPS track</name><trkseg>'+
 LINE.map(([lon,lat],i)=>'<trkpt lat="'+lat+'" lon="'+lon+'"><ele>'+
  (100+i*5)+'</ele><time>2024-01-01T00:0'+i+':00Z</time></trkpt>').join('')+
 '</trkseg></trk></gpx>';
}
function geojson(scenario){
 return JSON.stringify({type:'FeatureCollection',features:[{
  type:'Feature',properties:{Name:scenario==='line'?'Example line':'Example polygon',Code:scenario==='line'?2:3},
  geometry:scenario==='line'?{type:'LineString',coordinates:LINE}:
   {type:'Polygon',coordinates:[OUTER,HOLE]}
 }]});
}
function extents(vertices){
 return [Math.min(...vertices.map(p=>p[0])),Math.min(...vertices.map(p=>p[1])),
  Math.max(...vertices.map(p=>p[0])),Math.max(...vertices.map(p=>p[1]))];
}
function header(byteLength,type,bounds){
 const bytes=new Uint8Array(100),v=new DataView(bytes.buffer);
 v.setInt32(0,9994,false);v.setInt32(24,byteLength/2,false);
 v.setInt32(28,1000,true);v.setInt32(32,type,true);
 [36,44,52,60].forEach((offset,i)=>v.setFloat64(offset,bounds[i],true));
 return bytes;
}
function shapeRecord(scenario){
 const parts=scenario==='line'?[LINE]:[OUTER,HOLE];
 const vertices=parts.flat();
 const type=scenario==='line'?3:5;
 const bounds=extents(vertices);
 const contentBytes=4+32+4+4+4*parts.length+16*vertices.length;
 const shp=new Uint8Array(100+8+contentBytes),shx=new Uint8Array(108);
 shp.set(header(shp.length,type,bounds));shx.set(header(shx.length,type,bounds));
 const v=new DataView(shp.buffer),x=new DataView(shx.buffer);
 v.setInt32(100,1,false);v.setInt32(104,contentBytes/2,false);
 v.setInt32(108,type,true);
 bounds.forEach((n,i)=>v.setFloat64(112+i*8,n,true));
 v.setInt32(144,parts.length,true);v.setInt32(148,vertices.length,true);
 let pointIndex=0;
 parts.forEach((points,i)=>{
  v.setInt32(152+4*i,pointIndex,true);
  pointIndex+=points.length;
 });
 let offset=152+parts.length*4;
 for(const [lon,lat] of vertices){
  v.setFloat64(offset,lon,true);v.setFloat64(offset+8,lat,true);offset+=16;
 }
 if(offset!==shp.length)throw Error('Internal synthetic Shapefile record length mismatch');
 x.setInt32(100,50,false);
 x.setInt32(104,contentBytes/2,false);
 return {shp,shx};
}
function dbf(scenario){
 // Binary dBase III with two fixed-size fields, one row and UTF-8 text.
 const bytes=new Uint8Array(129),v=new DataView(bytes.buffer);
 bytes[0]=3;bytes[1]=126;bytes[2]=11;bytes[3]=16;
 v.setUint32(4,1,true);v.setUint16(8,97,true);v.setUint16(10,31,true);
 bytes.set(utf8.encode('Name'),32);bytes[43]=0x43;bytes[48]=24;
 bytes.set(utf8.encode('Code'),64);bytes[75]=0x4e;bytes[80]=6;
 bytes[96]=13;bytes[97]=32;bytes.fill(32,98,128);
 const label=scenario==='line'?'Example line':'Example polygon';
 bytes.set(utf8.encode(label),98);
 bytes[127]=scenario==='line'?50:51;bytes[128]=0x1a;
 return bytes;
}
async function zip(entries){
 const {default:JSZip}=await import('jszip');
 const archive=new JSZip();
 for(const [name,data] of entries)archive.file(name,data);
 return archive.generateAsync({type:'uint8array',compression:'STORE'});
}
export async function makeScenarioGISFile(source,scenario='point'){
 if(scenario==='point')return makeDemoGISFile(source);
 if(!['line','polygon'].includes(scenario))throw Error('Unsupported demo scenario');
 // The format-level restriction also applies if called without a route.
 if(scenario==='polygon'&&!SOURCE_POLYGONS.has(source))throw Error('Unsupported polygon example source');
 if(scenario==='line'&&!SOURCE_LINES.has(source))throw Error('Unsupported line example source');
 let name,bytes,mimeType;
 if(source==='gpx'){
  name='gis-example-line.gpx';mimeType='application/gpx+xml';bytes=gpxTrack();
 }else if(source==='kml'){
  name='gis-example-'+scenario+'.kml';mimeType='application/vnd.google-earth.kml+xml';bytes=kml(scenario);
 }else if(source==='kmz'){
  name='gis-example-'+scenario+'.kmz';mimeType='application/vnd.google-earth.kmz';
  bytes=await zip([['doc.kml',kml(scenario)]]);
 }else if(source==='geojson'){
  name='gis-example-'+scenario+'.geojson';mimeType='application/geo+json';
  bytes=geojson(scenario);
 }else if(source==='shp'){
  name='gis-example-'+scenario+'.zip';mimeType='application/zip';
  const {shp,shx}=shapeRecord(scenario);
  bytes=await zip([['example.shp',shp],['example.shx',shx],['example.dbf',dbf(scenario)],
   ['example.prj',POINT_SOURCE_CRS],['example.cpg','UTF-8']]);
 }else throw Error('Unsupported scenario source');
 const file=new File([bytes],name,{type:mimeType});
 if(file.size<=0||file.size>=16384)throw Error('Synthetic scenario exceeds the 16 KiB bound');
 return file;
}
