import {readUtf8ShapefileDbf,readComparableDbfValue,comparableDbfFieldName} from './dbf-fidelity.mjs';

/**
 * P23: bounded independent source DBF -> emitted GeoJSON field comparison.
 * Runs in the isolated browser Worker. Only aggregate counts and status leave
 * the Worker; never send sensitive field names, strings or row contents.
 */
const MAX_GEOJSON_OUTPUT=24*1024*1024;
const MAX_ROWS=20000;
const result=(status,detail)=>({status,detail});
const comparableNumber=n=>Number.isFinite(n)&&
  ((Number.isInteger(n)&&Number.isSafeInteger(n))||
   (!Number.isInteger(n)&&Number(n.toPrecision(15))===n));

export async function inspectShpToGeojsonDbfFidelity(shpZipBytes,geojsonBytes){
 try {
  if(!(geojsonBytes instanceof Uint8Array)||geojsonBytes.length>MAX_GEOJSON_OUTPUT)
   throw Error('Output exceeds bounded GeoJSON inspection');
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(geojsonBytes));
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||
     data.features.length>MAX_ROWS)
   throw Error('Output GeoJSON features not inspectable');
  const dbf=await readUtf8ShapefileDbf(shpZipBytes);
  if(data.features.length!==dbf.count)
   return result('review','Shapefile DBF row count differs from exported GeoJSON features: '+
     dbf.count+' input → '+data.features.length+' output. Source values and field names are not included.');
  let compared=0,unsupported=0,mismatches=0,eligibleFields=0;
  for(const field of dbf.fields){
   if(!comparableDbfFieldName(field.name)||!['C','N','F','D','L'].includes(field.type)||
      dbf.ambiguousLowerNames.has(field.name.toLowerCase())){
    unsupported+=dbf.count;
    continue;
   }
   eligibleFields++;
   for(let row=0;row<dbf.count;row++){
    let source;
    try {source=readComparableDbfValue(dbf,row,field)}
    catch {unsupported++;continue}
    if(source.kind==='unsupported'||source.kind==='invalid'||source.kind==='null'||
       (source.kind==='number'&&!comparableNumber(source.value))||
       (source.kind==='text'&&source.value==='')){
     // DBF null/blank, invalid dates/logicals and unsafe precision are not certified.
     unsupported++;
     continue;
    }
    const feature=data.features[row],props=feature?.properties;
    if(!props||typeof props!=='object'||Array.isArray(props)){
     unsupported++;
     continue;
    }
    compared++;
    if(!Object.hasOwn(props,field.name)){
     mismatches++;
     continue;
    }
    const output=props[field.name];
    if(source.kind==='text'||source.kind==='date'){
     if(typeof output!=='string'||output!==source.value)mismatches++;
    }else if(source.kind==='boolean'){
     // Do not treat GDAL's 0/1 integer as the original DBF logical type.
     if(typeof output!=='boolean'||output!==source.value)mismatches++;
    }else{
     // Explicitly compare all safely representable numbers, including
     // high-magnitude integers. A relative threshold once permitted
     // silently changing integer values by one or more units.
     if(typeof output!=='number'||!Number.isFinite(output)||
       source.value!==output)mismatches++;
    }
   }
  }
  const info=dbf.count+' records, '+dbf.fields.length+' DBF fields; '+
    compared+' comparable values, '+unsupported+' unverified, '+
    mismatches+' mismatches. Private field names and values are excluded.';
  if(mismatches)return result('review','DBF-to-GeoJSON field/value loss detected: '+info);
  if(!compared)return result('unavailable','No safely comparable DBF fields/values: '+info);
  return result(unsupported?'unavailable':'pass',
    (unsupported?'Partial DBF-to-GeoJSON inspection: ':'DBF-to-GeoJSON eligible fields match: ')+info);
 }catch {
  return result('unavailable','Source DBF / exported GeoJSON could not be compared under strict UTF-8, field-type and inspection limits.');
 }
}
