/**
 * P48: independently constructed UTF-8 DBF and JSON fixtures verify that
 * 1-unit trillion-scale drift, 1e-12 float drift, Chinese field names and
 * names/values are never silently certified.
 */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {comparableDbfFieldName,inspectGeojsonToShpDbfFidelity} from '../src/lib/dbf-fidelity.mjs';
import {inspectShpToGeojsonDbfFidelity} from '../src/lib/shp-geojson-fidelity.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';
const e=new TextEncoder();
function dbf(records,fields){
 const width=1+fields.reduce((n,f)=>n+f.width,0);
 const head=33+32*fields.length;
 const out=new Uint8Array(head+width*records.length+1);
 const view=new DataView(out.buffer);
 out[0]=3;out[1]=126;out[2]=11;out[3]=16;
 view.setUint32(4,records.length,true);view.setUint16(8,head,true);view.setUint16(10,width,true);
 for(let j=0;j<fields.length;j++){
  const f=fields[j],offset=32+32*j,bytes=e.encode(f.name);
  if(bytes.length>10)throw Error('Invalid synthetic DBF field name length');
  out.set(bytes,offset);
  out[offset+11]=f.type.charCodeAt(0);
  out[offset+16]=f.width;out[offset+17]=f.decimals||0;
 }
 out[head-1]=13;
 for(let i=0;i<records.length;i++){
  let offset=head+i*width;out[offset++]=32;
  for(const f of fields){
   const val=records[i][f.name];
   const raw=val===null||val===undefined?'':String(val);
   const b=e.encode(raw);
   if(b.length>f.width)throw Error('Invalid fixture width');
   if(f.type==='C'){out.fill(32,offset,offset+f.width);out.set(b,offset)}
   else{out.fill(32,offset,offset+f.width);out.set(b,offset+f.width-b.length)}
   offset+=f.width;
  }
 }
 out[out.length-1]=0x1a;
 return out;
}
async function zipDbf(values,fields,encoding='UTF-8',mutateDbf=null){
 const archive=new JSZip();
 const bytes=dbf([values],fields);
 mutateDbf?.(bytes);
 archive.file('layer.dbf',bytes);
 archive.file('layer.cpg',encoding);
 // Minimal binary ZIP sidecars for DBF-only comparable value tests.
 archive.file('layer.shp',new Uint8Array([0]));
 archive.file('layer.shx',new Uint8Array([0]));
 return archive.generateAsync({type:'uint8array',compression:'STORE'});
}
const json=props=>e.encode(JSON.stringify({type:'FeatureCollection',features:[{
 type:'Feature',properties:props,geometry:{type:'Point',coordinates:[116.4,39.9]}
}]}));
const FIELDS=[
 {name:'名称',type:'C',width:32},
 {name:'Café',type:'C',width:32},
 {name:'Code',type:'N',width:18},
 {name:'Decimal',type:'F',width:24,decimals:12}
];
const original={'名称':'测绘数据','Café':'Café Málaga',Code:3000000000000,Decimal:12.123456789001};
const exactArchive=await zipDbf(original,FIELDS);
const sameJson=json(original);
assert.equal(comparableDbfFieldName('名称'),true);
assert.equal(comparableDbfFieldName('Café'),true);
assert.equal(comparableDbfFieldName('Code'),true);
assert.equal(comparableDbfFieldName('abcdefghij'),true);
assert.equal(comparableDbfFieldName('abcdefghijk'),false);
assert.equal(comparableDbfFieldName('城市空间分析'),false);
assert.equal(comparableDbfFieldName('形\u0000式'),false);
assert.equal(comparableDbfFieldName('市政 数据'),false);
assert.equal(comparableDbfFieldName('A\u0301'),false); // NFC normalization required
const safeOne=await inspectGeojsonToShpDbfFidelity(sameJson,exactArchive);
assert.equal(safeOne.status,'pass',safeOne.detail);
const safeTwo=await inspectShpToGeojsonDbfFidelity(exactArchive,sameJson);
assert.equal(safeTwo.status,'pass',safeTwo.detail);
const integerLost={...original,Code:original.Code-1};
const floatLost={...original,Decimal:12.123456789002};
const nameLost={...original,'名称':'不同数据'};
const accentedLost={...original,Café:'Cafe Malaga'};
for(const [name,different] of [
 ['large-integer-by-one',integerLost],
 ['decimal-at-1e-12',floatLost],
 ['Chinese-text-loss',nameLost],
 ['accented-text-loss',accentedLost]
]){
 const changedArchive=await zipDbf(different,FIELDS);
 const forward=await inspectGeojsonToShpDbfFidelity(sameJson,changedArchive);
 const reverse=await inspectShpToGeojsonDbfFidelity(exactArchive,json(different));
 assert.equal(forward.status,'review',name+' forward: '+forward.detail);
 assert.equal(reverse.status,'review',name+' reverse: '+reverse.detail);
}
const renamedFields=FIELDS.map(f=>f.name==='名称'?{...f,name:'名字'}:f);
const renamed={...original,'名字':original['名称']};
delete renamed['名称'];
const changedName=await inspectGeojsonToShpDbfFidelity(sameJson,
 await zipDbf(renamed,renamedFields));
