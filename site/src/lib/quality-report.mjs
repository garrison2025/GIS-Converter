import JSZip from 'jszip';

const ZIP_LIMIT=36*1024*1024;
const eq=(a,b,tol=0.00015)=>Math.abs(a-b)<=tol;
const blank=(format,reason='')=>({format,features:null,geometry:[],bbox:null,crs:'unknown',pointOnly:false,complete:false,issues:reason?[reason]:[]});
const fail=message=>{throw Error(message)};
function geometryKind(s){return ({Point:'point',MultiPoint:'point',LineString:'line',MultiLineString:'line',Polygon:'polygon',MultiPolygon:'polygon'})[s]||'unknown'}
function addPoint(box,p){
 if(!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1]))return false;
 box[0]=Math.min(box[0],p[0]);box[1]=Math.min(box[1],p[1]);
 box[2]=Math.max(box[2],p[0]);box[3]=Math.max(box[3],p[1]);return true;
}
function endBox(box){return box.every(Number.isFinite)?box.map(n=>Math.round(n*1e7)/1e7):null}
function walkCoords(data,box){
 if(!Array.isArray(data))return false;
 if(data.length>=2&&typeof data[0]==='number')return addPoint(box,data);
 let result=true;
 for(const child of data)result=walkCoords(child,box)&&result;
 return result;
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
  kinds.add(type);if(type!=='point')pointsOnly=false;
  if(type==='unknown'||!walkCoords(geometry.coordinates,box))valid=false;
 }
 meta.features=data.features.length;meta.geometry=[...kinds];meta.bbox=endBox(box);
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
    const lon=Number(record[idxLon]),lat=Number(record[idxLat]);
    if(record[idxLon]?.trim()!==''&&record[idxLat]?.trim()!==''&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90){
     if(addPoint(box,[lon,lat]))good++;
    }
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
  const coord=positions[0].split(',').slice(0,2).map(Number);
  if(!addPoint(box,coord)){valid=false;continue}
  points++;
 }
 meta.geometry=[...kinds];meta.bbox=endBox(box);
 meta.pointOnly=valid&&points===placemarks.length&&points>0;
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
 const waypoints=[...text.matchAll(/<(?:\w+:)?wpt\b([^>]*)>/gi)];
 const hasRoutes=/<(?:\w+:)?(?:trk|rte)\b/i.test(text);
 const box=[Infinity,Infinity,-Infinity,-Infinity];let valid=true;
 for(const m of waypoints){
  const lat=m[1].match(/\blat\s*=\s*["']([^"']+)["']/i);
  const lon=m[1].match(/\blon\s*=\s*["']([^"']+)["']/i);
  if(!lat||!lon||!addPoint(box,[Number(lon[1]),Number(lat[1])]))valid=false;
 }
 meta.features=hasRoutes?null:waypoints.length;meta.geometry=hasRoutes?['point','line']:['point'];
 meta.crs='WGS84';meta.bbox=endBox(box);
 meta.pointOnly=!hasRoutes&&valid&&waypoints.length>0;
 meta.complete=meta.pointOnly;
 if(hasRoutes)meta.issues.push('GPX track/route feature accounting is not supported');
 if(!valid)meta.issues.push('Some waypoint coordinates could not be parsed');
 return meta;
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
 const stem=names.find(n=>n.toLowerCase().endsWith('.shp'))?.slice(0,-4);
 if(!stem)return blank('shp','Shapefile component .shp not found');
 const findExt=ext=>zip.file(names.find(n=>n.toLowerCase()=== (stem+'.'+ext).toLowerCase()));
 const shpFile=findExt('shp'),shxFile=findExt('shx'),dbfFile=findExt('dbf'),prjFile=findExt('prj');
 if(!shpFile||!shxFile||!dbfFile)return blank('shp','Shapefile missing SHP/SHX/DBF');
 const sizes=[shpFile,shxFile,dbfFile].map(f=>f._data?.uncompressedSize??0);
 if(sizes.some(x=>x>ZIP_LIMIT)||sizes.reduce((a,b)=>a+b,0)>ZIP_LIMIT)return blank('shp','Shapefile too large to inspect');
 const [shp,shx,dbf,prj]=await Promise.all([shpFile.async('uint8array'),shxFile.async('uint8array'),dbfFile.async('uint8array'),prjFile?prjFile.async('string'):Promise.resolve('')]);
 if(shp.length<100||shx.length<100||dbf.length<32)return blank('shp','Shapefile header too short');
 const a=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
 const b=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 const shape=a.getInt32(32,true);
 const kinds={1:'point',11:'point',21:'point',8:'point',18:'point',28:'point',3:'line',13:'line',23:'line',5:'polygon',15:'polygon',25:'polygon'};
 const count=b.getUint32(4,true);
 const shxCount=(shx.byteLength-100)/8;
 const meta=blank('shp');
 meta.features=count;meta.geometry=[kinds[shape]||'unknown'];
 meta.pointOnly=meta.geometry[0]==='point';
 meta.complete=Number.isInteger(shxCount)&&shxCount===count&&meta.geometry[0]!=='unknown';
 if(!meta.complete)meta.issues.push('Shapefile index, record count or geometry type could not be verified');
 const projected=/PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/i.test(prj);
 meta.crs=!projected&&/WGS[\s_-]*(?:84|1984)|GCS_WGS_1984/i.test(prj)?'WGS84':'unknown';
 const corners=[a.getFloat64(36,true),a.getFloat64(44,true),a.getFloat64(52,true),a.getFloat64(60,true)];
 if(corners.every(Number.isFinite)&&corners[0]<=corners[2]&&corners[1]<=corners[3])meta.bbox=corners.map(n=>Math.round(n*1e7)/1e7);
 if(!prj)meta.issues.push('Shapefile projection file is absent');
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
 const checks=[];
 function add(id,status,detail){checks.push({id,status,detail})}
 if(after.issues.length)add('output-structure','review','Output: '+after.issues.join('; '));
 else add('output-structure',after.complete?'pass':'unavailable',after.complete?'Output structure inspected for supported feature types':'Structural inspection was incomplete');
 if(before.features!==null&&after.features!==null&&before.complete&&after.complete){
  add('feature-count',before.features===after.features?'pass':'review',before.features+' input → '+after.features+' output features');
 }else add('feature-count','unavailable','Input/output counts are not directly comparable for these geometries');
 if(before.pointOnly&&after.pointOnly&&before.bbox&&after.bbox&&before.crs==='WGS84'&&after.crs==='WGS84'){
  const matches=before.bbox.every((x,i)=>eq(x,after.bbox[i]));
  add('coordinate-bounds',matches?'pass':'review',matches?'Point longitude/latitude bounds agree':'Coordinates differ: input '+before.bbox.join(', ')+'; output '+after.bbox.join(', '));
 }else add('coordinate-bounds','unavailable','Coordinate comparison requires compatible WGS84 point geometries');
 if(before.issues.length)add('input-inspection','review',before.issues.join('; '));
 else add('input-inspection',before.complete?'pass':'unavailable',before.complete?'Input structure inspected for supported feature types':'Input inspection was incomplete');
 add('attribute-fidelity','unavailable','Field types, names, values, styles and metadata are not independently verified');
 const status=checks.some(c=>c.status==='review')?'review':checks.some(c=>c.status==='unavailable')?'partial':'checked';
 return {schemaVersion:1,kind:'local-structural-quality-report',status,source,target,input:before,output:after,checks,disclaimer:'Automated structural comparison only; NOT data certification. Complex geometries, attributes, projections and rendering require independent GIS review.'};
}
