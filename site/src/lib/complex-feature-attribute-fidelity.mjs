import JSZip from 'jszip';
import {pairComplexFeatureRows} from './complex-geometry-fidelity.mjs';
import {readUtf8ShapefileDbf,readComparableDbfValue,comparableDbfFieldName} from './dbf-fidelity.mjs';
import {compareComparableAttributeValues} from './cross-format-attribute-fidelity.mjs';

/**
 * P51: link independently parsed named attributes to their OWN complex
 * LineString/Polygon/Multi* geometry, never to positional feature order.
 * Requires unique exact 2D WGS84 geometry matching, not just matching bboxes.
 *
 * All private field names, attribute values and geometries stay in Worker
 * memory. Only aggregate counts/status are returned in the quality report.
 */
const MAX_BYTES=12*1024*1024,MAX_RECORDS=300,MAX_FIELDS=64;
const formats=new Set(['geojson','kml','kmz','shp']);
const fail=()=>{throw Error('Unsupported or ambiguous complex GIS attributes')};
const unavailable=detail=>({status:'unavailable',detail});
const decoder=new TextDecoder('utf-8',{fatal:true});
function decode(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)fail();
 return decoder.decode(bytes);
}
const comparable=value=>{
 if(value===null)return {kind:'null',value:null};
 if(typeof value==='string')return {kind:'text',value};
 if(typeof value==='number')return {kind:'number',value};
 if(typeof value==='boolean')return {kind:'boolean',value};
 return {kind:'unsupported',value:null};
};
function fields(entries){
 if(entries.length>MAX_FIELDS)fail();
 const map=new Map(),casefold=new Set();
 for(const [name,value] of entries){
  if(typeof name!=='string'||!name||name.length>160||map.has(name))fail();
  const lower=name.toLocaleLowerCase('en-US');
  if(casefold.has(lower))fail();
  casefold.add(lower);
  map.set(name,value);
 }
 return map;
}
function geojson(bytes){
 const data=JSON.parse(decode(bytes));
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||
  !data.features.length||data.features.length>MAX_RECORDS)fail();
 return data.features.map(feature=>{
  const props=feature?.properties;
  if(!props||typeof props!=='object'||Array.isArray(props))fail();
  return fields(Object.entries(props).map(([k,v])=>[k,comparable(v)]));
 });
}
function xmlText(raw){
 if(raw.includes('<'))fail();
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 const encoded=/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
 if(raw.replace(encoded,'').includes('&'))fail();
 return raw.replace(encoded,(_all,key)=>{
  if(key[0]!=='#')return entities[key];
  const cp=key[1].toLowerCase()==='x'?
   Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10);
  if(!Number.isInteger(cp)||cp===0||cp>0x10ffff||
    (cp>=0xd800&&cp<=0xdfff))fail();
  return String.fromCodePoint(cp);
 });
}
function attribute(tag,key){
 const pattern=new RegExp('(?:^|\\s)'+key+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)','i');
 const found=tag.match(pattern);
 return found?xmlText(found[1]??found[2]):null;
}
function kmlText(text){
 if(/<!DOCTYPE\b|<!ENTITY\b|<!\[CDATA\[|<!--/i.test(text)||
  !/<(?:[\w.-]+:)?kml\b/i.test(text))fail();
 const matches=[...text.matchAll(/<(?:[\w.-]+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Placemark\s*>/gi)];
 if(!matches.length||matches.length>MAX_RECORDS)fail();
 return matches.map(match=>{
  const body=match[1],found=[];
  const extended=[...body.matchAll(/<(?:[\w.-]+:)?ExtendedData\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?ExtendedData\s*>/gi)];
  if(extended.length>1)fail();
  const outside=body.replace(/<(?:[\w.-]+:)?ExtendedData\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?ExtendedData\s*>/gi,'');
  const placemarkName=outside.match(/<(?:[\w.-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?name\s*>/i);
  if(placemarkName)found.push(['Name',{kind:'text',value:xmlText(placemarkName[1])}]);
  if(extended.length){
   const src=extended[0][1];
   for(const item of src.matchAll(/<(?:[\w.-]+:)?Data\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Data\s*>/gi)){
    const name=attribute(item[1],'name');
    const values=[...item[2].matchAll(/<(?:[\w.-]+:)?value\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?value\s*>/gi)];
    if(!name||values.length!==1)fail();
    found.push([name,{kind:'text',value:xmlText(values[0][1])}]);
   }
   for(const item of src.matchAll(/<(?:[\w.-]+:)?SimpleData\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?SimpleData\s*>/gi)){
    const name=attribute(item[1],'name');
    if(!name)fail();
    found.push([name,{kind:'text',value:xmlText(item[2])}]);
   }
  }
  return fields(found);
 });
}
/**
 * P53: expose the same bounded, strict XML attribute reader to the in-browser
 * KML→GeoJSON repair path. This is private Worker-only data; never serialized
 * into test reports or sent to a server. Invalid/ambiguous XML returns null.
 */
export function readKmlComplexAttributeRows(bytes){
 try{return kmlText(decode(bytes))}
 catch{return null}
}
async function kml(bytes,format){
 if(format==='kml')return kmlText(decode(bytes));
 if(bytes.length>MAX_BYTES)fail();
 const archive=await JSZip.loadAsync(bytes);
 const names=Object.keys(archive.files).filter(n=>!archive.files[n].dir&&n.toLowerCase().endsWith('.kml'));
 if(names.length!==1||names[0]!=='doc.kml')fail();
 const entry=archive.file('doc.kml');
 if((entry?._data?.uncompressedSize??Infinity)>MAX_BYTES)fail();
 return kmlText(decode(await entry.async('uint8array')));
}
async function shp(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)fail();
 const archive=await JSZip.loadAsync(bytes);
 const names=Object.keys(archive.files).filter(n=>!archive.files[n].dir);
 if(names.length>48)fail();
 const related=/\\.(?:shp|shx|dbf|prj|cpg)$/i,files=new Map();
 for(const name of names){
  if(!related.test(name))continue;
  const key=name.toLowerCase();
  if(files.has(key))fail();
  files.set(key,archive.file(name));
 }
 const stems=[...files.keys()].filter(n=>n.endsWith('.shp'))
  .map(n=>n.slice(0,-4)).sort();
 if(!stems.length||stems.length>8)fail();
 const known=new Set(stems);
 for(const key of files.keys()){
  const stem=key.replace(/\\.(?:shp|shx|dbf|prj|cpg)$/,'');
  if(!known.has(stem))fail();
 }
 let inflated=0;
 for(const file of files.values()){
  const size=file?._data?.uncompressedSize;
  if(!Number.isFinite(size)||size<0)fail();
  inflated+=size;
  if(inflated>MAX_BYTES)fail();
 }
 const records=[];
 for(const stem of stems){
  const shpFile=files.get(stem+'.shp'),shxFile=files.get(stem+'.shx'),
   dbfFile=files.get(stem+'.dbf'),cpgFile=files.get(stem+'.cpg'),
   prjFile=files.get(stem+'.prj');
  if(!shpFile||!shxFile||!dbfFile||!cpgFile||!prjFile)fail();
  const [shx,cpg]=await Promise.all([
   shxFile.async('uint8array'),cpgFile.async('string')
  ]);
  if(shx.length<100||(shx.length-100)%8)fail();
  const index=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
  const count=(shx.length-100)/8;
  if(index.getUint32(0,false)!==9994||index.getUint32(28,true)!==1000||
    index.getUint32(24,false)*2!==shx.length)fail();
  const mini=new JSZip();
  mini.file('layer.dbf',await dbfFile.async('uint8array'));
  mini.file('layer.cpg',cpg);
  const dbf=await readUtf8ShapefileDbf(
   new Uint8Array(await mini.generateAsync({type:'uint8array',compression:'STORE'})));
  if(dbf.count!==count||dbf.count<1||records.length+dbf.count>MAX_RECORDS||
   dbf.fields.length>MAX_FIELDS||dbf.ambiguousLowerNames.size)fail();
  for(let row=0;row<dbf.count;row++){
   const entries=[];
   for(const field of dbf.fields){
    let value;
    try{value=readComparableDbfValue(dbf,row,field)}
    catch{value={kind:'unsupported',value:null}}
    entries.push([field.name,value]);
   }
   records.push(fields(entries));
  }
 }
 return records;
}
async function read(bytes,format){
 if(format==='geojson')return geojson(bytes);
 if(format==='kml'||format==='kmz')return kml(bytes,format);
 if(format==='shp')return shp(bytes);
 fail();
}
function safeSource(name,value,targetFormat){
 if(targetFormat==='shp'&&!comparableDbfFieldName(name))return false;
 if(value.kind==='unsupported'||value.kind==='invalid'||value.kind==='null')return false;
 if(value.kind==='text'&&value.value==='')return false;
 return true;
}
function valueStatus(a,b){
 if(a.kind==='date'&&b.kind==='text'){
  // Date-only strings preserved literally, but cannot prove date type.
  return a.value===b.value?'unavailable':'review';
 }
 if(a.kind==='date'&&b.kind==='date')return a.value===b.value?'pass':'review';
 return compareComparableAttributeValues(a,b);
}
export async function inspectComplexFeatureAttributeFidelity(inputBytes,sourceFormat,outputBytes,targetFormat){
 if(!formats.has(sourceFormat)||!formats.has(targetFormat)||sourceFormat===targetFormat)
  return unavailable('Complex attribute inspection requires supported cross-format GIS geometry.');
 try{
  // P40 compares actual 2D XY vertices, polygon shells/holes and multipart
  // components. Do not associate rows if two shapes are identical or a
  // conversion has changed their geometry so correspondence is uncertain.
  const linked=await pairComplexFeatureRows(inputBytes,sourceFormat,outputBytes,targetFormat);
  if(!linked||linked.records>MAX_RECORDS)
   return unavailable('Complex feature attributes cannot be paired by unique, unchanged WGS84 line/polygon geometry.');
  const [original,exported]=await Promise.all([
   read(inputBytes,sourceFormat),read(outputBytes,targetFormat)
  ]);
  if(original.length!==linked.records||exported.length!==linked.records)fail();
  let compared=0,uncertain=0,mismatches=0,cells=0;
  for(const [i,j] of linked.pairs){
   const source=original[i],target=exported[j];
   for(const [name,val] of source){
    cells++;
    if(!safeSource(name,val,targetFormat)){uncertain++;continue}
    if(!target.has(name)){
     const aliases=[...target.keys()].filter(key=>key.toLowerCase()===name.toLowerCase());
     if(aliases.length)uncertain++;
     else mismatches++;
     continue;
    }
    const result=valueStatus(val,target.get(name));
    if(result==='pass')compared++;
    else if(result==='review')mismatches++;
    else uncertain++;
   }
  }
  const description=linked.records+' uniquely matched complex GIS features, '+cells+
   ' source cells; '+compared+' exactly comparable, '+uncertain+
   ' uncertain, '+mismatches+' confirmed missing or changed. Private fields and geometries are omitted.';
  if(mismatches)return {status:'review',detail:'Complex GIS feature-to-attribute association loss: '+description};
  if(!compared)return unavailable('Complex features linked but no attribute cells can be fully certified: '+description);
  return {status:uncertain?'unavailable':'pass',
   detail:(uncertain?'Partial complex feature attribute validation: ':
    'Independently linked geometry attributes agree: ')+description};
 }catch{
  return unavailable('Independent complex attribute check unavailable within strict WGS84, geometry, schema, encoding or memory limits. Nothing is certified.');
 }
}
