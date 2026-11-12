/**
 * P35: bounded, privacy-preserving vector sample for an SVG output preview.
 *
 * IMPORTANT: the preview is diagnostic visualization, NOT proof of GIS
 * topology, exact scale, CRS, DBF attribute preservation or full coverage.
 * Only the first 60 features and at most 3,000 XY vertices are displayed.
 */
import {makeAntimeridianDisplayFrame} from './antimeridian-preview.mjs';
export const PREVIEW_MAX_FEATURES=60;
export const PREVIEW_MAX_VERTICES=3000;
const MAX_PROPERTIES=6,MAX_VALUE=120;
const allowed=new Set(['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon']);
const unavailable=(reason='This output cannot be safely previewed.')=>({
 status:'unavailable',reason
});
function xy(point,stats){
 if(!Array.isArray(point)||point.length<2||
  !Number.isFinite(point[0])||!Number.isFinite(point[1])||
  Math.abs(point[0])>180||Math.abs(point[1])>90)
  throw Error('Output has coordinates outside the WGS84 longitude/latitude range');
 if(++stats.vertices>PREVIEW_MAX_VERTICES)
  throw Error('Too many vertices to display safely; download and inspect in GIS software');
 const lon=point[0],lat=point[1];
 stats.bbox[0]=Math.min(stats.bbox[0],lon);
 stats.bbox[1]=Math.min(stats.bbox[1],lat);
 stats.bbox[2]=Math.max(stats.bbox[2],lon);
 stats.bbox[3]=Math.max(stats.bbox[3],lat);
 return [lon,lat];
}
function geometry(input,stats){
 if(!input||!allowed.has(input.type))return null;
 const a=input.coordinates;
 if(!Array.isArray(a))throw Error('Preview geometry coordinates are not an array');
 switch(input.type){
  case 'Point':return {type:input.type,coordinates:xy(a,stats)};
  case 'MultiPoint':
  case 'LineString':
   return {type:input.type,coordinates:a.map(p=>xy(p,stats))};
  case 'MultiLineString':
  case 'Polygon':
   return {type:input.type,coordinates:a.map(line=>line.map(p=>xy(p,stats)))};
  case 'MultiPolygon':
   return {type:input.type,coordinates:a.map(poly=>poly.map(line=>line.map(p=>xy(p,stats))))};
 }
 return null;
}
function previewProperties(raw){
 const out={};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
 for(const [key,value] of Object.entries(raw)){
  if(Object.keys(out).length>=MAX_PROPERTIES)break;
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')continue;
  if(typeof value==='number'&&!Number.isFinite(value))continue;
  const k=key.slice(0,48);
  if(!k||k==='__proto__'||k==='constructor'||k==='prototype')continue;
  Object.defineProperty(out,k,{value:String(value).slice(0,MAX_VALUE),
    enumerable:true,configurable:true,writable:true});
 }
 return out;
}
export function makeOutputGeometryPreview(raw,{source='converted-output'}={}){
 try{
  const collection=typeof raw==='string'?JSON.parse(raw):raw;
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))
   return unavailable('Output is not a readable GeoJSON FeatureCollection.');
  const crs=collection.crs?.properties?.name;
  // Match the same explicitly known WGS84/CRS84 declarations accepted by
  // the independent quality inspector. GDAL writes the OGC 1.3 URN in some
  // GeoJSON outputs; this is not an unsupported projected CRS.
  const knownWgs84=new Set(['CRS84','OGC:CRS84',
   'URN:OGC:DEF:CRS:OGC:1.3:CRS84','EPSG:4326',
   'URN:OGC:DEF:CRS:EPSG::4326','URN:OGC:DEF:CRS:EPSG:6.6:4326']);
  if(crs&&!knownWgs84.has(String(crs).trim().toUpperCase()))
   return unavailable('Output CRS is not confirmed WGS84; a geographic preview would be misleading.');
  const stats={vertices:0,bbox:[Infinity,Infinity,-Infinity,-Infinity]};
  const features=[],kinds={point:0,line:0,polygon:0},sample=collection.features.slice(0,PREVIEW_MAX_FEATURES);
  for(const [index,feature] of sample.entries()){
   const g=geometry(feature?.geometry,stats);
   if(!g)continue;
   const kind=g.type.includes('Point')?'point':g.type.includes('Line')?'line':'polygon';
   kinds[kind]++;
   features.push({index:index+1,type:g.type,coordinates:g.coordinates,
    properties:previewProperties(feature.properties)});
  }
  if(!features.length)return unavailable('No supported point, line or polygon geometry was available to preview.');
  if(!stats.bbox.every(Number.isFinite))return unavailable('No finite WGS84 coordinates available.');
  // Keep original WGS84 coordinates/bbox for download context and attributes.
  // Only the SVG view receives a shifted drawing frame when safely possible.
  const frame=makeAntimeridianDisplayFrame(features,stats.bbox);
  if(frame.status==='unavailable')return unavailable(frame.reason);
  if(frame.status==='wrapped')features.forEach((feature,i)=>{
   feature.displayCoordinates=frame.displayCoordinates[i];
  });
  return {
   status:'ready',kind:'gis-local-schematic-output-sample',source,
   ...(frame.status==='wrapped'?{antimeridianView:true,displayBbox:frame.displayBbox}:{}),
   displayed:features.length,totalKnown:collection.features.length,
   truncated:collection.features.length>PREVIEW_MAX_FEATURES,
   sampleLimit:PREVIEW_MAX_FEATURES,vertexCount:stats.vertices,
   geometryCounts:kinds,bbox:stats.bbox,
   warnings:[
    'Schematic vector preview only: no basemap, geodetic scale or professional GIS validation.',
    ...(frame.status==='wrapped'?frame.warnings:[]),
    ...(collection.features.length>PREVIEW_MAX_FEATURES?['Only the first 60 features are displayed. The downloaded output may contain more.']:[])
   ],features
  };
 }catch(e){
  return unavailable('Preview skipped: '+String(e?.message||e).slice(0,180)+
   '. Conversion output and quality report remain downloadable.');
 }
}
