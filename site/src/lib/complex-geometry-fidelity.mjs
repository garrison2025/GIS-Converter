/**
 * P40 - independent bounded XY geometry readback from actual converted output.
 *
 * The check can detect vertex changes, lost line parts, polygon holes and
 * lost MultiPolygon shells even if overall geographic bounds do not change.
 * It never mutates the output, logs user coordinates, or calls an external API.
 *
 * Scope: WGS84 GeoJSON / simple KML / KMZ / 2D Shapefile; no geodesic metrics,
 * styling, attributes, M/Z equality, GeometryCollection, curves or CRS guessing.
 */
import JSZip from 'jszip';

const MAX_BYTES=8*1024*1024,MAX_FEATURES=500,MAX_VERTICES=20000;
const EPS=0.000005,ANGLE_ZERO=1e-14;
const invalid=reason=>{throw Error(reason)};
const unavailable=reason=>({status:'unavailable',detail:reason});
const allowed=new Set(['geojson','kml','kmz','shp']);
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
function num(value,axis){
 const v=String(value??'').trim();
 if(!decimal.test(v))invalid('Invalid '+axis+' value');
 const n=Number(v);
 if(!Number.isFinite(n))invalid('Non-finite geographic coordinate');
 return n;
}
function pos(x,y,state){
 const a=typeof x==='number'?x:num(x,'longitude');
 const b=typeof y==='number'?y:num(y,'latitude');
 if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>180||Math.abs(b)>90)
  invalid('Outside valid WGS84 longitude/latitude range');
 if(++state.vertices>MAX_VERTICES)invalid('Too many vertices');
 return [a,b];
}
function samePoint(a,b,epsilon=EPS){
 return Math.abs(a[0]-b[0])<=epsilon&&Math.abs(a[1]-b[1])<=epsilon;
}
function signedArea(r){
 let area=0;
 for(let i=0;i<r.length-1;i++)area+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];
 return area/2;
}
function line(raw,state){
 if(!Array.isArray(raw)||raw.length<2)invalid('Invalid line or segment');
 return raw.map(p=>{
  if(!Array.isArray(p)||p.length<2)invalid('Invalid XY point');
  return pos(p[0],p[1],state);
 });
}
function ring(raw,state){
 const points=line(raw,state);
 if(points.length<4||!samePoint(points[0],points.at(-1),0)||
  Math.abs(signedArea(points))<=ANGLE_ZERO)invalid('Invalid polygon ring');
 return points;
}
function polygon(raw,state){
 if(!Array.isArray(raw)||!raw.length)invalid('Polygon exterior missing');
 return raw.map(r=>ring(r,state));
}
function checkShape(type,raw,state){
 if(type==='LineString')return line(raw,state);
 if(type==='MultiLineString'){
  if(!Array.isArray(raw)||!raw.length)invalid('No MultiLineString components');
  return raw.map(p=>line(p,state));
 }
 if(type==='Polygon')return polygon(raw,state);
 if(type==='MultiPolygon'){
  if(!Array.isArray(raw)||!raw.length)invalid('No MultiPolygon components');
  return raw.map(p=>polygon(p,state));
 }
 invalid('Geometry type not covered by P40');
}
function geojson(text,state){
 const data=JSON.parse(text);
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))invalid('Not GeoJSON FeatureCollection');
 const crs=String(data.crs?.properties?.name||'').trim().toUpperCase();
 const names=new Set(['CRS84','OGC:CRS84','URN:OGC:DEF:CRS:OGC:1.3:CRS84','EPSG:4326',
  'URN:OGC:DEF:CRS:EPSG::4326','URN:OGC:DEF:CRS:EPSG:6.6:4326']);
 if(data.crs&&(!names.has(crs)||data.crs.type!=='name'))invalid('CRS not confirmed WGS84');
 return checkFeatures(data.features.map(f=>{
  const g=f?.geometry;
  if(!g||typeof g.type!=='string')invalid('Empty/unsupported GeoJSON geometry');
  return {type:g.type,coordinates:checkShape(g.type,g.coordinates,state)};
 }));
}
function checkFeatures(features){
 if(!Array.isArray(features)||!features.length||features.length>MAX_FEATURES)
  invalid('Feature count outside P40 inspection bounds');
 return features;
}
function blocks(xml,tag){
 const r=new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+tag+'\\s*>','gi');
 return [...xml.matchAll(r)].map(m=>m[1]);
}
function kmlTuple(raw,state){
 const tuple=raw.split(',');
 if(tuple.length<2||tuple.length>3)invalid('Invalid KML XY tuple');
 if(tuple.length===3)num(tuple[2],'altitude');
 return pos(tuple[0],tuple[1],state);
}
function coordinates(xml,state){
 const elements=blocks(xml,'coordinates');
 if(elements.length!==1)invalid('KML coordinate element not unambiguous');
 const entries=elements[0].trim().split(/\s+/).filter(Boolean);
 if(!entries.length)invalid('KML coordinates missing');
 return entries.map(value=>kmlTuple(value,state));
}
function kmlPolygon(body,state){
 const outers=blocks(body,'outerBoundaryIs'),inners=blocks(body,'innerBoundaryIs');
 if(outers.length!==1)invalid('KML exterior ring missing/ambiguous');
 return [ring(coordinates(outers[0],state),{vertices:state.vertices,max:state.max})];
}
// Use a single vertex counter for parsing, do not count the same KML ring twice.
function parseKmlPolygon(body,state){
 const outers=blocks(body,'outerBoundaryIs'),inners=blocks(body,'innerBoundaryIs');
 if(outers.length!==1)invalid('KML outerBoundaryIs not unique');
 const parseRing=part=>{
  const coords=blocks(part,'coordinates');
  if(coords.length!==1)invalid('KML ring coordinates ambiguous');
  const entries=coords[0].trim().split(/\s+/).filter(Boolean);
  return ring(entries.map(value=>kmlTuple(value,state)),{vertices:0});
 };
 // positions already validated & counted by kmlTuple; ring() used only to
 // verify closure and area via separate dedicated check.
 const parsed=[outers[0],...inners].map(part=>{
  const elems=blocks(part,'coordinates');
  if(elems.length!==1)invalid('KML ring has ambiguous coordinate elements');
  const points=elems[0].trim().split(/\s+/).filter(Boolean).map(x=>kmlTuple(x,state));
  if(points.length<4||!samePoint(points[0],points.at(-1),0)||
    Math.abs(signedArea(points))<=ANGLE_ZERO)invalid('KML ring open or degenerate');
  return points;
 });
 return parsed;
}
function kml(text,state){
 if(/<!DOCTYPE\b|<!ENTITY\b|<!\[CDATA\[/i.test(text))invalid('Unsafe/unsupported XML constructs');
 if(!/<(?:[\w.-]+:)?kml\b/i.test(text))invalid('Not KML');
 const placemarks=blocks(text,'Placemark');
 return checkFeatures(placemarks.map(mark=>{
  if(/<(?:[\w.-]+:)?(?:Point|Model|LinearRing|gx:Track)\b/i.test(mark)&&
     !/<(?:[\w.-]+:)?Polygon\b/i.test(mark))
   invalid('Mixed/unsupported KML geometry');
  const polygonBodies=blocks(mark,'Polygon');
  const lineBodies=blocks(mark,'LineString');
  if(polygonBodies.length&&lineBodies.length)invalid('Mixed KML line/polygon geometry');
  if(polygonBodies.length){
   const parts=polygonBodies.map(body=>parseKmlPolygon(body,state));
   return {type:parts.length===1?'Polygon':'MultiPolygon',
    coordinates:parts.length===1?parts[0]:parts};
  }
  if(lineBodies.length){
   const parts=lineBodies.map(body=>{
    const coords=coordinates(body,state);
    if(coords.length<2)invalid('KML line has too few vertices');
    return coords;
   });
   return {type:parts.length===1?'LineString':'MultiLineString',
    coordinates:parts.length===1?parts[0]:parts};
  }
  invalid('KML Placemark has no supported line/polygon geometry');
 }));
}
async function shapefile(bytes,state){
 const zip=await JSZip.loadAsync(bytes);
 const files=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
 const shpNames=files.filter(n=>n.toLowerCase().endsWith('.shp'));
 if(shpNames.length!==1)invalid('Expected exactly one SHP layer');
 const name=shpNames[0],stem=name.slice(0,-4).toLowerCase();
 const match=ext=>files.filter(n=>n.toLowerCase()===stem+'.'+ext);
 const prj=match('prj'),shx=match('shx');
 if(prj.length!==1||shx.length!==1)invalid('Matching SHP projection/index sidecars unavailable');
 const pFile=zip.file(prj[0]),xFile=zip.file(shx[0]),sFile=zip.file(name);
 if([pFile,xFile,sFile].some(f=>(f?._data?.uncompressedSize??Infinity)>MAX_BYTES))
  invalid('SHP sidecar exceeds bound');
 const projection=await pFile.async('string');
 if(/PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/i.test(projection)||
  !/WGS[\s_-]*(?:84|1984)|GCS_WGS_1984/i.test(projection))invalid('SHP is not confirmed WGS84');
 const [raw,index]=await Promise.all([sFile.async('uint8array'),xFile.async('uint8array')]);
 if(raw.length<100||index.length<100||index.length%2!==0)invalid('Invalid SHP/SHX header');
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 const iv=new DataView(index.buffer,index.byteOffset,index.byteLength);
 if(view.getInt32(0,false)!==9994||iv.getInt32(0,false)!==9994||
  view.getInt32(28,true)!==1000||view.getInt32(24,false)*2!==raw.length||
  iv.getInt32(24,false)*2!==index.length||((index.length-100)%8)!==0)
  invalid('SHP/SHX structural mismatch');
 const family=view.getInt32(32,true);
 if(family!==3&&family!==5)invalid('P40 verifies 2D SHP PolyLine or Polygon only');
 const records=[];let offset=100,n=0;
 while(offset+8<=raw.length){
  if(++n>MAX_FEATURES)invalid('SHP record count exceeds bound');
  const words=view.getInt32(offset+4,false),end=offset+8+words*2;
  if(words<2||end>raw.length||offset+12>end)invalid('Malformed SHP record length');
  if(index.length<100+n*8||
   iv.getInt32(100+(n-1)*8,false)*2!==offset||
   iv.getInt32(104+(n-1)*8,false)!==words)
   invalid('SHP/SHX index mismatch');
  const type=view.getInt32(offset+8,true);
  if(type!==family||end-offset<52)invalid('Unexpected SHP geometry/null record');
  const parts=view.getInt32(offset+44,true),points=view.getInt32(offset+48,true);
  if(parts<1||parts>500||points<2||state.vertices+points>MAX_VERTICES||
   offset+52+parts*4+points*16>end)invalid('Malformed SHP part/point lengths');
  const starts=[];
  for(let i=0;i<parts;i++)starts.push(view.getInt32(offset+52+i*4,true));
  starts.push(points);
  if(starts[0]!==0||starts.some((x,i)=>i&&x<=starts[i-1]))invalid('SHP part indexes unordered');
  const xy=[];
  const base=offset+52+parts*4;
  for(let j=0;j<points;j++)xy.push(pos(view.getFloat64(base+j*16,true),
   view.getFloat64(base+j*16+8,true),state));
  const components=[];
  for(let i=0;i<parts;i++)components.push(xy.slice(starts[i],starts[i+1]));
  if(family===3){
   if(components.some(c=>c.length<2))invalid('SHP line segment too short');
   records.push({type:components.length===1?'LineString':'MultiLineString',
    coordinates:components.length===1?components[0]:components});
  }else{
   const polygons=[];let current=null;
   for(const component of components){
    if(component.length<4||!samePoint(component[0],component.at(-1),0))
     invalid('Unclosed SHP ring');
    const area=signedArea(component);
    if(Math.abs(area)<=ANGLE_ZERO)invalid('Degenerate SHP polygon');
    if(area<0){current=[component];polygons.push(current)}
    else{if(!current)invalid('SHP hole without an outer ring');current.push(component)}
   }
   records.push({type:polygons.length===1?'Polygon':'MultiPolygon',
    coordinates:polygons.length===1?polygons[0]:polygons});
  }
  offset=end;
 }
 if(offset!==raw.length||(index.length-100)/8!==n)invalid('SHP record/SHX count mismatch');
 return checkFeatures(records);
}
function normBBox(feature){
 const box=[Infinity,Infinity,-Infinity,-Infinity];
 const visit=coordinates=>{
  if(typeof coordinates[0]==='number'){
   box[0]=Math.min(box[0],coordinates[0]);box[1]=Math.min(box[1],coordinates[1]);
   box[2]=Math.max(box[2],coordinates[0]);box[3]=Math.max(box[3],coordinates[1]);
  }else coordinates.forEach(visit);
 };
 visit(feature.coordinates);
 return box;
}
function ringSame(a,b){
 const x=a.slice(0,-1),y=b.slice(0,-1);
 if(x.length!==y.length)return false;
 for(let start=0;start<y.length;start++){
  if(!samePoint(x[0],y[start]))continue;
  for(const dir of [1,-1]){
   let ok=true;
   for(let i=1;i<x.length;i++)
    if(!samePoint(x[i],y[(start+dir*i+y.length*2)%y.length])){ok=false;break}
   if(ok)return true;
  }
 }
 return false;
}
function lineSame(a,b){
 if(a.length!==b.length)return false;
 return a.every((p,i)=>samePoint(p,b[i]))||
  a.every((p,i)=>samePoint(p,b[b.length-1-i]));
}
function uniquelyMatch(a,b,fn){
 if(a.length!==b.length)return {kind:'mismatch'};
 const used=new Set();
 for(const item of a){
  const matches=b.map((x,i)=>!used.has(i)&&fn(item,x)?i:-1).filter(x=>x>=0);
  if(matches.length!==1)return {kind:matches.length?'ambiguous':'mismatch'};
  used.add(matches[0]);
 }
 return {kind:'match'};
}
function partSame(a,b){
 if(a.length!==b.length)return false;
 if(!ringSame(a[0],b[0]))return false;
 return uniquelyMatch(a.slice(1),b.slice(1),ringSame).kind==='match';
}
function geometrySame(a,b){
 if(a.type!==b.type)return false;
 if(a.type==='LineString')return lineSame(a.coordinates,b.coordinates);
 if(a.type==='MultiLineString')
  return uniquelyMatch(a.coordinates,b.coordinates,lineSame).kind==='match';
 if(a.type==='Polygon')return partSame(a.coordinates,b.coordinates);
 if(a.type==='MultiPolygon')
  return uniquelyMatch(a.coordinates,b.coordinates,partSame).kind==='match';
 return false;
}
function structure(feature){
 const c=feature.coordinates;
 if(feature.type==='LineString')return 'line:1:'+c.length;
 if(feature.type==='MultiLineString')return 'lines:'+c.map(p=>p.length).sort((a,b)=>a-b).join(',');
 const poly=f=>f.map(r=>r.length).sort((a,b)=>a-b).join(',');
 if(feature.type==='Polygon')return 'polygon:1:'+poly(c);
 if(feature.type==='MultiPolygon')return 'polygons:'+c.map(poly).sort().join('|');
 return 'unknown';
}
function approxBbox(a,b){
 return a.every((n,i)=>Math.abs(n-b[i])<=EPS*4);
}
function compare(before,after){
 const summary=before.length+' source and '+after.length+' output complex features; '+
  before.map(f=>f.type).sort().join('/')+' geometry families.';
 if(before.length!==after.length)
  return {status:'review',detail:'Complex geometry feature count differs: '+
   before.length+' source / '+after.length+' output. Individual coordinates are omitted.'};
 // For non-simple coordinate matching we need a unique per-feature pairing.
 // A shape changing geometry family or parts (holes) may still be definite
 // when only one possible corresponding source/output feature exists.
 const paired=[],unused=new Set(after.map((_,i)=>i));
 for(const input of before){
  const inBox=normBBox(input);
  const compatible=after.flatMap((out,i)=>unused.has(i)&&out.type===input.type?[i]:[]);
  if(compatible.length===0)
   return unavailable('Geometry family changed or re-grouped; cannot safely infer complex feature correspondence.');
  const within=compatible.filter(i=>approxBbox(inBox,normBBox(after[i])));
  const candidates=within.length?within:compatible;
  if(candidates.length!==1)
   return unavailable('Multiple overlapping/ambiguous complex GIS features cannot be uniquely paired; inspect with desktop GIS.');
  const index=candidates[0];unused.delete(index);paired.push([input,after[index]]);
 }
 const failures=paired.reduce((n,[a,b])=>n+(!geometrySame(a,b)?1:0),0);
 return {status:failures?'review':'pass',
  detail:(failures?'Complex geometry changed: ':'Independent complex geometry XY, ordered line vertices, polygon ring/holes and components agree: ')+
   summary+' '+failures+' mismatched complex features. This is a bounded 2D check, not topology certification.'};
}
async function read(bytes,format){
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)invalid('GIS data outside 8 MiB P40 bound');
 const state={vertices:0};
 if(format==='shp')return shapefile(bytes,state);
 if(format==='kmz'){
  const archive=await JSZip.loadAsync(bytes);
  const entry=archive.file('doc.kml');
  if(!entry||(entry._data?.uncompressedSize??Infinity)>MAX_BYTES)
   invalid('KMZ doc.kml missing or over inspection bound');
  const data=await entry.async('uint8array');
  if(data.length>MAX_BYTES)invalid('KMZ inflated document too large');
  return kml(new TextDecoder('utf-8',{fatal:true}).decode(data),state);
 }
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(format==='geojson')return geojson(text,state);
 if(format==='kml')return kml(text,state);
 invalid('Unsupported P40 format');
}
export async function inspectComplexGeometryFidelity(sourceBytes,sourceFormat,outputBytes,targetFormat){
 if(!allowed.has(sourceFormat)||!allowed.has(targetFormat)||sourceFormat===targetFormat)
  return unavailable('Independent P40 geometry comparison requires a supported cross-format line/polygon pair.');
 try{
  const [source,target]=await Promise.all([read(sourceBytes,sourceFormat),read(outputBytes,targetFormat)]);
  return compare(source,target);
 }catch{
  // Parsing exceptions may contain user data. Never include such text in
  // downloaded reports; skip unsupported shapes instead of false-blocking.
  return unavailable('Complex GIS geometry is not independently comparable within bounded WGS84 2D, XML, ZIP, CRS or topology rules. No loss or correctness is certified.');
 }
}
