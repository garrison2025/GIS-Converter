/**
 * P42: strict local CP1252 Shapefile DBF -> GeoJSON Unicode repair.
 *
 * Browser GDAL/WASM can emit mojibake for a native GDAL CP1252 .cpg Shapefile
 * even when its encoding is explicitly set. Do NOT guess the intended text
 * based on the rendered mojibake alone. Read the original bounded DBF record,
 * decode declared CP1252 and repair only demonstrably misdecoded output
 * values with the identical row/field position. Ambiguous rows fail closed.
 *
 * This protects already correct output, numerical values, geometry, CRS, and
 * normal UTF-8 Shapefiles. No user data, field names or values are logged.
 */
import JSZip from 'jszip';

const MAX_ARCHIVE=15*1024*1024,MAX_DBF=8*1024*1024;
const MAX_GEOJSON=24*1024*1024,MAX_ROWS=20000,MAX_FIELDS=128;
const textDecoder=()=>new TextDecoder('windows-1252',{fatal:true});
const decodeUtf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const encodeUtf8=text=>new TextEncoder().encode(text);
const fatal=()=>{throw Error('Legacy Shapefile DBF encoding could not be safely preserved. Export the input layer with UTF-8 encoding in your GIS software, then retry.');};
const noChange=()=>({status:'not-applicable',bytes:null,correctedValues:0});
function dbfFields(dbf,view,headerLength,recordLength){
 const fields=[];let relative=1,ended=false;
 for(let ptr=32;ptr<headerLength;ptr+=32){
  if(dbf[ptr]===0x0D){ended=true;break;}
  if(ptr+32>headerLength||fields.length>=MAX_FIELDS)fatal();
  const nameBytes=dbf.subarray(ptr,ptr+11);
  const end=nameBytes.indexOf(0);
  const rawName=nameBytes.subarray(0,end<0?11:end);
  if(!rawName.length||rawName.some(c=>c>127))fatal();
  const name=String.fromCharCode(...rawName);
  if(!/^[A-Za-z_][A-Za-z0-9_]{0,10}$/.test(name))fatal();
  if(fields.some(f=>f.name.toLowerCase()===name.toLowerCase()))fatal();
  const type=String.fromCharCode(dbf[ptr+11]),width=dbf[ptr+16];
  if(width<1||relative+width>recordLength)fatal();
  fields.push({name,type,width,offset:relative});
  relative+=width;
 }
 if(!ended||!fields.length||relative>recordLength)fatal();
 return fields.filter(f=>f.type==='C');
}
export async function repairLegacyShpGeojson(sourceFile,geojsonBytes){
 if(!(sourceFile instanceof Blob)||sourceFile.size>MAX_ARCHIVE||
  !(geojsonBytes instanceof Uint8Array)||geojsonBytes.length>MAX_GEOJSON)fatal();
 const zip=await JSZip.loadAsync(await sourceFile.arrayBuffer());
 const entries=Object.keys(zip.files).filter(name=>!zip.files[name].dir);
 const shps=entries.filter(name=>name.toLowerCase().endsWith('.shp'));
 if(shps.length!==1)return noChange();
 const stem=shps[0].slice(0,-4).toLowerCase();
 const named=ext=>entries.find(name=>name.toLowerCase()===stem+'.'+ext);
 const cpgName=named('cpg');
 if(!cpgName)return noChange();
 const cpgEntry=zip.file(cpgName);
 if((cpgEntry?._data?.uncompressedSize??Infinity)>64)fatal();
 const encoding=(await cpgEntry.async('string')).trim().toUpperCase();
 if(['UTF-8','UTF8','65001'].includes(encoding))return noChange();
 if(!['CP1252','WINDOWS-1252','1252'].includes(encoding))fatal();
 const dbfName=named('dbf');
 if(!dbfName)fatal();
 const entry=zip.file(dbfName);
 if((entry?._data?.uncompressedSize??Infinity)>MAX_DBF)fatal();
 const dbf=await entry.async('uint8array');
 if(dbf.length<33||dbf.length>MAX_DBF)fatal();
 const view=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
 const count=view.getUint32(4,true),headerLength=view.getUint16(8,true),
  recordLength=view.getUint16(10,true);
 if(count<1||count>MAX_ROWS||headerLength<33||headerLength>dbf.length||
  recordLength<2||headerLength+count*recordLength>dbf.length)fatal();
 const fields=dbfFields(dbf,view,headerLength,recordLength);
 if(!fields.length)return {status:'cp1252-without-text',bytes:null,correctedValues:0};
 const geo=JSON.parse(decodeUtf8(geojsonBytes));
 if(geo?.type!=='FeatureCollection'||!Array.isArray(geo.features)||
  geo.features.length!==count)fatal();
 const decoder=textDecoder();
 let corrections=0;
 for(let row=0;row<count;row++){
  const pos=headerLength+row*recordLength;
  if(dbf[pos]!==0x20)fatal(); // deleted / filtered records invalidate row alignment
  const properties=geo.features[row]?.properties;
  if(!properties||typeof properties!=='object'||Array.isArray(properties))fatal();
  for(const field of fields){
   const raw=dbf.subarray(pos+field.offset,pos+field.offset+field.width);
   let trim=raw.length;
   while(trim>0&&raw[trim-1]===0x20)trim--;
   const expected=decoder.decode(raw.subarray(0,trim));
   const actual=properties[field.name];
   if(typeof actual!=='string'){
    if(!expected&&(actual===null||actual===undefined))continue;
    fatal();
   }
   if(actual===expected)continue;
   // Only correct the exact UTF-8-as-Windows1252 mojibake produced by the
   // tested GDAL/WASM build. Never silently overwrite arbitrary differences.
   const observedMojibake=decoder.decode(encodeUtf8(expected));
   if(actual!==observedMojibake)fatal();
   properties[field.name]=expected;
   corrections++;
  }
 }
 if(!corrections)return {status:'cp1252-verified',bytes:null,correctedValues:0};
 const bytes=encodeUtf8(JSON.stringify(geo));
 if(bytes.length>MAX_GEOJSON)fatal();
 return {status:'cp1252-corrected',bytes,correctedValues:corrections};
}
