import JSZip from 'jszip';

/**
 * Independent, bounded DBF record inspection. This runs locally in the GIS
 * conversion Worker; the report includes counts only, never source field
 * names or values. A review represents definite loss on comparable fields.
 * Unsupported types/schema encodings remain unavailable, not certified.
 */
const MAX_GEOJSON_BYTES=15*1024*1024;
const MAX_DBF_BYTES=24*1024*1024;
const MAX_ROWS=20000;
const MAX_FIELDS=128;
const safeName=name=>/^[A-Za-z_][A-Za-z0-9_]{0,9}$/.test(name);
const fail=message=>{throw new Error(message)};
const status=(state,reason)=>({status:state,detail:reason});
const textDecoder=new TextDecoder('utf-8',{fatal:true});
const ascii=bytes=>String.fromCharCode(...bytes);
function parseDbf(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes.length>MAX_DBF_BYTES)fail('DBF length outside inspection limits');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const count=view.getUint32(4,true),headerLength=view.getUint16(8,true),recordLength=view.getUint16(10,true);
 if(count>MAX_ROWS||headerLength<33||headerLength>bytes.length||recordLength<1)fail('DBF header limits exceeded');
 const numberFields=(headerLength-33)/32;
 if(!Number.isInteger(numberFields)||numberFields>MAX_FIELDS||bytes[headerLength-1]!==0x0d)
  fail('DBF field descriptors are not supported');
 if(headerLength+count*recordLength>bytes.length)fail('DBF records exceed file size');
 const fields=[];
 let position=1;
 for(let i=0;i<numberFields;i++){
  const base=32+i*32;
  const raw=bytes.subarray(base,base+11),nul=raw.indexOf(0);
  const name=ascii(nul<0?raw:raw.subarray(0,nul)).trim();
  const type=String.fromCharCode(bytes[base+11]);
  const width=bytes[base+16],decimal=bytes[base+17];
  if(!name||!width||decimal>width||position+width>recordLength)
   fail('DBF field width invalid');
  fields.push({name,type,width,decimal,offset:position});
  position+=width;
 }
 if(position!==recordLength)fail('DBF record width does not match field descriptors');
 const lookup=new Map();
 for(const field of fields){
  if(lookup.has(field.name))fail('DBF has duplicate field names');
  lookup.set(field.name,field);
 }
 for(let row=0;row<count;row++){
  if(bytes[headerLength+row*recordLength]!==0x20)fail('DBF deleted or nonstandard record');
 }
 return {bytes,count,headerLength,recordLength,fields,lookup};
}
function readValue(dbf,row,field){
 const start=dbf.headerLength+row*dbf.recordLength+field.offset;
 const bytes=dbf.bytes.subarray(start,start+field.width);
 if(field.type==='C')return {kind:'text',value:textDecoder.decode(bytes).replace(/ +$/g,'')};
 if(field.type==='N'||field.type==='F'){
  const raw=ascii(bytes).trim();
  if(!raw||raw==='?' )return {kind:'null',value:null};
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw))
   return {kind:'invalid',value:null};
  const num=Number(raw);
  return Number.isFinite(num)?{kind:'number',value:num}:{kind:'invalid',value:null};
 }
 return {kind:'unsupported',value:null};
}
function collectExpected(features){
 const keys=new Map(),rows=features.length;
 if(rows===0||rows>MAX_ROWS)fail('GeoJSON feature count outside bounded inspection');
 for(const feature of features){
  const p=feature?.properties;
  if(!p||typeof p!=='object'||Array.isArray(p))fail('Unsupported GeoJSON properties');
  for(const [key,val] of Object.entries(p)){
   if(!keys.has(key))keys.set(key,0);
   keys.set(key,keys.get(key)+1);
   if(keys.size>MAX_FIELDS)fail('Too many input fields for bounded inspection');
  }
 }
 return {keys,rows};
}
export async function inspectGeojsonToShpDbfFidelity(inputBytes,shpZipBytes) {
 try{
  if(!(inputBytes instanceof Uint8Array)||inputBytes.length>MAX_GEOJSON_BYTES)
   fail('Input exceeds 15 MiB inspection cap');
  const input=JSON.parse(textDecoder.decode(inputBytes));
  if(input?.type!=='FeatureCollection'||!Array.isArray(input.features))
   fail('Input is not a GeoJSON FeatureCollection');
  const {keys,rows}=collectExpected(input.features);
  if(!(shpZipBytes instanceof Uint8Array)||shpZipBytes.length>MAX_DBF_BYTES)
   fail('Shapefile archive exceeds inspection cap');
  const zip=await JSZip.loadAsync(shpZipBytes);
  const names=Object.keys(zip.files).filter(name=>!zip.files[name].dir);
  const dbfNames=names.filter(name=>name.toLowerCase().endsWith('.dbf'));
  if(dbfNames.length!==1)fail('Exactly one DBF is required');
  const dbfFile=zip.file(dbfNames[0]);
  if(!dbfFile||(dbfFile._data?.uncompressedSize??Infinity)>MAX_DBF_BYTES)
   fail('DBF entry exceeds inspection cap');
  const cpgName=names.find(name=>name.toLowerCase()===dbfNames[0].slice(0,-4).toLowerCase()+'.cpg');
  const cpgFile=cpgName?zip.file(cpgName):null;
  if(!cpgFile||(cpgFile._data?.uncompressedSize??Infinity)>1024)
   fail('DBF UTF-8 encoding marker unavailable');
  const cpg=(await cpgFile.async('string')).trim().toUpperCase().replace(/[-_]/g,'');
  if(cpg!=='UTF8'&&cpg!=='65001')fail('DBF character encoding is not verified as UTF-8');
  const dbf=parseDbf(await dbfFile.async('uint8array'));
  if(dbf.count!==rows)return status('review','DBF record count differs from source GeoJSON: '+rows+' input → '+dbf.count+' output.');
  let compared=0,unavailable=0,mismatches=0,eligibleFields=0;
  for(const [name,present] of keys){
   if(!safeName(name)||present!==rows){unavailable+=rows;continue}
   const field=dbf.lookup.get(name);
   const values=input.features.map(feature=>feature.properties[name]);
   const comparable=values.map(value=>{
    if(typeof value==='string')return {kind:'text',value};
    if(typeof value==='number'&&Number.isFinite(value)&&Number.isSafeInteger(value))return {kind:'number',value};
    if(typeof value==='number'&&Number.isFinite(value)&&!Number.isInteger(value)&&Number(value.toPrecision(15))===value)
     return {kind:'number',value};
    return null;
   });
   const n=comparable.filter(Boolean).length;
   unavailable+=rows-n;
   if(!n)continue;
   if(!field){mismatches+=n;continue}
   eligibleFields++;
   if(!['C','N','F'].includes(field.type)){unavailable+=n;continue}
   for(let row=0;row<rows;row++){
    const source=comparable[row];
    if(!source)continue;
    compared++;
    let target;
    try{target=readValue(dbf,row,field)}
    catch{unavailable++;compared--;continue}
    if(target.kind==='unsupported'){unavailable++;compared--;continue}
    if(source.kind!==target.kind){mismatches++;continue}
    if(source.kind==='text'){
     if(source.value!==target.value)mismatches++;
    }else{
     // Bound to 1e-10 absolute, 1e-12 relative. A greater difference on
     // a finite source number is a detectable precision change.
     const tolerance=Math.max(1e-10,Math.abs(source.value)*1e-12);
     if(Math.abs(source.value-target.value)>tolerance)mismatches++;
    }
   }
  }
  const summary=rows+' records, '+keys.size+' source fields; '+compared+
    ' comparable values checked, '+unavailable+' not independently comparable, '+
    mismatches+' confirmed mismatches. Source values and field names are excluded from this report.';
  if(mismatches)return status('review','DBF field name or value loss detected: '+summary);
  if(!compared)return status('unavailable','No safely comparable DBF fields/values: '+summary);
  return status(unavailable?'unavailable':'pass',
    (unavailable?'DBF comparison is partial: ':'DBF independently comparable fields match: ')+summary);
 }catch{
  return status('unavailable','Independent DBF comparison could not safely inspect the output within supported UTF-8, schema, row and size limits.');
 }
}
