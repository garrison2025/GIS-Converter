/**
 * P53: recover KML SchemaData/ExtendedData text properties that the native
 * GDAL KML driver omitted, ONLY where source and target line/polygon geometry
 * can be uniquely and exactly matched independently of feature row order.
 * Still subject to the full P40/P51 fail-closed DATA_LOSS report after repair.
 */
import JSZip from 'jszip';
import {pairComplexFeatureRows} from './complex-geometry-fidelity.mjs';
import {readKmlComplexAttributeRows} from './complex-feature-attribute-fidelity.mjs';

const LIMIT=12*1024*1024;
const forbidden=new Set(['__proto__','prototype','constructor']);
const unavailable=()=>({status:'unavailable',bytes:null,fieldsRestored:0});

export async function restoreKmlExtendedAttributes(file,outputBytes,format='kml'){
 try{
  if(!['kml','kmz'].includes(format)||!file||
     !Number.isSafeInteger(file.size)||file.size>LIMIT||
     !(outputBytes instanceof Uint8Array)||!outputBytes.byteLength||
     outputBytes.byteLength>LIMIT)return unavailable();
  const sourceBytes=new Uint8Array(await file.arrayBuffer());
  if(sourceBytes.length>LIMIT)return unavailable();
  let kmlBytes=sourceBytes;
  if(format==='kmz'){
   const zip=await JSZip.loadAsync(sourceBytes);
   const names=Object.keys(zip.files).filter(n=>
     !zip.files[n].dir&&n.toLowerCase().endsWith('.kml'));
   if(names.length!==1||names[0]!=='doc.kml')return unavailable();
   const entry=zip.file('doc.kml');
   if(!entry||(entry._data?.uncompressedSize??Infinity)>LIMIT)
    return unavailable();
   kmlBytes=await entry.async('uint8array');
   if(kmlBytes.length>LIMIT)return unavailable();
  }
  // P40 geometry inspection checks every vertex, multipart structure and
  // unique source/output association, not feature order or bbox alone.
  const pair=await pairComplexFeatureRows(sourceBytes,format,outputBytes,'geojson');
  if(!pair?.records||pair.records>300)return unavailable();
  const original=readKmlComplexAttributeRows(kmlBytes);
  if(!Array.isArray(original)||original.length!==pair.records)
   return unavailable();
  const converted=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(outputBytes));
  if(converted?.type!=='FeatureCollection'||!Array.isArray(converted.features)||
    converted.features.length!==pair.records)return unavailable();

  let restored=0;
  for(const [sourceIndex,outputIndex] of pair.pairs){
   const row=original[sourceIndex],feature=converted.features[outputIndex];
   const props=feature?.properties;
   if(!(row instanceof Map)||!props||typeof props!=='object'||Array.isArray(props))
    return unavailable();
   for(const [name,cell] of row){
    // Never coerce XML text to a guessed number/date or overwrite conflicting
    // output fields. Refuse prototype keys and case-fold aliases.
    if(typeof name!=='string'||!name||name.length>160||
       forbidden.has(name.toLowerCase())||cell?.kind!=='text'||
       typeof cell.value!=='string'||cell.value.length>12000||
       cell.value.includes('\u0000')||Object.hasOwn(props,name)||
       Object.keys(props).some(key=>key.toLowerCase()===name.toLowerCase()))
      continue;
    props[name]=cell.value;
    restored++;
   }
  }
  if(!restored)return unavailable();
  const bytes=new TextEncoder().encode(JSON.stringify(converted));
  if(bytes.length>LIMIT)return unavailable();
  return {status:'restored-by-unique-geometry',bytes,fieldsRestored:restored};
 }catch{
  // Do not leak coordinates, field names or values to the UI or CI logs.
  return unavailable();
 }
}
