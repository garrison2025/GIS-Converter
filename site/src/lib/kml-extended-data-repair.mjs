/**
 * P53 / KML ExtendedData: GDAL's standard KML reader can omit SimpleData
 * columns that its own writer produced. Recover only strict, text-valued
 * source attributes attached to uniquely identical 2D line/polygon geometry.
 *
 * The returned bytes remain subject to the original independent P40/P51
 * DATA_LOSS fail-closed gates. No network, no user-data logs, no row-order
 * matching, no overwrite of changed output cells, no XML entity processing.
 */
import {pairComplexFeatureRows} from './complex-geometry-fidelity.mjs';
import {readKmlComplexAttributeRows} from './complex-feature-attribute-fidelity.mjs';

const LIMIT=12*1024*1024;
const unsafe=new Set(['__proto__','prototype','constructor']);
const unavailable=()=>({status:'unavailable',bytes:null,fieldsRestored:0});
export async function restoreKmlExtendedAttributes(inputFile,outputBytes){
 try{
  if(!inputFile||!Number.isSafeInteger(inputFile.size)||inputFile.size>LIMIT||
   !(outputBytes instanceof Uint8Array)||!outputBytes.length||outputBytes.length>LIMIT)
   return unavailable();
  const inputBytes=new Uint8Array(await inputFile.arrayBuffer());
  const matched=await pairComplexFeatureRows(inputBytes,'kml',outputBytes,'geojson');
  if(!matched||!matched.records||matched.records>300)return unavailable();
  const original=readKmlComplexAttributeRows(inputBytes);
  if(!Array.isArray(original)||original.length!==matched.records)return unavailable();
  const output=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(outputBytes));
  if(output?.type!=='FeatureCollection'||!Array.isArray(output.features)||
    output.features.length!==matched.records)return unavailable();

  let restored=0;
  for(const [sourceIndex,targetIndex] of matched.pairs){
   const attrs=original[sourceIndex],feature=output.features[targetIndex];
   const props=feature?.properties;
   if(!(attrs instanceof Map)||!props||typeof props!=='object'||Array.isArray(props))
    return unavailable();
   for(const [name,cell] of attrs){
    // Avoid prototype properties, case-fold ambiguity and malformed values.
    // Most KML ExtendedData values have no reliable native numeric type;
    // preserve the original XML string, never invent a number.
    if(typeof name!=='string'||!name||name.length>160||
     unsafe.has(name.toLowerCase())||cell?.kind!=='text'||
     typeof cell.value!=='string'||cell.value.length>12000||
     cell.value.includes('\u0000')||Object.hasOwn(props,name))continue;
    if(Object.keys(props).some(key=>key.toLowerCase()===name.toLowerCase()))
     continue;
    props[name]=cell.value;
    restored++;
   }
  }
  return restored?{
   status:'restored-by-unique-geometry',
   bytes:new TextEncoder().encode(JSON.stringify(output)),
   fieldsRestored:restored
  }:unavailable();
 }catch{return unavailable()}
}
