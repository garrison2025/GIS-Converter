/**
 * P35 bounded PREVIEW of ACTUAL CONVERTED output, not source.
 * Directly reads output GeoJSON, KML, KMZ, GPX, CSV and SHP bytes. No second
 * GDAL call: a slow/failed optional preview must never delay a valid export.
 * These are schematic samples, not a substitute for independent GIS software.
 */
import JSZip from 'jszip';
import {makeOutputGeometryPreview} from './output-geometry-preview.mjs';
import {readUtf8ShapefileDbf,readComparableDbfValue} from './dbf-fidelity.mjs';

const MAX_INPUT=5*1024*1024,MAX_TEXT=850*1024,MAX_FEATURES=60;
const unavailable=reason=>({status:'unavailable',reason});
const collection=features=>({type:'FeatureCollection',features});
const decoder=new TextDecoder('utf-8',{fatal:true});
function utf8(bytes){if(bytes.byteLength>MAX_TEXT)throw Error('Output exceeds the 850 KiB preview text limit');return decoder.decode(bytes)}
function attrs(text){
 const out={};
 const pattern=/<(?:[\w.-]+:)?Data\b[^>]*\bname=["']([^"']{1,48})["'][^>]*>[\s\S]*?<(?:[\w.-]+:)?value\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?value\s*>/gi;
 for(const m of text.matchAll(pattern)){
  if(Object.keys(out).length>=6)break;
  out[m[1]]=m[2].replace(/<[^>]*>/g,'').slice(0,120);
 }
 return out;
}
function block(text,tag){
 const re=new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+tag+'\\s*>','gi');
 return [...text.matchAll(re)].map(m=>m[1]);
}
function coordinates(text){
 return text.trim().split(/\s+/).filter(Boolean).map(token=>{
  const parts=token.split(',');
  if(parts.length<2||parts[0]===''||parts[1]==='')throw Error('Incomplete KML coordinate tuple');
  return [Number(parts[0]),Number(parts[1])];
 });
}
function kmlGeometries(fragment){
 const features=[];
 function add(type,coords){if(coords?.length)features.push({type,coordinates:coords})}
 const polygons=block(fragment,'Polygon');
 if(polygons.length){
  const all=[];
  for(const poly of polygons){
   const rings=[];
   const outers=block(poly,'outerBoundaryIs'),inners=block(poly,'innerBoundaryIs');
   for(const ringBlock of [...outers,...inners]){
    const c=block(ringBlock,'coordinates');
    if(c.length!==1)throw Error('KML polygon ring is ambiguous');
    rings.push(coordinates(c[0]));
   }
   if(!outers.length)throw Error('KML polygon outer boundary missing');
   all.push(rings);
  }
  if(all.length)features.push({type:all.length>1?'MultiPolygon':'Polygon',
   coordinates:all.length>1?all:all[0]});
 }
 const lines=block(fragment,'LineString').map(x=>{
  const c=block(x,'coordinates');if(c.length!==1)throw Error('KML line coordinates ambiguous');
  return coordinates(c[0]);
 });
 if(lines.length)add(lines.length===1?'LineString':'MultiLineString',
  lines.length===1?lines[0]:lines);
 const trackBlocks=[...fragment.matchAll(/<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track\s*>/gi)];
 for(const m of trackBlocks){
  const points=[...m[1].matchAll(/<gx:coord\b[^>]*>([^<]*)<\/gx:coord\s*>/gi)].map(p=>{
   const values=p[1].trim().split(/\s+/);if(values.length<2)throw Error('Bad gx coordinate');
   return [Number(values[0]),Number(values[1])];
  });
  if(points.length>=2)add('LineString',points);
  else if(points.length===1)add('Point',points[0]);
 }
 const points=block(fragment,'Point').map(x=>{
  const c=block(x,'coordinates');if(c.length!==1)throw Error('KML point coordinates ambiguous');
  const values=coordinates(c[0]);if(values.length!==1)throw Error('Expected one KML Point coordinate');
  return values[0];
 });
 if(points.length)add(points.length===1?'Point':'MultiPoint',points.length===1?points[0]:points);
 return features;
}
function fromKml(text){
 if(text.length>MAX_TEXT||/<!DOCTYPE\b|<!ENTITY\b/i.test(text)||!/<(?:\w+:)?kml\b/i.test(text))
  throw Error('Unsupported or unsafe KML document for preview');
 const marks=block(text,'Placemark');
 const result=[];
 for(const mark of marks.slice(0,MAX_FEATURES)){
  const g=kmlGeometries(mark);
  const p={...attrs(mark)};
  const label=block(mark,'name')[0];
  if(label)p.Name=label.replace(/<[^>]*>/g,'').slice(0,120);
  for(const geom of g){result.push({type:'Feature',geometry:geom,properties:p});
   if(result.length>=MAX_FEATURES)break}
  if(result.length>=MAX_FEATURES)break;
 }
 if(!result.length)throw Error('KML has no supported point, line, polygon or gx:Track feature sample');
 return collection(result);
}
function gpPoint(openTag){
 const lat=openTag.match(/\blat\s*=\s*["']([^"']+)["']/i),
  lon=openTag.match(/\blon\s*=\s*["']([^"']+)["']/i);
 if(!lat||!lon)throw Error('GPX point missing geographic coordinates');
 return [Number(lon[1]),Number(lat[1])];
}
function fromGpx(text){
 if(text.length>MAX_TEXT||/<!DOCTYPE\b|<!ENTITY\b/i.test(text)||!/<(?:\w+:)?gpx\b/i.test(text))
  throw Error('Unsupported GPX document');
 const features=[];
 const make=(geometry,name='')=>features.push({type:'Feature',geometry,properties:name?{Name:name}:{}});
 const open=tag=>new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b([^>]*)>','gi');
 for(const m of text.matchAll(open('wpt'))){
  make({type:'Point',coordinates:gpPoint(m[1])});
  if(features.length>=MAX_FEATURES)return collection(features);
 }
 for(const route of block(text,'rte')){
  const pts=[...route.matchAll(open('rtept'))].map(m=>gpPoint(m[1]));
  if(pts.length>1)make({type:'LineString',coordinates:pts});
  else if(pts.length===1)make({type:'Point',coordinates:pts[0]});
  if(features.length>=MAX_FEATURES)return collection(features);
 }
 for(const track of block(text,'trk')){
  const segments=block(track,'trkseg');
  for(const seg of segments){
   const pts=[...seg.matchAll(open('trkpt'))].map(m=>gpPoint(m[1]));
   if(pts.length>1)make({type:'LineString',coordinates:pts});
   else if(pts.length===1)make({type:'Point',coordinates:pts[0]});
   if(features.length>=MAX_FEATURES)return collection(features);
  }
 }
 return collection(features);
}
function fromCsv(text){
 const records=[],row=[];let field='',quote=false,justClosed=false;
 const doneField=()=>{row.push(field);field='';justClosed=false};
 const doneRow=()=>{doneField();if(row.some(v=>v.trim()))records.push(row.splice(0));else row.length=0};
 for(let i=0;i<text.length&&records.length<=MAX_FEATURES;i++){
  const c=text[i];
  if(quote){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quote=false;justClosed=true}}else field+=c}
  else if(c==='"'&&field==='')quote=true;
  else if(c===','){doneField()}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;doneRow()}
  else if(justClosed){if(c!==' '&&c!=='\t')throw Error('Bad CSV quote closing')}
  else field+=c;
  if(field.length>65536)throw Error('CSV preview field too long');
 }
 if(quote)throw Error('Unclosed CSV quote');
 if(field||row.length)doneRow();
 const headings=records.shift()?.map(x=>x.trim().toLowerCase())||[];
 const lon=headings.findIndex(x=>['longitude','lon','x'].includes(x));
 const lat=headings.findIndex(x=>['latitude','lat','y'].includes(x));
 if(lon<0||lat<0)throw Error('Converted CSV has no WGS84 longitude/latitude columns');
 return collection(records.slice(0,MAX_FEATURES).map(r=>({
  type:'Feature',geometry:{type:'Point',coordinates:[Number(r[lon]),Number(r[lat])]},
  properties:Object.fromEntries(headings.slice(0,6).map((key,i)=>[key,r[i]||'']))
 })));
}
function signedArea(ring){
 let sum=0;
 for(let i=0;i<ring.length-1;i++)
  sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
 return sum/2;
}
function shpGeometry(record,type){
 const d=new DataView(record.buffer,record.byteOffset,record.byteLength);
 if([0].includes(type))return null;
 if([1,11,21].includes(type)){
  if(record.length<20)throw Error('SHP point record truncated');
  return {type:'Point',coordinates:[d.getFloat64(4,true),d.getFloat64(12,true)]};
 }
 if(![3,5,8,13,15,18,23,25,28].includes(type))return null;
 const multiPoint=[8,18,28].includes(type);
 const header=multiPoint?40:44;
 if(record.length<header)throw Error('SHP record header truncated');
 const parts=multiPoint?1:d.getInt32(36,true);
 const count=d.getInt32(multiPoint?36:40,true);
 if(!Number.isInteger(count)||count<1||count>3000||parts<1||parts>500)
  throw Error('Dense SHP geometry cannot be safely previewed');
 const start=multiPoint?40:44+parts*4;
 if(start+count*16>record.length)throw Error('SHP geometry exceeds record bytes');
 const pts=[];
 for(let i=0;i<count;i++)pts.push([d.getFloat64(start+i*16,true),d.getFloat64(start+i*16+8,true)]);
 if(multiPoint)return {type:'MultiPoint',coordinates:pts};
 const starts=[];
 for(let i=0;i<parts;i++)starts.push(d.getInt32(44+i*4,true));
 starts.push(count);
 if(starts[0]!==0||starts.some((x,i)=>i&&x<=starts[i-1]))
  throw Error('SHP part offsets are not monotonically ordered');
 const rings=[];
 for(let i=0;i<parts;i++)rings.push(pts.slice(starts[i],starts[i+1]));
 if([3,13,23].includes(type))
  return {type:rings.length===1?'LineString':'MultiLineString',
   coordinates:rings.length===1?rings[0]:rings};
 const polygons=[];let current=null;
 for(const ring of rings){
  if(ring.length<4)throw Error('Invalid SHP polygon ring');
  const a=signedArea(ring);
  if(a<0||!current){current=[ring];polygons.push(current)}
  else current.push(ring);
 }
 return {type:polygons.length===1?'Polygon':'MultiPolygon',
  coordinates:polygons.length===1?polygons[0]:polygons};
}
async function fromShpZip(bytes){
 const zip=await JSZip.loadAsync(bytes);
 const entries=Object.keys(zip.files).filter(x=>!zip.files[x].dir);
 const shpName=entries.find(n=>n.toLowerCase().endsWith('.shp'));
 const prjName=entries.find(n=>n.toLowerCase().endsWith('.prj'));
 if(!shpName||!prjName)throw Error('Shapefile ZIP missing geographic components');
 const prjFile=zip.file(prjName);
 if((prjFile._data?.uncompressedSize??Infinity)>32768)throw Error('SHP PRJ too large');
 const prj=await prjFile.async('string');
 if(/PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/i.test(prj)||
  !/WGS[\s_-]*(?:84|1984)|GCS_WGS_1984/i.test(prj))
  throw Error('Shapefile CRS is not confirmed WGS84');
 const shapeFile=zip.file(shpName);
 if((shapeFile._data?.uncompressedSize??Infinity)>MAX_INPUT)
  throw Error('SHP geometry exceeds preview limit');
 const raw=await shapeFile.async('uint8array');
 if(raw.length<100)throw Error('SHP header truncated');
 const d=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 if(d.getInt32(0,false)!==9994)throw Error('Invalid SHP format header');
 const features=[];let pos=100;
 while(pos+8<=raw.length&&features.length<MAX_FEATURES){
  const words=d.getInt32(pos+4,false),end=pos+8+words*2;
  if(words<2||end>raw.length)throw Error('Invalid SHP record length');
  const rec=raw.subarray(pos+8,end),type=new DataView(rec.buffer,rec.byteOffset,rec.byteLength).getInt32(0,true);
  const geom=shpGeometry(rec,type);
  if(geom)features.push({type:'Feature',geometry:geom,properties:{}});
  pos=end;
 }
 try{
  const dbf=await readUtf8ShapefileDbf(bytes);
  if(dbf.count>=features.length){
   features.forEach((f,i)=>{
    const props={};
    for(const field of dbf.fields.slice(0,6)){
     const val=readComparableDbfValue(dbf,i,field);
     if(val.kind==='text'||val.kind==='number')props[field.name]=val.value;
    }
    f.properties=props;
   });
  }
 }catch{} // A DBF preview failure never alters a valid Shapefile download.
 return collection(features);
}
export async function extractConvertedOutputPreview(_gdal,bytes,format){
 if(!(bytes instanceof Uint8Array)||!bytes.length)
  return unavailable('No converted GIS output bytes are available');
 if(bytes.length>MAX_INPUT)
  return unavailable('Converted output exceeds the 5 MiB bounded local preview limit.');
 try{
  let geojson;
  if(format==='geojson')geojson=JSON.parse(utf8(bytes));
  else if(format==='kml')geojson=fromKml(utf8(bytes));
  else if(format==='gpx')geojson=fromGpx(utf8(bytes));
  else if(format==='csv')geojson=fromCsv(utf8(bytes));
  else if(format==='shp')geojson=await fromShpZip(bytes);
  else if(format==='kmz'){
   const zip=await JSZip.loadAsync(bytes);
   const entry=zip.file('doc.kml');
   if(!entry||(entry._data?.uncompressedSize??Infinity)>MAX_TEXT)
    throw Error('KMZ KML output exceeds safe parsing bounds');
   geojson=fromKml(await entry.async('string'));
  }else return unavailable('No supported geometry reader for this output format.');
  const preview=makeOutputGeometryPreview(geojson,{source:'direct-readback-of-converted-'+format});
  if(preview.status==='ready'&&format!=='geojson'){
   preview.totalKnown=null;preview.truncated=true;
   preview.warnings.push('This is a bounded first-60-feature sample; other geometries or layers may not be shown.');
  }
  return preview;
 }catch(e){
  return unavailable('Could not safely preview converted '+format.toUpperCase()+
   ': '+String(e?.message||e).slice(0,145)+'. The download remains available.');
 }
}
