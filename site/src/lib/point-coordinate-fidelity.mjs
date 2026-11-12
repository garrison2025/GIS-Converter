/**
 * P39: independently compare all supported WGS84 point XY values in actual
 * input and converted output. Equal counts and bounding boxes are insufficient
 * to detect a relocated middle point.
 *
 * This is a BOUNDED, conservative invariant; it is not a general XML parser,
 * a GIS topology check or an attribute/CRS guarantee. On unsafe ambiguity,
 * return unavailable (never an invented pass). Report counts only, no XY.
 */
import JSZip from 'jszip';

const MAX_FILE=15*1024*1024,MAX_TEXT=10*1024*1024,MAX_POINTS=20000;
const TOL=0.000005; // up to ~0.56 m latitude; GIS-grade verification is external
const numberPattern=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
const allowed=new Set(['geojson','kml','kmz','csv','gpx']);
const unavailable=detail=>({status:'unavailable',detail});
const error=message=>{throw new Error(message)};
const decode=bytes=>{
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_FILE)error('File outside 15 MiB point comparison bound');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(text.length>MAX_TEXT)error('Text outside 10 Mi-character point comparison bound');
 return text;
};
const numeric=(s,axis)=>{
 const str=String(s??'').trim();
 if(!numberPattern.test(str))error('Missing or invalid '+axis+' coordinate');
 const value=Number(str);
 if(!Number.isFinite(value))error('Non-finite '+axis+' coordinate');
 return value;
};
function point(x,y){
 const lon=typeof x==='number'?x:numeric(x,'longitude');
 const lat=typeof y==='number'?y:numeric(y,'latitude');
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)
  error('Coordinates exceed WGS84 longitude/latitude range');
 return [lon,lat];
}
function verifyLength(items){
 if(!items.length||items.length>MAX_POINTS)
  error('No points or point count exceeds bounded comparison');
 return items;
}
function geojsonPoints(text){
 const data=JSON.parse(text);
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))
  error('Point comparison needs a GeoJSON FeatureCollection');
 const name=String(data.crs?.properties?.name||'').trim().toUpperCase();
 if(data.crs&&!new Set(['CRS84','OGC:CRS84','URN:OGC:DEF:CRS:OGC:1.3:CRS84','EPSG:4326',
 'URN:OGC:DEF:CRS:EPSG::4326','URN:OGC:DEF:CRS:EPSG:6.6:4326']).has(name))
  error('GeoJSON CRS not unambiguously WGS84');
 return verifyLength(data.features.map(feature=>{
  if(feature?.geometry?.type!=='Point'||!Array.isArray(feature.geometry.coordinates)||
   feature.geometry.coordinates.length<2)error('GeoJSON contains non-Point features');
  const p=feature.geometry.coordinates;
  return point(p[0],p[1]);
 }));
}
function xmlSafety(text){
 if(/<!DOCTYPE\b|<!ENTITY\b/i.test(text))error('XML entity declarations are unsupported');
}
function kmlPoints(text){
 xmlSafety(text);
 if(!/<(?:[\w.-]+:)?kml\b/i.test(text))error('Missing KML root');
 const placemarks=[...text.matchAll(/<(?:[\w.-]+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Placemark\s*>/gi)];
 return verifyLength(placemarks.map(m=>{
  const body=m[1];
  if(/<(?:[\w.-]+:)?(?:LineString|Polygon|MultiGeometry|gx:Track|Model)\b/i.test(body))
   error('KML has complex or mixed geometry');
  const shapes=[...body.matchAll(/<(?:[\w.-]+:)?Point\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Point\s*>/gi)];
  if(shapes.length!==1)error('KML Placemark does not contain exactly one Point');
  const coords=[...shapes[0][1].matchAll(/<(?:[\w.-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?coordinates\s*>/gi)];
  if(coords.length!==1)error('Ambiguous KML point coordinate field');
  const tokens=coords[0][1].trim().split(/\s+/);
  if(tokens.length!==1)error('KML point has multiple positions');
  const xyz=tokens[0].split(',');
  if(xyz.length<2||xyz.length>3)error('KML point tuple length');
  if(xyz.length===3)numeric(xyz[2],'altitude');
  return point(xyz[0],xyz[1]);
 }));
}
function csvRecords(text){
 const rows=[],row=[];let field='',quoted=false,closed=false;
 const finishField=()=>{row.push(field);field='';closed=false};
 const finishRow=()=>{finishField();if(row.some(c=>c.trim()))rows.push(row.splice(0));else row.length=0;
  if(rows.length>MAX_POINTS+1)error('CSV point count exceeds inspection bound');
 };
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){
   if(char==='"'){if(text[i+1]==='"'){field+='"';i++}else {quoted=false;closed=true}}
   else field+=char;
  }else if(closed){
   if(char===',')finishField();
   else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;finishRow()}
   else if(char!==' '&&char!=='\t')error('Malformed CSV escaped quote closing');
  }else if(char==='"'&&field==='')quoted=true;
  else if(char===',')finishField();
  else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;finishRow()}
  else if(char==='"')error('CSV quote inside unquoted field');
  else field+=char;
  if(field.length>65536)error('Oversized CSV point field');
 }
 if(quoted)error('Unclosed CSV quote');
 if(field||row.length)finishRow();
 return rows;
}
function csvPoints(text){
 const rows=csvRecords(text.replace(/^\uFEFF/,''));
 const headings=rows.shift()?.map(x=>x.trim().toLowerCase())||[];
 const lonCols=headings.flatMap((s,i)=>['longitude','lon','x'].includes(s)?[i]:[]);
 const latCols=headings.flatMap((s,i)=>['latitude','lat','y'].includes(s)?[i]:[]);
 if(lonCols.length!==1||latCols.length!==1||lonCols[0]===latCols[0])
  error('Unambiguous longitude and latitude CSV columns required');
 return verifyLength(rows.map(row=>point(row[lonCols[0]],row[latCols[0]])));
}
function gpxPoints(text){
 xmlSafety(text);
 if(!/<(?:[\w.-]+:)?gpx\b/i.test(text))error('Missing GPX root');
 if(/<(?:[\w.-]+:)?(?:rte|trk)\b/i.test(text))
  error('GPX route/track requires separate line geometry inspection');
 const tags=[...text.matchAll(/<(?:[\w.-]+:)?wpt\b([^>]*)>/gi)];
 return verifyLength(tags.map(m=>{
  const lat=m[1].match(/(?:^|\s)lat\s*=\s*["']([^"']*)["']/i)?.[1];
  const lon=m[1].match(/(?:^|\s)lon\s*=\s*["']([^"']*)["']/i)?.[1];
  return point(lon,lat);
 }));
}
async function readPoints(bytes,format){
 if(format==='kmz'){
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_FILE)error('KMZ exceeds inspection bound');
  const archive=await JSZip.loadAsync(bytes);
  const entry=archive.file('doc.kml');
  if(!entry||(entry._data?.uncompressedSize??Infinity)>MAX_TEXT)
   error('KMZ doc.kml missing or too large');
  const raw=await entry.async('uint8array');
  if(raw.length>MAX_TEXT)error('KMZ decompressed entry too large');
  return kmlPoints(decode(raw));
 }
 const data=decode(bytes);
 if(format==='geojson')return geojsonPoints(data);
 if(format==='kml')return kmlPoints(data);
 if(format==='csv')return csvPoints(data);
 if(format==='gpx')return gpxPoints(data);
 error('Format not supported for independent point comparison');
}
const sorted=arr=>[...arr].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
const near=(a,b)=>Math.abs(a[0]-b[0])<=TOL&&Math.abs(a[1]-b[1])<=TOL;
function ambiguous(points){
 // A pair of very close points could reorder after serialization and yield
 // a false mismatch in a lexicographic comparison. Fail closed instead.
 for(let i=1;i<points.length;i++){
  if(Math.abs(points[i][0]-points[i-1][0])<=TOL*4)
   return true;
 }
 return points.some(p=>Math.abs(Math.abs(p[0])-180)<=TOL*4);
}
export async function inspectPointCoordinateFidelity(sourceBytes,sourceFormat,outputBytes,targetFormat){
 if(!allowed.has(sourceFormat)||!allowed.has(targetFormat)||sourceFormat===targetFormat)
  return unavailable('Independent point-coordinate matching is limited to supported cross-format WGS84 point conversions.');
 try{
  const [before,after]=await Promise.all([readPoints(sourceBytes,sourceFormat),readPoints(outputBytes,targetFormat)]);
  const counts=before.length+' source points / '+after.length+' output points.';
  if(before.length!==after.length)
   return {status:'review',detail:'Independent point coordinate count mismatch: '+counts+' No private coordinates disclosed.'};
  const x=sorted(before),y=sorted(after);
  if(ambiguous(x)||ambiguous(y))return unavailable('Point comparison skipped: longitude ordering is too dense or near the ±180° boundary for safe independent matching. '+counts);
  const failures=x.reduce((n,p,i)=>n+(!near(p,y[i])?1:0),0);
  return {status:failures?'review':'pass',
   detail:(failures?'Point coordinate changes detected despite matching counts/bounds: ':
    'Independent WGS84 point coordinates match within 0.000005°: ')+
    counts+' '+failures+' coordinate mismatches. Original coordinate values are never added to this report.'};
 }catch(e){
  return unavailable('Independent point-coordinate verification unavailable: '+
   String(e?.message||e).slice(0,160)+'. This is not a pass or a confirmed loss.');
 }
}
