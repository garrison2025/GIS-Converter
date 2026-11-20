import JSZip from 'jszip';

/**
 * P50 conservative independent attribute comparison for point-only
 * CSV/KML/KMZ/GeoJSON routes. The source & emitted bytes are inspected
 * separately from GDAL. Invalid/ambiguous representations are unavailable,
 * not certified. Confirmed loss of a safely comparable named field is review.
 *
 * No names, coordinates or field values are written to the report.
 */
const MAX_BYTES=12*1024*1024,MAX_ROWS=4000,MAX_FIELDS=64;
const TOL=0.000005;
const FORMATS=new Set(['csv','kml','kmz','geojson']);
const unavailable=message=>({status:'unavailable',detail:message});
const reject=()=>{throw Error('Unsupported or ambiguous attribute schema')};
const decoder=new TextDecoder('utf-8',{fatal:true});
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
const lonKeys=new Set(['longitude','lon','x']);
const latKeys=new Set(['latitude','lat','y']);
const utf8=bytes=>{
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)reject();
 return decoder.decode(bytes);
};
const point=(x,y)=>{
 const check=n=>typeof n==='number'?n:decimal.test(String(n??'').trim())?Number(String(n).trim()):NaN;
 const a=check(x),b=check(y);
 if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>180||Math.abs(b)>90)reject();
 return [a,b];
};
function properties(entries){
 if(entries.length>MAX_FIELDS)reject();
 const values=new Map(),folded=new Set();
 for(const [key,value] of entries){
  if(typeof key!=='string'||!key||key.length>160||values.has(key))reject();
  const lower=key.toLocaleLowerCase('en-US');
  if(folded.has(lower))reject();
  folded.add(lower);
  values.set(key,value);
 }
 return values;
}
const text=value=>({kind:'text',value});
function geojson(input){
 const data=JSON.parse(input);
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||
   !data.features.length||data.features.length>MAX_ROWS)reject();
 const crs=String(data.crs?.properties?.name||'').trim().toUpperCase();
 if(data.crs&&!new Set(['CRS84','OGC:CRS84','EPSG:4326',
 'URN:OGC:DEF:CRS:OGC:1.3:CRS84','URN:OGC:DEF:CRS:EPSG::4326']).has(crs))reject();
 return data.features.map(f=>{
  if(f?.geometry?.type!=='Point'||!Array.isArray(f.geometry.coordinates)||
     !f.properties||typeof f.properties!=='object'||Array.isArray(f.properties))reject();
  return {xy:point(f.geometry.coordinates[0],f.geometry.coordinates[1]),
   fields:properties(Object.entries(f.properties).map(([name,value])=>{
    if(value===null)return [name,{kind:'null',value:null}];
    if(typeof value==='string')return [name,text(value)];
    if(typeof value==='number')return [name,{kind:'number',value}];
    if(typeof value==='boolean')return [name,{kind:'boolean',value}];
    return [name,{kind:'unsupported',value:null}];
   }))};
 });
}
function csvRows(input){
 const rows=[],row=[];let value='',quoted=false,closed=false;
 const finishField=()=>{row.push(value);value='';closed=false;if(row.length>MAX_FIELDS+2)reject()};
 const finishRow=()=>{
  finishField();
  if(!(row.length===1&&row[0]===''))rows.push(row.slice());
  row.length=0;
  if(rows.length>MAX_ROWS+1)reject();
 };
 const source=input.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(quoted){
   if(char==='"'){
    if(source[i+1]==='"'){value+='"';i++}
    else{quoted=false;closed=true}
   }else value+=char;
  }else if(closed){
   if(char===',')finishField();
   else if(char==='\r'||char==='\n'){
    if(char==='\r'&&source[i+1]==='\n')i++;
    finishRow();
   }else reject();
  }else if(char==='"'&&value==='')quoted=true;
  else if(char===',')finishField();
  else if(char==='\r'||char==='\n'){
   if(char==='\r'&&source[i+1]==='\n')i++;
   finishRow();
  }else if(char==='"')reject();
  else value+=char;
  if(value.length>65536)reject();
 }
 if(quoted)reject();
 if(value!==''||row.length||closed)finishRow();
 if(rows.length<2)reject();
 return rows;
}
function csv(input){
 const rows=csvRows(input);
 const header=rows.shift();
 if(header.some(n=>!n.trim()))reject();
 const low=header.map(n=>n.trim().toLocaleLowerCase('en-US'));
 if(new Set(low).size!==low.length)reject();
 const xs=low.flatMap((v,i)=>lonKeys.has(v)?[i]:[]);
 const ys=low.flatMap((v,i)=>latKeys.has(v)?[i]:[]);
 if(xs.length!==1||ys.length!==1||xs[0]===ys[0])reject();
 return rows.map(row=>{
  if(row.length!==header.length)reject();
  const fields=properties(header.flatMap((name,i)=>
    i===xs[0]||i===ys[0]?[]:[[name,text(row[i])]]));
  return {xy:point(row[xs[0]],row[ys[0]]),fields};
 });
}
function xmlText(raw){
 if(raw.includes('<'))reject();
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 const encoded=/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
 const rest=raw.replace(encoded,'');
 if(rest.includes('&'))reject();
 const result=raw.replace(encoded,(_all,key)=>{
  if(key[0]!=='#')return entities[key];
  const cp=key[1].toLowerCase()==='x'?
    Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10);
  if(!Number.isInteger(cp)||cp===0||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))reject();
  return String.fromCodePoint(cp);
 });
 return result;
}
function attr(tag,key){
 const m=tag.match(new RegExp('(?:^|\\s)'+key+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)','i'));
 return m?xmlText(m[1]??m[2]):null;
}
function kml(input){
 if(!/<(?:[\w.-]+:)?kml\b/i.test(input)||/<!DOCTYPE\b|<!ENTITY\b|<!\[CDATA\[|<!--/i.test(input))reject();
 const placemarks=[...input.matchAll(/<(?:[\w.-]+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Placemark\s*>/gi)];
 if(!placemarks.length||placemarks.length>MAX_ROWS)reject();
 return placemarks.map(match=>{
  const body=match[1];
  if(/<(?:[\w.-]+:)?(?:LineString|Polygon|MultiGeometry|Track|Model)\b/i.test(body))reject();
  const pts=[...body.matchAll(/<(?:[\w.-]+:)?Point\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Point\s*>/gi)];
  if(pts.length!==1)reject();
  const cs=[...pts[0][1].matchAll(/<(?:[\w.-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?coordinates\s*>/gi)];
  if(cs.length!==1)reject();
  const tuples=xmlText(cs[0][1]).trim().split(/\s+/);
  if(tuples.length!==1)reject();
  const xyz=tuples[0].split(',');
  if(xyz.length<2||xyz.length>3)reject();
  const entries=[];
  // KML Placemark name is ordinarily exported as a 'Name' attribute.
  const name=body.match(/<(?:[\w.-]+:)?name(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?name\s*>/i);
  if(name)entries.push(['Name',text(xmlText(name[1]))]);
  // OGR KML and LIBKML may serialize attributes in either form.
  for(const d of body.matchAll(/<(?:[\w.-]+:)?Data\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Data\s*>/gi)){
   const field=attr(d[1],'name');
   if(!field)reject();
   const v=[...d[2].matchAll(/<(?:[\w.-]+:)?value\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?value\s*>/gi)];
   if(v.length!==1)reject();
   entries.push([field,text(xmlText(v[0][1]))]);
  }
  for(const s of body.matchAll(/<(?:[\w.-]+:)?SimpleData\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?SimpleData\s*>/gi)){
   const field=attr(s[1],'name');
   if(!field)reject();
   entries.push([field,text(xmlText(s[2]))]);
  }
  // Name may also occur in ExtendedData; identical aliases cannot be
  // independently attributed, so do not certify or reject them.
  return {xy:point(xyz[0],xyz[1]),fields:properties(entries)};
 });
}
async function read(bytes,format){
 let source=bytes;
 if(format==='kmz'){
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)reject();
  const zip=await JSZip.loadAsync(bytes);
  const files=Object.keys(zip.files).filter(x=>!zip.files[x].dir&&x.toLowerCase().endsWith('.kml'));
  if(files.length!==1)reject();
  const entry=zip.file(files[0]);
  if((entry?._data?.uncompressedSize??Infinity)>MAX_BYTES)reject();
  source=await entry.async('uint8array');
  format='kml';
 }
 const input=utf8(source);
 if(format==='geojson')return geojson(input);
 if(format==='csv')return csv(input);
 if(format==='kml')return kml(input);
 reject();
}
const bin=n=>Math.floor(n/TOL);
const key=(x,y)=>x+','+y;
function matchRows(before,after){
 if(before.length!==after.length)return null;
 const lookup=new Map(),used=new Set(),pairs=[];
 after.forEach((row,i)=>{
  const [x,y]=row.xy.map(bin),k=key(x,y);
  if(!lookup.has(k))lookup.set(k,[]);
  lookup.get(k).push(i);
 });
 for(const source of before){
  const [x,y]=source.xy.map(bin),candidates=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   for(const i of lookup.get(key(x+dx,y+dy))||[]){
    const target=after[i].xy;
    if(!used.has(i)&&Math.abs(target[0]-source.xy[0])<=TOL&&
      Math.abs(target[1]-source.xy[1])<=TOL)candidates.push(i);
   }
  }
  if(candidates.length!==1)return null;
  used.add(candidates[0]);pairs.push([source,after[candidates[0]]]);
 }
 return used.size===after.length?pairs:null;
}
function safeNumber(n){
 return typeof n==='number'&&Number.isFinite(n)&&
  (Number.isSafeInteger(n)||(!Number.isInteger(n)&&Number(n.toPrecision(15))===n));
}
export function compareComparableAttributeValues(source,target){
 if(source.kind==='unsupported'||source.kind==='null')return 'unavailable';
 if(source.kind==='text'&&!source.value)return 'unavailable';
 if(source.kind==='number'&&!safeNumber(source.value))return 'unavailable';
 if(target.kind==='null'||target.kind==='unsupported'||target.value===null)return 'unavailable';
 if(source.kind===target.kind)return source.value===target.value?'pass':'review';
 if(source.kind==='text'&&target.kind==='number'){
  if(!safeNumber(target.value))return 'unavailable';
  return String(target.value)===source.value?'unavailable':'review';
 }
 if(source.kind==='number'&&target.kind==='text'){
  if(!decimal.test(target.value.trim()))return 'review';
  const n=Number(target.value.trim());
  if(!safeNumber(n))return 'unavailable';
  return n===source.value?'unavailable':'review';
 }
 if(source.kind==='boolean'&&target.kind==='text'){
  const val=target.value.toLowerCase();
  if([source.value?'true':'false',source.value?'1':'0'].includes(val))
   return 'unavailable';
  return 'review';
 }
 return 'unavailable';
}
export async function inspectCrossFormatAttributeFidelity(inputBytes,sourceFormat,outputBytes,targetFormat){
 if(!FORMATS.has(sourceFormat)||!FORMATS.has(targetFormat)||sourceFormat===targetFormat)
  return unavailable('Cross-format field inspection is not applicable for this route.');
 try{
  const [before,after]=await Promise.all([read(inputBytes,sourceFormat),read(outputBytes,targetFormat)]);
  const pairs=matchRows(before,after);
  if(!pairs)return unavailable('Point attributes cannot be safely paired one-to-one from original and output WGS84 coordinates.');
  let compared=0,uncertain=0,mismatches=0,fields=0;
  for(const [source,target] of pairs){
   for(const [name,value] of source.fields){
    fields++;
    if(!target.fields.has(name)){
     // If a casefold alias is present, mapping can be ambiguous in
     // the destination driver, not a defensible confirmed mismatch.
     const aliases=[...target.fields.keys()].filter(k=>k.toLowerCase()===name.toLowerCase());
     if(aliases.length){uncertain++;continue}
     if(value.kind==='unsupported'||value.kind==='null'||value.value===''){
      uncertain++;continue;
     }
     mismatches++;continue;
    }
    const status=compareComparableAttributeValues(value,target.fields.get(name));
    if(status==='pass')compared++;
    else if(status==='review')mismatches++;
    else uncertain++;
   }
  }
  const summary=before.length+' point records, '+fields+' original attribute cells; '+
   compared+' exact compatible matches, '+uncertain+' not safely comparable, '+
   mismatches+' confirmed changed/missing values. Private field names, values and XY are excluded.';
  if(mismatches)return {status:'review',detail:'Cross-format attribute loss detected: '+summary};
  if(!compared)return unavailable('No independently certifiable cross-format fields: '+summary);
  return {status:uncertain?'unavailable':'pass',
   detail:(uncertain?'Cross-format attribute comparison is partial: ':'Comparable cross-format attributes agree: ')+summary};
 }catch{
  return unavailable('Cross-format attribute inspection unavailable for unsupported text, schema, point geometry, encoding, metadata or memory limits. No fidelity certification is implied.');
 }
}
