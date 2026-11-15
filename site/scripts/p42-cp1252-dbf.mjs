import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {File} from 'node:buffer';
import {repairLegacyShpGeojson} from '../src/lib/legacy-shapefile-text.mjs';
const enc=new TextEncoder();
const fixture=(rows,cpg='CP1252')=>{
 const width=24,recLen=1+width,headerLen=65;
 const dbf=new Uint8Array(headerLen+rows.length*recLen+1);
 const dv=new DataView(dbf.buffer);
 dv.setUint32(4,rows.length,true);
 dv.setUint16(8,headerLen,true);
 dv.setUint16(10,recLen,true);
 dbf.set(enc.encode('Label'),32);dbf[32+11]='C'.charCodeAt(0);
 dbf[32+16]=width;dbf[64]=0x0d;
 rows.forEach((value,i)=>{
  const pos=headerLen+i*recLen;dbf[pos]=0x20;
  dbf.fill(0x20,pos+1,pos+recLen);
  const latin=Uint8Array.from([...value].map(c=>{
   if(c==='é')return 0xe9;if(c==='á')return 0xe1;
   return c.charCodeAt(0);
  }));
  if(latin.length>width)throw Error('test fixture too long');
  dbf.set(latin,pos+1);
 });
 dbf[dbf.length-1]=0x1a;
 const zip=new JSZip();zip.file('map.shp',new Uint8Array([1]));
 zip.file('map.dbf',dbf);zip.file('map.cpg',cpg);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
};
const doc=labels=>enc.encode(JSON.stringify({
 type:'FeatureCollection',
 features:labels.map((Label,i)=>({type:'Feature',properties:{Label,Code:i+1},
  geometry:{type:'Point',coordinates:[10+i,20+i]}}))
}));
const original=['Café Málaga','áé'];
const mojibake=original.map(value=>new TextDecoder('windows-1252').decode(enc.encode(value)));
const input=new File([await fixture(original)],'map.zip');
const repaired=await repairLegacyShpGeojson(input,doc(mojibake));
assert.equal(repaired.status,'cp1252-corrected');
assert.equal(repaired.correctedValues,2);
const output=JSON.parse(new TextDecoder().decode(repaired.bytes));
assert.deepEqual(output.features.map(f=>f.properties.Label),original);
assert.deepEqual(output.features.map(f=>f.properties.Code),[1,2]);
assert.deepEqual(output.features.map(f=>f.geometry.coordinates),[[10,20],[11,21]]);
const correct=await repairLegacyShpGeojson(input,doc(original));
assert.equal(correct.status,'cp1252-verified');
assert.equal(correct.bytes,null,'Already correct JSON must not be rewritten');
const normal=await repairLegacyShpGeojson(new File([await fixture(original,'UTF-8')],'map.zip'),doc(original));
assert.equal(normal.status,'not-applicable','Normal UTF8 source remains untouched');
await assert.rejects(
 ()=>repairLegacyShpGeojson(input,doc(['other','áé'])),
 /Legacy Shapefile DBF encoding could not be safely preserved/
);
await assert.rejects(
 ()=>repairLegacyShpGeojson(new File([await fixture(original,'CP1251')],'map.zip'),doc(mojibake)),
 /Legacy Shapefile DBF encoding could not be safely preserved/
);
await assert.rejects(
 ()=>repairLegacyShpGeojson(input,doc(['CafÃ© Málaga'])),
 /Legacy Shapefile DBF encoding could not be safely preserved/
);
console.log('P42_CP1252_DBF PASSED: byte-based legacy decoding, row/field exact matching, geometry/numeric preservation, corrected and already-correct output, fail-closed unknown encoding');
