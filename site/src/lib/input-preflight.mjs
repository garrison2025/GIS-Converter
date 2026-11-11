/**
 * Fail-closed, bounded client-side preflight for untrusted GIS input.
 * Not a ZIP decompressor. Do not confuse central directory checks with
 * runtime memory isolation or independent GDAL output verification.
 */
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 128;
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 200;
const extensions = Object.freeze({
  shp: ['zip'], kmz: ['kmz'], kml: ['kml'], gpx: ['gpx'],
  csv: ['csv'], geojson: ['json','geojson']
});
function fail(message){ throw new Error('GIS input rejected: ' + message); }
const low = n => String(n).toLocaleLowerCase('en-US');
function basename(path){return path.split('/').at(-1)}
function cleanPath(name){
 if(!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')
    || /[\x00-\x1f\x7f]/.test(name) || name.includes(':')
    || name.split('/').some(s=>s==='' || s==='.' || s==='..')
    || name.split('/').length > 5) fail('unsafe archive path');
 return name;
}
function readName(bytes,flags){
 if(!(flags & 0x800) && bytes.some(b=>b>127)) fail('non-UTF-8 ZIP names are unsupported');
 let name;
 try{name = new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('invalid UTF-8 ZIP name')}
 return name.normalize('NFC');
}
function extractZipDirectory(buf){
 const bytes=new Uint8Array(buf);
 const view=new DataView(buf);
 if(bytes.length<22 || view.getUint32(0,true)!==0x04034b50)fail('invalid ZIP header');
 let end=-1;
 const min=Math.max(0,bytes.length-22-65535);
 for(let i=bytes.length-22;i>=min;i--){
  if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length){end=i;break}
 }
 if(end<0)fail('ZIP end-of-central-directory not found');
 const disk=view.getUint16(end+4,true), disk2=view.getUint16(end+6,true);
 const diskEntries=view.getUint16(end+8,true), totalEntries=view.getUint16(end+10,true);
 const size=view.getUint32(end+12,true), offset=view.getUint32(end+16,true);
 if(disk||disk2||diskEntries!==totalEntries)fail('multi-disk ZIP unsupported');
 if(totalEntries===0 || totalEntries===0xffff || size===0xffffffff || offset===0xffffffff)
   fail('empty or ZIP64 archive unsupported');
 if(totalEntries>MAX_ZIP_ENTRIES)fail('too many ZIP entries');
 if(offset+size!==end)fail('invalid central-directory boundaries');
 let ptr=offset,totalExpanded=0;
 const seen=new Set(),records=[];
 for(let i=0;i<totalEntries;i++){
  if(ptr+46>end || view.getUint32(ptr,true)!==0x02014b50)fail('malformed central directory');
  const madeBy=view.getUint16(ptr+4,true);
  const flags=view.getUint16(ptr+8,true);
  const method=view.getUint16(ptr+10,true);
  const compressed=view.getUint32(ptr+20,true);
  const expanded=view.getUint32(ptr+24,true);
  const nameLen=view.getUint16(ptr+28,true);
  const extraLen=view.getUint16(ptr+30,true);
  const commentLen=view.getUint16(ptr+32,true);
  const diskNo=view.getUint16(ptr+34,true);
  const external=view.getUint32(ptr+38,true);
  const localOffset=view.getUint32(ptr+42,true);
  const next=ptr+46+nameLen+extraLen+commentLen;
  if(next>end||nameLen===0)fail('malformed archive entry');
  if(flags&1)fail('encrypted ZIP unsupported');
  if(![0,8].includes(method))fail('unsupported ZIP compression method');
  if(diskNo || expanded===0xffffffff || compressed===0xffffffff || localOffset===0xffffffff)
    fail('ZIP64 or multi-disk ZIP unsupported');
  if(localOffset+30>offset || view.getUint32(localOffset,true)!==0x04034b50)
    fail('invalid local ZIP header');
  const name=readName(bytes.subarray(ptr+46,ptr+46+nameLen),flags);
  const folder=name.endsWith('/');
  const normal=cleanPath(folder?name.slice(0,-1):name);
  const collision=low(normal);
  if(seen.has(collision))fail('duplicate archive path');
  seen.add(collision);
  if((madeBy>>8)===3 && ((external>>>16)&0xf000)===0xa000)fail('ZIP symlinks unsupported');
  if(expanded>MAX_ENTRY_BYTES)fail('ZIP entry exceeds expanded-size limit');
  if(compressed===0 && expanded>0)fail('impossible ZIP expansion');
  if(compressed>0 && expanded>compressed*MAX_EXPANSION_RATIO && expanded>4096)
    fail('suspicious ZIP expansion ratio');
  totalExpanded+=expanded;
  if(totalExpanded>MAX_EXPANDED_BYTES)fail('ZIP total expansion exceeds limit');
  if(!folder)records.push({name:normal,bytes:expanded,compressionMethod:method});
  ptr=next;
 }
 if(ptr!==end)fail('unparsed ZIP central directory data');
 return {entries:records,totalExpanded};
}
export async function preflightGISInput(file,source,target){
 if(!(file instanceof Blob) || file.size===0 || file.size>MAX_INPUT_BYTES) fail('file empty or exceeds 15 MiB limit');
 const allowed=extensions[source];
 if(!allowed)fail('unsupported source format');
 const name=String(file.name||'');
 const ext=low(name.split('.').at(-1));
 if(!allowed.includes(ext))fail('filename extension does not match selected source format');
 if(!['shp','kmz'].includes(source)){
  // Avoid loading a full text file into the main thread: this function runs in the conversion worker.
  const prefix=new Uint8Array(await file.slice(0,Math.min(file.size,128*1024)).arrayBuffer());
  if(prefix.includes(0))fail('NUL bytes or UTF-16 input unsupported');
  if(['kml','gpx'].includes(source)){
   const text=new TextDecoder('utf-8').decode(prefix);
   if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('XML DTD/entities unsupported');
  }
  if(source==='geojson'&&target==='shp'){
   let doc;
   try{doc=JSON.parse(await file.text())}catch{fail('GeoJSON is not valid JSON')}
   if(doc?.type!=='FeatureCollection'||!Array.isArray(doc.features)||!doc.features.length)
    fail('GeoJSON must be a non-empty FeatureCollection for Shapefile output');
   const groupOf={Point:'point',MultiPoint:'point',LineString:'line',MultiLineString:'line',Polygon:'polygon',MultiPolygon:'polygon'};
   const groups=new Set();
   for(const entry of doc.features){
     const g=entry?.geometry;
     const family=g?.type&&groupOf[g.type];
     if(!family)fail('null, unsupported or GeometryCollection features cannot safely become one Shapefile layer');
     groups.add(family);
   }
   if(groups.size!==1)fail('mixed geometry families cannot safely become one Shapefile layer; split points, lines and polygons into separate files');
  }
  return {kind:'text',source,inputBytes:file.size};
 }
 const buffer=await file.arrayBuffer();
 const zip=extractZipDirectory(buffer);
 const entries=zip.entries;
 if(source==='shp'){
  const names=entries.map(e=>low(e.name));
  if(names.some(n=>n.includes('/')))fail('nested Shapefile ZIP not supported');
  const shapefiles=names.filter(n=>n.endsWith('.shp'));
  if(shapefiles.length!==1)fail('exactly one .shp is required');
  const stem=shapefiles[0].slice(0,-4);
  for(const ext of ['shp','shx','dbf','prj'])if(!names.includes(stem+'.'+ext))
    fail('Shapefile component .'+ext+' missing; source CRS must be declared');
  if(names.filter(n=>n.endsWith('.shp')).length!==1)fail('multiple shapefiles unsupported');
 }else{
  const kmls=entries.filter(e=>low(e.name).endsWith('.kml'));
  if(kmls.length!==1)fail('KMZ must contain exactly one KML document');
 }
 return {kind:'zip',source,inputBytes:file.size,entries:entries.length,expandedBytes:zip.totalExpanded};
}
export const GIS_PREFLIGHT_LIMITS=Object.freeze({MAX_INPUT_BYTES,MAX_ZIP_ENTRIES,MAX_EXPANDED_BYTES,MAX_EXPANSION_RATIO});
