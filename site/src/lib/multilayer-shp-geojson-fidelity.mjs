import JSZip from 'jszip';
import {readUtf8ShapefileDbf,readComparableDbfValue,comparableDbfFieldName}
 from './dbf-fidelity.mjs';

/**
 * P60: conservative, independent multi-layer Point SHP -> GeoJSON DBF
 * identity validation. Row order may change and layers may merge, so pair
 * *uniquely matching real XY coordinates*, never coincident row indexes.
 *
 * This is NOT general layer association for lines/polygons, CRS transforms,
 * Z/M, duplicated points or ambiguous schemas. The caller must first have
 * passed P59's full-package structural checks. Unsupported cases are never
 * represented as passes. Only counts/status leave the conversion Worker.
 */
const MAX_BYTES=15*1024*1024,MAX_ROWS=300,MAX_LAYERS=8;
const TOL=0.000005; // Same tolerance as P39 real WGS84 point check
const fail=()=>{throw Error('Multi-layer point field pairing not safely inspectable')};
const unavailable=()=>({status:'unavailable',detail:
 'Multi-layer SHP DBF/GeoJSON attribute association is not independently verifiable for ambiguous geometry, schema, encoding, CRS, or size.'});
const result=(status,detail)=>({status,detail});
const near=(a,b)=>Math.abs(a[0]-b[0])<=TOL&&Math.abs(a[1]-b[1])<=TOL;
const comparableNumber=n=>Number.isFinite(n)&&
 ((Number.isInteger(n)&&Number.isSafeInteger(n))||
  (!Number.isInteger(n)&&Number(n.toPrecision(15))===n));
