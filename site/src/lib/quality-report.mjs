import JSZip from 'jszip';
import {inspectShpToGeojsonDbfFidelity} from './shp-geojson-fidelity.mjs';
import {inspectCrossFormatAttributeFidelity} from './cross-format-attribute-fidelity.mjs';
import {inspectGeojsonToShpDbfFidelity} from './dbf-fidelity.mjs';
import {inspectGpxLineFidelity} from './gpx-fidelity.mjs';
import {inspectGpxTimedKml} from './gpx-timed-track.mjs';
import {inspectPointCoordinateFidelity} from './point-coordinate-fidelity.mjs';
import {inspectComplexGeometryFidelity} from './complex-geometry-fidelity.mjs';
import {inspectComplexFeatureAttributeFidelity} from './complex-feature-attribute-fidelity.mjs';
import {inspectShpXYBounds} from './shp-xy-bounds.mjs';

const ZIP_LIMIT=36*1024*1024;
const eq=(a,b,tol=0.00015)=>Math.abs(a-b)<=tol;
const blank=(format,reason='')=>({format,features:null,geometry:[],bbox:null,crs:'unknown',pointOnly:false,complete:false,issues:reason?[reason]:[]});
const fail=message=>{throw Error(message)};
function geometryKind(s){return ({Point:'point',MultiPoint:'point',LineString:'line',MultiLineString:'line',Polygon:'polygon',MultiPolygon:'polygon'})[s]||'unknown'}
function addPoint(box,p){
 if(!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||
    Math.abs(p[0])>180||Math.abs(p[1])>90)return false;
 box[0]=Math.min(box[0],p[0]);box[1]=Math.min(box[1],p[1]);
 box[2]=Math.max(box[2],p[0]);box[3]=Math.max(box[3],p[1]);return true;
}
function endBox(box){return box.every(Number.isFinite)?box.map(n=>Math.round(n*1e7)/1e7):null}
const strictDecimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
function pointFromText(lon,lat){
 const x=String(lon??'').trim(),y=String(lat??'').trim();
 if(!strictDecimal.test(x)||!strictDecimal.test(y))return null;
 const a=Number(x),b=Number(y);
 return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=180&&Math.abs(b)<=90?[a,b]:null;
}
function walkCoords(data,box){
 if(!Array.isArray(data))return false;
 if(data.length>=2&&typeof data[0]==='number')return addPoint(box,data);
 let result=true;
 for(const child of data)result=walkCoords(child,box)&&result;
 return result;
}
/**
 * A source-attribute risk estimate, not an attribute equality check.
 * Only aggregate counts go into the downloadable report; field names and values do not.
 */
function scanGeojsonFieldRisk(features){
 const names=new Set(), limit=512;
 let nestedValues=0, nullValues=0, emptyStrings=0, booleans=0, oversizedStrings=0, highPrecisionNumbers=0, unsafeIntegers=0, overflow=false;
 for(const f of features){
  const props=f?.properties;
  if(!props || typeof props!=='object' || Array.isArray(props))continue;
  for(const [name,value] of Object.entries(props)){
   if(names.size<limit)names.add(name);
   else if(!names.has(name))overflow=true;
   if(value!==null && typeof value==='object')nestedValues++;
   if(value===null)nullValues++;
   if(value==='')emptyStrings++;
   if(typeof value==='boolean')booleans++;
   if(typeof value==='string' && new TextEncoder().encode(value).length>254)oversizedStrings++;
   if(typeof value==='number'){
     if(Number.isInteger(value)&&!Number.isSafeInteger(value))unsafeIntegers++;
     else if(Number.isFinite(value)&&Number(value.toPrecision(15))!==value)highPrecisionNumbers++;
   }
  }
 }
 const encoder=new TextEncoder();
 const prefixes=new Set(),lowerNames=new Set();
 let longNames=0,collisions=0,caseInsensitiveCollisions=0;
 for(const name of names){
  const bytes=encoder.encode(name);
  if(bytes.length>10)longNames++;
  const prefix=Array.from(bytes.slice(0,10)).join(',');
  if(prefixes.has(prefix))collisions++;else prefixes.add(prefix);
  const lower=name.toLowerCase();
  if(lowerNames.has(lower))caseInsensitiveCollisions++;else lowerNames.add(lower);
 }
 return {fieldNamesInspected:names.size,longNames,firstTenByteCollisions:collisions,
   caseInsensitiveCollisions,nonScalarValues:nestedValues,nullValues,emptyStrings,booleans,
   oversizedStrings,highPrecisionNumbers,unsafeIntegers,schemaScanLimited:overflow};
}

/**
 * P58 source guarantee is intentionally narrower than generic GeoJSON
 * inspection. Empty/degenerate arrays may legitimately export Null Shape.
 * We only block observed Null Shapes when every source feature has a complete,
 * independently inspectable, non-empty 2D geometry. No coordinates leak into
 * diagnostic output.
 */