assert.equal(changedName.status,'review','Missing CJK field must count as detected field loss');
const unknownEncoding=await inspectGeojsonToShpDbfFidelity(sameJson,
 await zipDbf(original,FIELDS,'CP1252'));
assert.equal(unknownEncoding.status,'unavailable',
 'Declared legacy encoding is not independently comparable as UTF-8');
// A generated DBF that claims UTF-8 but contains an invalid byte
// sequence in a known comparable text field has definite data loss.
// Previously readComparableDbfValue threw and the forward inspector
// downgraded the corrupt value to "unavailable", bypassing DATA_LOSS.
const malformedUtf8Archive=await zipDbf(original,FIELDS,'UTF-8',bytes=>{
 const firstValue=33+32*FIELDS.length+1; // first record, first C field
 bytes[firstValue]=0xc3;bytes[firstValue+1]=0x28; // invalid UTF-8 continuation
});
const malformedForward=await inspectGeojsonToShpDbfFidelity(sameJson,malformedUtf8Archive);
assert.equal(malformedForward.status,'review',
 'Invalid UTF-8 in emitted DBF text must be treated as confirmed data corruption');
assert.throws(()=>assertNoDetectedCriticalDataLoss({
 checks:[{id:'dbf-attribute-values',...malformedForward}]
}),{code:'DATA_LOSS'});
const malformedReverse=await inspectShpToGeojsonDbfFidelity(malformedUtf8Archive,sameJson);
assert.equal(malformedReverse.status,'unavailable',
 'Malformed source UTF-8 cannot be certified or guessed in reverse');
const nullable={...original,Code:null};
const partial=await inspectGeojsonToShpDbfFidelity(json(nullable),
 await zipDbf(nullable,FIELDS));
assert.equal(partial.status,'unavailable','Nulls must never receive an unqualified pass');
const longName='verylongfield';
const longSource={...original,[longName]:'extra'};
const bounded=await inspectGeojsonToShpDbfFidelity(json(longSource),exactArchive);
assert.equal(bounded.status,'unavailable','Too-long field is not falsely certified or discarded');
for(const result of [safeOne,safeTwo,changedName,partial,bounded]){
 for(const sensitive of ['测绘数据','Café Málaga','名称','3000000000000','12.123456789001'])
  assert(!JSON.stringify(result).includes(sensitive),'Private field names or values escaped report');
}
// Test the critical integrity blocker through the genuine report predicate.
// The class/code must match the browser's existing DATA_LOSS handling.
const confirmed={checks:[{id:'dbf-attribute-values',...await inspectGeojsonToShpDbfFidelity(
 sameJson,await zipDbf(integerLost,FIELDS))}]};
assert.throws(()=>assertNoDetectedCriticalDataLoss(confirmed),{code:'DATA_LOSS'});
const confirmedReverse={checks:[{id:'shp-geojson-attributes',...await inspectShpToGeojsonDbfFidelity(
 exactArchive,json(floatLost))}]};
assert.throws(()=>assertNoDetectedCriticalDataLoss(confirmedReverse),{code:'DATA_LOSS'});
console.log('P48_DBF_PRECISION PASSED: UTF-8 CJK/accents, trillion integer and decimal drift, confirmed malformed output text blocking, ambiguous malformed source not certified, nulls and strict DATA_LOSS gate');