function point(x,y){
 if(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||
    !Number.isFinite(y)||Math.abs(x)>180||Math.abs(y)>90)fail();
 return [x,y];
}
function geojsonRows(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_BYTES)fail();
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||
    data.features.length<1||data.features.length>MAX_ROWS)fail();
 const crs=String(data.crs?.properties?.name||'').toUpperCase();
 if(data.crs&&!(data.crs.type==='name'&&new Set([
  'CRS84','OGC:CRS84','URN:OGC:DEF:CRS:OGC:1.3:CRS84',
  'EPSG:4326','URN:OGC:DEF:CRS:EPSG::4326',
  'URN:OGC:DEF:CRS:EPSG:6.6:4326']).has(crs)))fail();
 return data.features.map(f=>{
  if(f?.geometry?.type!=='Point'||!Array.isArray(f.geometry.coordinates)||
     !f.properties||typeof f.properties!=='object'||
     Array.isArray(f.properties))fail();
  const p=f.geometry.coordinates;
  return {xy:point(p[0],p[1]),props:f.properties};
 });
}
async function sourceRows(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_BYTES)fail();
 const archive=await JSZip.loadAsync(bytes);
 const names=Object.keys(archive.files).filter(n=>!archive.files[n].dir);
 const shpNames=names.filter(n=>n.toLowerCase().endsWith('.shp'));
 if(shpNames.length<2||shpNames.length>MAX_LAYERS||names.length>48)fail();
 let sum=0;
 const entries=names.map(n=>[n.toLowerCase(),archive.file(n)]);
 if(new Set(entries.map(([n])=>n)).size!==entries.length)fail();
 const files=new Map(entries);
 const rows=[];
 for(const name of shpNames){
  const stem=name.slice(0,-4).toLowerCase();
  const [shpFile,shxFile,dbfFile,cpgFile,prjFile]=
   ['shp','shx','dbf','cpg','prj'].map(ext=>files.get(stem+'.'+ext));
  if([shpFile,shxFile,dbfFile,cpgFile,prjFile].some(x=>!x))fail();
  const parts=[shpFile,shxFile,dbfFile,cpgFile,prjFile];
  const sizes=parts.map(x=>x?._data?.uncompressedSize??Infinity);
  sum+=sizes.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(sum)||sum>MAX_BYTES||sizes.some(x=>!Number.isFinite(x)))fail();
  const [shp,shx,dbf,cpg,prj]=await Promise.all([
   shpFile.async('uint8array'),shxFile.async('uint8array'),
   dbfFile.async('uint8array'),cpgFile.async('uint8array'),
   prjFile.async('string')
  ]);
  if(/PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/i.test(prj)||
    !/WGS[\s_-]*(?:84|1984)|GCS_WGS_1984/i.test(prj))fail();
  if(shp.length<100||shx.length<100||(shx.length-100)%8)fail();
  const s=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
  const x=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
  if(s.getUint32(0,false)!==9994||x.getUint32(0,false)!==9994||
    s.getUint32(28,true)!==1000||x.getUint32(28,true)!==1000||
    s.getUint32(24,false)*2!==shp.length||
    x.getUint32(24,false)*2!==shx.length||
    s.getInt32(32,true)!==1||x.getInt32(32,true)!==1)fail();
  const mini=new JSZip();
  mini.file('layer.dbf',dbf);mini.file('layer.cpg',cpg);
  const table=await readUtf8ShapefileDbf(
   new Uint8Array(await mini.generateAsync({type:'uint8array'})));
  const count=(shx.length-100)/8;
  if(count!==table.count||rows.length+count>MAX_ROWS)fail();
  for(let i=0;i<count;i++){
   const indexed=100+i*8,at=x.getUint32(indexed,false)*2;
   const words=x.getUint32(indexed+4,false);
   if(words!==10||at<100||at+28>shp.length||
     s.getUint32(at,false)!==i+1||s.getUint32(at+4,false)!==10||
     s.getInt32(at+8,true)!==1)fail();
   const xy=point(s.getFloat64(at+12,true),s.getFloat64(at+20,true));
   rows.push({xy,dbf:table,row:i});
  }
 }
 return rows;
}
function pairRows(before,after){
 if(before.length!==after.length)return {status:'review',matches:null};
 if(before.some(({xy})=>Math.abs(Math.abs(xy[0])-180)<=4*TOL)||
    after.some(({xy})=>Math.abs(Math.abs(xy[0])-180)<=4*TOL))
  return {status:'unavailable',matches:null};
 // A unique association must exist before checking any attributes. A greedy
 // positional mapping could falsely block otherwise valid reordered layers.
 const pairs=[],used=new Set();
 for(let i=0;i<before.length;i++){
  const matches=after.flatMap(({xy},j)=>near(before[i].xy,xy)?[j]:[]);
  if(matches.length===0)return {status:'review',matches:null};
  if(matches.length!==1||used.has(matches[0]))
   return {status:'unavailable',matches:null};
  used.add(matches[0]);pairs.push(matches[0]);
 }
 if(used.size!==after.length)return {status:'review',matches:null};
 return {status:'pass',matches:pairs};
}
export async function inspectMultiLayerPointShpGeojsonFidelity(shpBytes,geojsonBytes){
 try{
  const [before,after]=await Promise.all([
   sourceRows(shpBytes),Promise.resolve(geojsonRows(geojsonBytes))
  ]);
  const pair=pairRows(before,after);
  if(pair.status==='unavailable')return unavailable();
  if(pair.status==='review')return result('review',
   'Multi-layer SHP WGS84 point geometry association or feature count differs from exported GeoJSON.');
  let compared=0,unverified=0,mismatches=0;
  for(let i=0;i<before.length;i++){
   const {dbf,row}=before[i],props=after[pair.matches[i]].props;
   for(const field of dbf.fields){
    if(!comparableDbfFieldName(field.name)||
       dbf.ambiguousLowerNames.has(field.name.toLowerCase())||
       !['C','N','F','D','L'].includes(field.type)){
     unverified++;continue;
    }
    let source;
    try{source=readComparableDbfValue(dbf,row,field)}
    catch{unverified++;continue;}
    if(source.kind==='unsupported'||source.kind==='invalid'||
       source.kind==='null'||
       (source.kind==='text'&&source.value==='')||
       (source.kind==='number'&&!comparableNumber(source.value))){
     unverified++;continue;
    }
    compared++;
    if(!Object.hasOwn(props,field.name)){mismatches++;continue;}
    const value=props[field.name];
    if(source.kind==='number'){
     if(typeof value!=='number'||!Number.isFinite(value)||
        value!==source.value)mismatches++;
    }else if(source.kind==='boolean'){
     if(typeof value!=='boolean'||value!==source.value)mismatches++;
    }else if(typeof value!=='string'||value!==source.value)mismatches++;
   }
  }
  const detail=before.length+' point records associated uniquely across multiple SHP layers; '+
   compared+' comparable DBF values, '+unverified+' unverified, '+
   mismatches+' confirmed field/value mismatches. No private coordinates, field names or values included.';
  if(mismatches)return result('review','Multi-layer SHP attribute loss detected: '+detail);
  if(!compared)return result('unavailable','No safely comparable multi-layer DBF values: '+detail);
  return result(unverified?'unavailable':'pass',
   (unverified?'Partial multi-layer DBF verification: ':
    'Multi-layer SHP point fields match GeoJSON by unique geometry: ')+detail);
 }catch{return unavailable();}
}