function knownNonEmptyGeojsonGeometry(geometry){
 if(!geometry||typeof geometry!=='object')return false;
 const xy=p=>Array.isArray(p)&&p.length>=2&&
  typeof p[0]==='number'&&typeof p[1]==='number'&&
  Number.isFinite(p[0])&&Number.isFinite(p[1]);
 const line=l=>Array.isArray(l)&&l.length>=2&&l.every(xy);
 const ring=r=>{
  if(!Array.isArray(r)||r.length<4||!r.every(xy))return false;
  const first=r[0],last=r.at(-1);
  if(first[0]!==last[0]||first[1]!==last[1])return false;
  // A zero-area ring may vanish when written to Shapefile. Treat it as
  // structurally ambiguous instead of falsely certifying geometry loss.
  let twice=0;
  for(let i=0;i<r.length-1;i++)
   twice+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];
  return Number.isFinite(twice)&&Math.abs(twice)>1e-14;
 };
 const polygon=p=>Array.isArray(p)&&p.length>0&&p.every(ring);
 const v=geometry.coordinates;
 switch(geometry.type){
  case 'Point':return xy(v);
  case 'MultiPoint':return Array.isArray(v)&&v.length>0&&v.every(xy);
  case 'LineString':return line(v);
  case 'MultiLineString':return Array.isArray(v)&&v.length>0&&v.every(line);
  case 'Polygon':return polygon(v);
  case 'MultiPolygon':return Array.isArray(v)&&v.length>0&&v.every(polygon);
  default:return false;
 }
}
function parseGeojson(bytes){
 const meta=blank('geojson');
 let data;
 try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
 catch(e){return blank('geojson','Invalid GeoJSON JSON: '+e.message)}
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))return blank('geojson','Only GeoJSON FeatureCollection is inspected');
 const box=[Infinity,Infinity,-Infinity,-Infinity],kinds=new Set();
 let valid=true,pointsOnly=true;
 for(const f of data.features){
  const geometry=f?.geometry;
  if(!geometry){valid=false;continue}
  const type=geometryKind(geometry.type);
  kinds.add(type);
  // MultiPoint contains several XY positions per feature; a matching feature
  // count and bbox is not proof of point-to-point equality in this schema.
  if(geometry.type!=='Point')pointsOnly=false;
  if(type==='unknown'||!walkCoords(geometry.coordinates,box)||
   (geometry.type==='Point'&&(!Array.isArray(geometry.coordinates)||
    geometry.coordinates.length<2||typeof geometry.coordinates[0]!=='number')))
   valid=false;
 }
 meta.features=data.features.length;meta.geometry=[...kinds];meta.bbox=endBox(box);
 meta.fieldRisk=scanGeojsonFieldRisk(data.features);
 meta.knownNonNullGeometries=valid&&data.features.length>0&&
  data.features.every(f=>knownNonEmptyGeojsonGeometry(f?.geometry));
 meta.pointOnly=valid&&pointsOnly;meta.complete=valid;
 const declared=String(data.crs?.properties?.name||'').trim().toUpperCase();
 const known=new Set(['CRS84','OGC:CRS84','URN:OGC:DEF:CRS:OGC:1.3:CRS84','EPSG:4326','URN:OGC:DEF:CRS:EPSG::4326','URN:OGC:DEF:CRS:EPSG:6.6:4326']);
 const knownWGS84=!data.crs||data.crs?.type==='name'&&known.has(declared);
 meta.crs=knownWGS84?'WGS84':'unknown';
 if(data.crs&&!knownWGS84)meta.issues.push('Unrecognized GeoJSON CRS declaration: WGS84 coordinates cannot be assumed');
 if(!valid)meta.issues.push('Some GeoJSON geometries could not be structurally inspected');
 return meta;
}
function parseDelimitedCsv(bytes){
 const meta=blank('csv');
 let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
 catch{return blank('csv','CSV is not valid UTF-8')}
 text=text.replace(/^\uFEFF/,'');
 if(text.length>16*1024*1024)return blank('csv','CSV exceeds analysis size');
 const box=[Infinity,Infinity,-Infinity,-Infinity];let record=[],field='',quote=false,header=null,idxLon=-1,idxLat=-1,rows=0,good=0;
 function accept(){
  record.push(field);field='';
  if(!header){
   header=record.map(s=>s.trim().toLowerCase().replace(/^\ufeff/,''));
   idxLon=header.findIndex(x=>['longitude','lon','x'].includes(x));
   idxLat=header.findIndex(x=>['latitude','lat','y'].includes(x));
  }else if(record.some(s=>s.trim())){
   rows++;
   if(idxLon>=0&&idxLat>=0){
    const parsed=pointFromText(record[idxLon],record[idxLat]);
    if(parsed&&addPoint(box,parsed))good++;
   }
  }
  record=[];
 }
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   if(quote&&text[i+1]==='"'){field+='"';i++}else quote=!quote;
  }else if(c===','&&!quote){record.push(field);field=''}
  else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;accept()}
  else field+=c;
  if(field.length>250000)return blank('csv','CSV field too long to inspect');
 }
 if(quote)return blank('csv','Unclosed quoted CSV field');
 if(field||record.length)accept();
 meta.features=rows;meta.geometry=['point'];meta.bbox=endBox(box);
 meta.crs=idxLon>=0&&idxLat>=0?'WGS84':'unknown';
 meta.complete=idxLon>=0&&idxLat>=0&&good===rows&&rows>0;
 meta.pointOnly=meta.complete;
 if(idxLon<0||idxLat<0)meta.issues.push('Longitude/latitude columns not identified');
 if(good!==rows)meta.issues.push('Some CSV rows lack valid WGS84 coordinates');
 return meta;
}
/**
 * Strict P58-only proof that a simple KML Point is an actual direct child
 * of each Placemark, not text in CDATA, comments or nested description tags.
 * Deliberately return false for ambiguous constructs, prefixes or markup.
 * This checker never copies user XML or coordinate values into a report.
 */
function provenDirectKmlPoint(markup){
 // Without a namespace resolver, a nested xmlns override makes the local
 // names ambiguous. Never certify that such elements are KML geometry.
 if(/<!--|<!\[CDATA\[|<!DOCTYPE|<!ENTITY|\bxmlns(?::[\w.-]+)?\s*=/i.test(markup))
  return false;
 const tokens=[...markup.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w.:-]*)\b([^<>]*?)>/g)];
 const stack=[];
 let direct=0,locatedCoordinates=0,coordinatesStart=-1;
 for(const token of tokens){
  const rawName=token[2];
  const name=rawName.split(':').at(-1).toLowerCase();
  const closing=token[1]==='/';
  const tail=token[3];
  // We do not independently resolve XML namespace bindings here. A foreign
  // <fake:coordinates> is not a valid KML geometry coordinate element, even
  // when it appears below <Point>. Limit certification to unprefixed KML
  // elements; namespaced but valid documents remain "unavailable".
  if((name==='point'&&rawName!=='Point')||
     (name==='coordinates'&&rawName!=='coordinates'))return false;
  if(closing){
   // XML names are case-sensitive; prefixes must match the opening tag.
   if(stack.at(-1)?.rawName!==rawName)return false;
   if(name==='coordinates'&&stack.length===2&&stack[0].rawName==='Point'){
    if(coordinatesStart<0)return false;
    const contents=markup.slice(coordinatesStart,token.index).trim();
    const locations=contents.split(/\s+/).filter(Boolean);
    if(locations.length!==1)return false;
    const xyz=locations[0].split(',');
    if(xyz.length<2||xyz.length>3||!pointFromText(xyz[0],xyz[1])||
       (xyz.length===3&&!strictDecimal.test(xyz[2].trim())))
      return false;
    locatedCoordinates++;
   }
   stack.pop();
  }else{
   if(rawName==='Point'&&stack.length===0)direct++;
   if(rawName==='coordinates'&&stack.length===1&&
      stack[0].rawName==='Point')
    coordinatesStart=token.index+token[0].length;
   if(!/\/\s*$/.test(tail))stack.push({rawName});
  }
 }
 return stack.length===0&&direct===1&&locatedCoordinates===1;
}
function parseKml(bytes,format='kml'){
 let str;
 try{str=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
 catch{return blank(format,'KML is not UTF-8')}
 const meta=blank(format);
 if(!/<(?:\w+:)?kml\b/i.test(str))return blank(format,'No KML document element');
 const placemarks=[...str.matchAll(/<(?:[\w.-]+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Placemark\s*>/gi)];
 meta.features=placemarks.length;meta.crs='WGS84';
 const box=[Infinity,Infinity,-Infinity,-Infinity],kinds=new Set();
 let points=0,valid=true;
 for(const p of placemarks){
  const str=p[1];
  const type=/<(?:[\w.-]+:)?Polygon\b/i.test(str)?'polygon':/<(?:[\w.-]+:)?LineString\b/i.test(str)?'line':/<(?:[\w.-]+:)?Point\b/i.test(str)?'point':'unknown';
  kinds.add(type);
  if(type!=='point'){valid=false;continue}
  const coords=[...str.matchAll(/<(?:[\w.-]+:)?coordinates\b[^>]*>\s*([^<]+)\s*<\/(?:[\w.-]+:)?coordinates\s*>/gi)];
  if(coords.length!==1){valid=false;continue}
  const positions=coords[0][1].trim().split(/\s+/);
  if(positions.length!==1){valid=false;continue}
  const xyz=positions[0].split(',');
  const coord=xyz.length>=2&&xyz.length<=3?pointFromText(xyz[0],xyz[1]):null;
  if(!coord||(xyz.length===3&&!strictDecimal.test(String(xyz[2]).trim()))||
     !addPoint(box,coord)){valid=false;continue}
  points++;
 }
 meta.geometry=[...kinds];meta.bbox=endBox(box);
 meta.pointOnly=valid&&points===placemarks.length&&points>0;
 const kmlRoot=str.match(/<(?:[\w.-]+:)?kml\b([^>]*)>/i);
 const rootNamespace=kmlRoot?.[1].match(/\bxmlns\s*=\s*(['"])([^'"]+)\1/i)?.[2]||'';
 // A Document or Placemark can redeclare the default namespace even when
 // the root is standard KML. Without full namespace resolution, any nested
 // xmlns redeclaration makes non-null geometry proof unavailable.
 const nestedNamespaces=kmlRoot&&/\bxmlns(?::[\w.-]+)?\s*=/i.test(
  str.slice((kmlRoot.index||0)+kmlRoot[0].length));
 const rootGeometryProved=!!kmlRoot&&!nestedNamespaces&&
  (!rootNamespace||rootNamespace==='http://www.opengis.net/kml/2.2');
 meta.knownNonNullGeometries=meta.pointOnly&&rootGeometryProved&&
  placemarks.every(mark=>provenDirectKmlPoint(mark[1]));
 meta.complete=meta.pointOnly;
 if(!meta.complete)meta.issues.push('KML analysis is restricted to one Point coordinate per Placemark; complex KML was not fully inspected');
 return meta;
}
function parseGpx(bytes){
 let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
 catch{return blank('gpx','GPX is not UTF-8')}
 const meta=blank('gpx');
 if(!/<(?:\w+:)?gpx\b/i.test(text))return blank('gpx','No GPX root');
 // Count the three logical GPX feature families, not auxiliary route/track
 // vertex layers, which GDAL also exposes separately.
 const normalized=text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
 const waypoints=[...normalized.matchAll(/<(?:\w+:)?wpt\b([^>]*)>/gi)];
 const routes=[...normalized.matchAll(/<(?:\w+:)?rte\b/gi)];
 const tracks=[...normalized.matchAll(/<(?:\w+:)?trk\b/gi)];
 const hasRoutes=routes.length>0||tracks.length>0;
 const box=[Infinity,Infinity,-Infinity,-Infinity];let valid=true;
 for(const m of waypoints){
  const lat=m[1].match(/(?:^|\s)lat\s*=\s*["']([^"']*)["']/i);
  const lon=m[1].match(/(?:^|\s)lon\s*=\s*["']([^"']*)["']/i);
  const parsed=pointFromText(lon?.[1],lat?.[1]);
  if(!parsed||!addPoint(box,parsed))valid=false;
 }
 meta.features=hasRoutes?null:waypoints.length;meta.geometry=hasRoutes?['point','line']:['point'];
 meta.crs='WGS84';meta.bbox=endBox(box);
 // Definite logical-feature accounting is independent from full geometry
 // coordinate inspection. Invalid waypoint coordinates disable this check.
 meta.gpxLogicalFeatures=valid?waypoints.length+routes.length+tracks.length:null;
 meta.gpxTypes={waypoints:waypoints.length,routes:routes.length,tracks:tracks.length};
 meta.pointOnly=!hasRoutes&&valid&&waypoints.length>0;
 meta.complete=meta.pointOnly;
 if(hasRoutes)meta.issues.push('GPX track/route feature accounting is not supported');
 if(!valid)meta.issues.push('Some waypoint coordinates could not be parsed');
 return meta;
}
/**
 * P56: a ZIP with matching .shx entry count and .dbf row count can still
 * contain SHX entries pointing to unrelated/truncated SHP records. Verify the
 * actual ESRI SHP/SHX 16-bit-word offsets, lengths and per-record types.
 * Never copy feature coordinates, names or DBF field values to the report.
 */
function inspectShpRecordIndex(shp,shx,dbf){
 const invalid=detail=>({status:'review',detail});
 if(shp.length<100||shx.length<100||dbf.length<33)
  return invalid('Shapefile SHP/SHX/DBF header is truncated');
 if(shp.length%2||shx.length%2||(shx.length-100)%8)
  return invalid('Shapefile index or data record alignment is invalid');
 const shape=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
 const index=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
 const table=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 if(shape.getUint32(0,false)!==9994||index.getUint32(0,false)!==9994||
    shape.getUint32(24,false)!==shp.length/2||
    index.getUint32(24,false)!==shx.length/2||
    shape.getUint32(28,true)!==1000||index.getUint32(28,true)!==1000||
    shape.getInt32(32,true)!==index.getInt32(32,true))
  return invalid('Shapefile SHP and SHX file headers do not agree');
 const count=table.getUint32(4,true),headerLength=table.getUint16(8,true),
  recordLength=table.getUint16(10,true),indexCount=(shx.length-100)/8;
 if(recordLength<1||headerLength<33||headerLength>dbf.length||
    dbf[headerLength-1]!==0x0d||
    headerLength+count*recordLength>dbf.length||
    indexCount!==count)
  return invalid('Shapefile DBF record extent or SHX row count is inconsistent');
 const datasetShape=shape.getInt32(32,true);
 let expectedOffset=100,nullShapes=0;
 for(let i=0;i<indexCount;i++){
  const at=100+i*8;
  const recordWordOffset=index.getUint32(at,false);
  const contentWords=index.getUint32(at+4,false);
  const byteLength=contentWords*2;
  if(contentWords<2||recordWordOffset*2!==expectedOffset||
     expectedOffset+8+byteLength>shp.length)
   return invalid('Shapefile SHX points outside its corresponding SHP record');
  if(shape.getUint32(expectedOffset,false)!==i+1||
     shape.getUint32(expectedOffset+4,false)!==contentWords)
   return invalid('Shapefile SHX record length or sequence differs from SHP');
  const recordShape=shape.getInt32(expectedOffset+8,true);
  if(recordShape!==0&&recordShape!==datasetShape)
   return invalid('Shapefile record geometry type differs from its layer');
  if(recordShape===0){
   // Null Shape is a legal ESRI record type but must never be silently
   // substituted for a geometry known to exist in the source dataset.
   if(contentWords!==2)return invalid('Null Shape record has unexpected byte length');
   nullShapes++;
  }
  expectedOffset+=8+byteLength;
 }
 if(expectedOffset!==shp.length)
  return invalid('Shapefile SHX does not cover all SHP record bytes');
 for(let i=0;i<count;i++){
  const flag=dbf[headerLength+i*recordLength];
  if(flag!==0x20)
   return invalid('Shapefile DBF contains deleted or invalid record markers');
 }
 return {status:'pass',nullShapes,
  detail:'SHP records, SHX offsets/lengths, DBF rows and geometry types match'};
}

async function parseZip(bytes,format){
 let zip;
 try{zip=await JSZip.loadAsync(bytes)}
 catch(e){return blank(format,'Invalid ZIP structure: '+e.message)}
 const names=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
 if(format==='kmz'){
  const doc=zip.file('doc.kml')||zip.file(names.find(n=>n.toLowerCase().endsWith('.kml')));
  if(!doc)return blank(format,'KMZ KML document missing');
  if((doc._data?.uncompressedSize??0)>ZIP_LIMIT)return blank(format,'KML exceeds inspection limit');
  const contents=await doc.async('uint8array');
  if(contents.length>ZIP_LIMIT)return blank(format,'KML exceeds inspection limit');
  return parseKml(contents,'kmz');
 }
 // P59: one ZIP may contain multiple ESRI Shapefile layers. Inspecting
 // only the first *.shp silently certified a package whose second (or later)
 // layer had a broken SHX/DBF, missing geometry or missing sidecar.
 // Bound the archive and resolve all components by full, case-folded stem.
 if(names.length>48)return blank('shp','Shapefile archive contains too many entries to inspect');
 const related=/\.(?:shp|shx|dbf|prj|cpg)$/i;
 const components=new Map();
 for(const name of names){
  if(!related.test(name))continue;
  const key=name.toLowerCase();
  if(components.has(key))return blank('shp','Ambiguous case-insensitive Shapefile component names');
  components.set(key,zip.file(name));
 }
 const stems=[...components.keys()].filter(n=>n.endsWith('.shp')).map(n=>n.slice(0,-4));
 if(!stems.length)return blank('shp','Shapefile component .shp not found');
 if(stems.length>8)return blank('shp','Shapefile has more than eight layers to inspect');
 const knownStems=new Set(stems);
 for(const key of components.keys()){
  const stem=key.replace(/\.(?:shp|shx|dbf|prj|cpg)$/,'');
  if(!knownStems.has(stem))
   return blank('shp','Shapefile contains a sidecar with no matching SHP layer');
 }
 // The total of all decompressed SHP/SHX/DBF bytes must remain bounded,
 // not just each individual layer. An oversized layer is never certified.
 let estimatedSize=0;
 for(const file of components.values()){
  const size=file?._data?.uncompressedSize;
  if(!Number.isFinite(size)||size<0)return blank('shp','Shapefile ZIP member size could not be verified');
  if(file.name.toLowerCase().endsWith('.prj')&&size>1024*1024)
   return blank('shp','Shapefile projection description is too large');
  estimatedSize+=size;
  if(estimatedSize>ZIP_LIMIT)return blank('shp','Combined Shapefile layers exceed inspection limit');
 }
 const meta=blank('shp'), kinds={
  1:'point',11:'point',21:'point',8:'point',18:'point',28:'point',
  3:'line',13:'line',23:'line',5:'polygon',15:'polygon',25:'polygon'
 };
 meta.shpLayers=stems.length;
 let recordOK=true,xyReview=false,xyAllPass=true,allWGS84=true,
     allPoint=true,allKindsKnown=true,allBounds=true,anyMissingPrj=false,
     totalFeatures=0,totalNullShapes=0;
 const families=new Set(),totalBox=[Infinity,Infinity,-Infinity,-Infinity];
 for(const stem of stems){
  const shpFile=components.get(stem+'.shp'),
   shxFile=components.get(stem+'.shx'),
   dbfFile=components.get(stem+'.dbf'),
   prjFile=components.get(stem+'.prj');
  if(!shpFile||!shxFile||!dbfFile)
   return blank('shp','A Shapefile layer is missing SHP/SHX/DBF');
  const [shp,shx,dbf,prj]=await Promise.all([
   shpFile.async('uint8array'),shxFile.async('uint8array'),
   dbfFile.async('uint8array'),prjFile?prjFile.async('string'):Promise.resolve('')
  ]);
  if(shp.length<100||shx.length<100||dbf.length<33)
   return blank('shp','A Shapefile layer has a truncated header');
  const shape=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
  const table=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
  const kind=kinds[shape.getInt32(32,true)]||'unknown';
  families.add(kind);
  if(kind==='unknown')allKindsKnown=false;
  if(kind!=='point')allPoint=false;
  totalFeatures+=table.getUint32(4,true);
  const record=inspectShpRecordIndex(shp,shx,dbf);
  if(record.status!=='pass'){
   recordOK=false;
   meta.issues.push(record.detail);
  }else totalNullShapes+=record.nullShapes;
  const xy=record.status==='pass'?inspectShpXYBounds(shp,shx):
   {status:'unavailable'};
  if(xy.status!=='pass')xyAllPass=false;
  if(xy.status==='review'){
   xyReview=true;
   meta.issues.push(xy.detail);
  }
  const projected=/PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/i.test(prj);
  if(projected||!/WGS[\s_-]*(?:84|1984)|GCS_WGS_1984/i.test(prj))
   allWGS84=false;
  if(!prj)anyMissingPrj=true;
  if(xy.status==='pass'){
   const b=[36,44,52,60].map(i=>shape.getFloat64(i,true));
   if(b.every(Number.isFinite)&&b[0]<=b[2]&&b[1]<=b[3]){
    totalBox[0]=Math.min(totalBox[0],b[0]);
    totalBox[1]=Math.min(totalBox[1],b[1]);
    totalBox[2]=Math.max(totalBox[2],b[2]);
    totalBox[3]=Math.max(totalBox[3],b[3]);
   }else allBounds=false;
  }else allBounds=false;
 }
 meta.features=totalFeatures;
 meta.geometry=[...families];
 meta.shpRecordIntegrity=recordOK?'pass':'review';
 meta.shpNullShapes=recordOK?totalNullShapes:null;
 meta.shpXYBounds=xyReview?'review':xyAllPass?'pass':'unavailable';
 meta.pointOnly=recordOK&&!xyReview&&allPoint;
 meta.complete=recordOK&&!xyReview&&allKindsKnown;
 meta.crs=allWGS84?'WGS84':'unknown';
 if(allBounds&&totalBox.every(Number.isFinite))
  meta.bbox=totalBox.map(v=>Math.round(v*1e7)/1e7);
 if(!allKindsKnown)meta.issues.push('Shapefile geometry type could not be verified');
 if(anyMissingPrj)meta.issues.push('One or more Shapefile layers omit a projection file');
 return meta;
}
export async function inspectGISData(format,bytes){
 try{
  if(!(bytes instanceof Uint8Array))return blank(format,'No inspectable data');
  if(format==='geojson')return parseGeojson(bytes);
  if(format==='csv')return parseDelimitedCsv(bytes);
  if(format==='kml')return parseKml(bytes);
  if(format==='gpx')return parseGpx(bytes);
  if(format==='kmz'||format==='shp')return await parseZip(bytes,format);
  return blank(format,'Unsupported inspector');
 }catch(e){return blank(format,'Inspector unable to read this file: '+(e instanceof Error?e.message:String(e)))}
}
export async function createGISQualityReport(input,source,output,target){
 const inputBytes=new Uint8Array(await input.arrayBuffer());
 const [before,after]=await Promise.all([inspectGISData(source,inputBytes),inspectGISData(target,output)]);
 // P40/P49/P51 independent readback helpers are single-Shapefile-layer
 // readers. The new P59 aggregate counts and structural checks cover ALL
 // layers, but do not present a partial geometry/attribute comparison as
 // a cross-format certification for a multi-layer archive.
 const multiShp=(source==='shp'&&before.shpLayers>1)||
   (target==='shp'&&after.shpLayers>1);
 const checks=[];
 function add(id,status,detail){checks.push({id,status,detail})}
 if(after.issues.length)add('output-structure','review','Output: '+after.issues.join('; '));
 else add('output-structure',after.complete?'pass':'unavailable',after.complete?'Output structure inspected for supported feature types':'Structural inspection was incomplete');
 // Treat unreadable/truncated ZIP output as a critical SHP integrity failure
 // too. A missing result must never be interpreted as "not checked".
 if(target==='shp'){
  add('shp-record-integrity',after.shpRecordIntegrity==='pass'?'pass':'review',
    after.shpRecordIntegrity==='pass'
      ? 'SHP records, SHX indexes and DBF row extents independently match'
      : 'Converted Shapefile ZIP, record/index/DBF structure could not be verified');
  add('shp-xy-bounds',after.shpXYBounds||'unavailable',
    after.shpXYBounds==='pass'
      ? 'SHP/SHX file and multipart record bounds match actual XY vertices'
      : after.shpXYBounds==='review'
        ? 'Converted Shapefile XY coordinates differ from recorded bounds'
        : 'Shapefile XY bounds could not be independently checked for this geometry');
 }
 // P58: a Null Shape retains its DBF row and SHX slot, so even feature
 // count and file-level bounds can match while an interior geometry is gone.
 // Only claim loss if every source geometry was independently inspectable
 // and non-null; incomplete KML/KMZ/unsupported source layers stay unknown.
 if(target==='shp'){
  const sourceNonNullProved=source==='geojson'?
    before.knownNonNullGeometries===true:
    ['kml','kmz'].includes(source)?
      before.knownNonNullGeometries===true:
      ['csv','gpx'].includes(source)&&before.pointOnly===true;
  const comparable=before.complete&&sourceNonNullProved&&
    Number.isInteger(before.features)&&before.features>0&&
    before.features===after.features&&after.shpRecordIntegrity==='pass'&&
    Number.isInteger(after.shpNullShapes);
  const missing=comparable&&after.shpNullShapes>0;
  add('shp-null-shape-loss',comparable?(missing?'review':'pass'):'unavailable',
    comparable
      ? missing
        ? 'Output Shapefile contains '+after.shpNullShapes+
          ' Null Shape geometries where the fully inspected source had none'
        : 'All '+after.features+' Shapefile records retain non-null geometry'
      : 'Null Shape loss cannot be determined without matching, independently verified source geometries');
 }
 if(before.features!==null&&after.features!==null&&before.complete&&after.complete){
  add('feature-count',before.features===after.features?'pass':'review',before.features+' input → '+after.features+' output features');
 }else add('feature-count','unavailable','Input/output counts are not directly comparable for these geometries');
 if(source==='gpx'&&['kml','kmz'].includes(target)){
  const expected=before.gpxLogicalFeatures;
  if(Number.isInteger(expected)&&expected>=0&&Number.isInteger(after.features)){
   add('gpx-logical-features',expected===after.features?'pass':'review',
     'GPX waypoints + routes + tracks: '+expected+' input → '+after.features+
     ' KML Placemarks. Auxiliary GPX route/track vertices are not separate features.');
  }else add('gpx-logical-features','unavailable','Full GPX logical feature accounting is unavailable for this file');
 }
 if(source==='gpx'&&['kml','kmz'].includes(target)){
  try{
   const sourceText=new TextDecoder('utf-8',{fatal:true}).decode(inputBytes);
   let targetBytes=output;
   if(target==='kmz'){
    const zip=await JSZip.loadAsync(output);
    const doc=zip.file('doc.kml');
    if(!doc||(doc._data?.uncompressedSize??0)>ZIP_LIMIT)throw Error('KMZ KML unavailable within inspection limit');
    targetBytes=await doc.async('uint8array');
    if(targetBytes.length>ZIP_LIMIT)throw Error('KMZ KML exceeds inspection limit');
   }
   const targetText=new TextDecoder('utf-8',{fatal:true}).decode(targetBytes);
   const fidelity=inspectGpxLineFidelity(sourceText,targetText);
   add('gpx-line-geometry',fidelity.status,fidelity.detail);
   const timed=inspectGpxTimedKml(sourceText,targetText);
   add('gpx-timed-track',timed.status,timed.detail);
   add('gpx-vertex-metadata',fidelity.metadata.status,fidelity.metadata.detail);
  }catch{
   add('gpx-line-geometry','unavailable','GPX route/track vertex check was unable to inspect the output.');
   add('gpx-timed-track','unavailable','GPX timestamped segment validation could not run.');
   add('gpx-vertex-metadata','unavailable','GPX point-level metadata has not been verified.');
  }
 }
 // P39: matching point counts and bounding boxes do not prove that middle
 // coordinates were preserved. Compare each supported point independently
 // against ACTUAL converted output bytes, without writing XY into the report.
 // This check is conservative: multipart/unsupported geometries remain
 // "unavailable" rather than a false verification or a conversion blocker.
 if(new Set(['geojson','kml','kmz','csv','gpx']).has(source)&&
    new Set(['geojson','kml','kmz','csv','gpx']).has(target)&&source!==target){
  const match=before.crs==='WGS84'&&after.crs==='WGS84'?
   await inspectPointCoordinateFidelity(inputBytes,source,output,target):
   {status:'unavailable',detail:'WGS84 coordinate system not independently confirmed for both formats.'};
  add('point-coordinate-values',match.status,match.detail);
 }
 // P40: compare source vs actual converted complex XY geometry, including
 // every LineString vertex, multipart boundaries, polygon outer rings and
 // holes. This check is bounded and independent of the display preview.
 // Mixed, unsupported, ambiguous or projected GIS files are NOT certified.
 if(new Set(['geojson','kml','kmz','shp']).has(source)&&
    new Set(['geojson','kml','kmz','shp']).has(target)&&source!==target){
  const fidelity=multiShp?
   {status:'unavailable',detail:'Multi-layer Shapefile cross-format vertex comparison has not been independently certified.'}:
   before.crs==='WGS84'&&after.crs==='WGS84'?
    await inspectComplexGeometryFidelity(inputBytes,source,output,target):
    {status:'unavailable',detail:'Complex WGS84 geometry comparison requires confirmed geographic CRS on both sides.'};
  add('complex-geometry-values',fidelity.status,fidelity.detail);
 }
 // P51: join line/polygon attributes to their unique fully matching
 // WGS84 geometry, not their input/output feature order. Known swapped
 // fields are DATA_LOSS; duplicate geometry leaves association unavailable.
 const complexAttributeFormats=new Set(['geojson','kml','kmz','shp']);
 if(source!==target&&complexAttributeFormats.has(source)&&complexAttributeFormats.has(target)){
  // Skip extra ZIP/SHP/coordinate parsing entirely for large stress inputs.
  // P40's original 4,000-feature geometry gate remains unchanged.
  const insideJoinCap=count=>count===null||(Number.isInteger(count)&&count>0&&count<=300);
  const result=!multiShp&&!before.pointOnly&&!after.pointOnly&&
    insideJoinCap(before.features)&&insideJoinCap(after.features)&&
    before.crs==='WGS84'&&after.crs==='WGS84'?
   await inspectComplexFeatureAttributeFidelity(inputBytes,source,output,target):
   {status:'unavailable',detail:'Complex attribute checking requires uniquely matchable WGS84 line/polygon geometry.'};
  add('complex-feature-attributes',result.status,result.detail);
 }
 if(before.pointOnly&&after.pointOnly&&before.bbox&&after.bbox&&before.crs==='WGS84'&&after.crs==='WGS84'){
  const matches=before.bbox.every((x,i)=>eq(x,after.bbox[i]));
  add('coordinate-bounds',matches?'pass':'review',matches?'Point longitude/latitude bounds agree':'Coordinates differ: input '+before.bbox.join(', ')+'; output '+after.bbox.join(', '));
 }else add('coordinate-bounds','unavailable','Coordinate comparison requires compatible WGS84 point geometries');
 if(before.issues.length)add('input-inspection','review',before.issues.join('; '));
 else add('input-inspection',before.complete?'pass':'unavailable',before.complete?'Input structure inspected for supported feature types':'Input inspection was incomplete');
 if(source==='geojson'&&target==='shp'&&before.fieldRisk){
  const r=before.fieldRisk;
  const flagged=r.longNames||r.firstTenByteCollisions||r.caseInsensitiveCollisions||r.nonScalarValues||r.schemaScanLimited;
  add('shp-field-limits',flagged?'review':'pass',
    flagged
      ? 'Shapefile DBF schema risk: '+r.longNames+' field names exceed 10 UTF-8 bytes, '+
        r.firstTenByteCollisions+' duplicate 10-byte prefixes, '+r.caseInsensitiveCollisions+
        ' case-insensitive name collisions, '+r.nonScalarValues+
        ' nested/list values'+(r.schemaScanLimited?'; field scan limited':'')+
        '. Shortening, renaming or coercion can occur. Confirm fields in GIS software.'
      : 'No field-name length, 10-byte prefix collision or non-scalar type risk found in inspected input; field values are not certified.'
  );
 }
 if(source==='geojson'&&target==='shp'&&before.fieldRisk){
   const r=before.fieldRisk;
   const flagged=r.nullValues||r.emptyStrings||r.booleans||r.oversizedStrings||r.highPrecisionNumbers||r.unsafeIntegers||r.schemaScanLimited;
   add('shp-value-limits',flagged?'review':'pass',
     'DBF value compatibility risk: '+r.nullValues+' explicit nulls, '+r.emptyStrings+
     ' ambiguous empty strings, '+r.booleans+' boolean values (no native Shapefile Boolean field), '+r.oversizedStrings+
     ' UTF-8 strings longer than 254 bytes, '+r.highPrecisionNumbers+
     ' high-precision numbers, '+r.unsafeIntegers+' unsafe integer values'+
     (r.schemaScanLimited?'; schema scan bounded':'')+
     '. These are risk indicators, not evidence of loss or preservation.');
 }
 if(source==='geojson'&&target==='shp'){
  const fidelity=multiShp?
   {status:'unavailable',detail:'Multi-layer Shapefile DBF values require independent per-layer field association.'}:
   await inspectGeojsonToShpDbfFidelity(inputBytes,output);
  add('dbf-attribute-values',fidelity.status,fidelity.detail);
 }
 if(source==='shp'&&target==='geojson'){
  const fidelity=multiShp?
   {status:'unavailable',detail:'Multi-layer Shapefile-to-GeoJSON fields require independent per-layer association.'}:
   await inspectShpToGeojsonDbfFidelity(inputBytes,output);
  add('shp-geojson-attributes',fidelity.status,fidelity.detail);
 }
 // P50: compare named point attributes independently from actual bytes;
 // ambiguous schemas/coordinate correspondence never receive false passes.
 const attributeFormats=new Set(['csv','kml','kmz','geojson']);
 if(source!==target&&attributeFormats.has(source)&&attributeFormats.has(target)){
  const result=before.pointOnly&&after.pointOnly&&before.crs==='WGS84'&&after.crs==='WGS84'?
   await inspectCrossFormatAttributeFidelity(inputBytes,source,output,target):
   {status:'unavailable',detail:'Point attribute comparison needs WGS84 Point features and unambiguous row pairing.'};
  add('cross-format-attributes',result.status,result.detail);
 }
 add('attribute-fidelity','unavailable','Field types, names, values, styles and metadata are not independently verified');
 const status=checks.some(c=>c.status==='review')?'review':checks.some(c=>c.status==='unavailable')?'partial':'checked';
 return {schemaVersion:1,kind:'local-structural-quality-report',status,source,target,input:before,output:after,checks,disclaimer:'Automated structural comparison only; NOT data certification. Complex geometries, attributes, projections and rendering require independent GIS review.'};
}

/**
 * Fail closed only on independently comparable critical invariants.
 * A mere "unavailable" remains a warning, not a false positive certification.
 */
export function assertNoDetectedCriticalDataLoss(report){
 const errors=(report?.checks||[]).filter(c=>c.status==='review'&&
   (c.id==='shp-record-integrity'||c.id==='shp-xy-bounds'||c.id==='shp-null-shape-loss'||c.id==='feature-count'||c.id==='coordinate-bounds'||c.id==='point-coordinate-values'||c.id==='complex-geometry-values'||c.id==='gpx-logical-features'||c.id==='gpx-line-geometry'||c.id==='dbf-attribute-values'||c.id==='shp-geojson-attributes'||c.id==='cross-format-attributes'||c.id==='complex-feature-attributes'||c.id==='gpx-timed-track'));
 if(errors.length){
  const e=new Error('Output integrity mismatch: '+errors.map(c=>c.detail).join('; ')+
    '. The generated file was withheld to prevent silent GIS data loss.');
  e.code='DATA_LOSS';
  throw e;
 }
 return true;
}
