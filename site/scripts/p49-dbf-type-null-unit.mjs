/**
 * P49 independent DBF date/logical/blank/case-fold attribute invariants.
 * Synthetic DBF bytes and GeoJSON only. Never log private field values.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {readComparableDbfValue,readUtf8ShapefileDbf,inspectGeojsonToShpDbfFidelity} from '../src/lib/dbf-fidelity.mjs';
import {inspectShpToGeojsonDbfFidelity} from '../src/lib/shp-geojson-fidelity.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';

const encoder=new TextEncoder();
function dbf(records,fields){
 const recordLength=1+fields.reduce((sum,f)=>sum+f.width,0);
 const headerLength=33+32*fields.length;
 const bytes=new Uint8Array(headerLength+records.length*recordLength+1);
 const view=new DataView(bytes.buffer);
 bytes[0]=3;view.setUint32(4,records.length,true);
 view.setUint16(8,headerLength,true);view.setUint16(10,recordLength,true);
 for(const [i,f] of fields.entries()){
  const pos=32+i*32,name=encoder.encode(f.name);
  assert(name.length<=10);
  bytes.set(name,pos);bytes[pos+11]=f.type.charCodeAt(0);
  bytes[pos+16]=f.width;bytes[pos+17]=f.decimal||0;
 }
 bytes[headerLength-1]=13;
 for(const [i,row] of records.entries()){
  let pos=headerLength+i*recordLength;
  bytes[pos++]=32;
  for(const field of fields){
   const raw=row[field.name]??'';
   const characters=encoder.encode(String(raw));
   assert(characters.length<=field.width);
   bytes.fill(32,pos,pos+field.width);
   bytes.set(characters,pos+(field.type==='N'?field.width-characters.length:0));
   pos+=field.width;
  }
 }
 bytes[bytes.length-1]=26;
 return bytes;
}
async function zipDbf(fields,rows){
 const z=new JSZip();
 z.file('layer.shp',new Uint8Array([0]));
 z.file('layer.shx',new Uint8Array([0]));
 z.file('layer.dbf',dbf(rows,fields));
 z.file('layer.cpg','UTF-8');
 return z.generateAsync({type:'uint8array',compression:'STORE'});
}
const json=rows=>encoder.encode(JSON.stringify({type:'FeatureCollection',
 features:rows.map((properties,i)=>({type:'Feature',properties,
  geometry:{type:'Point',coordinates:[116.4+i*0.001,39.9]}}))}));
const check=(result,expected,label)=>{
 assert.equal(result.status,expected,label+': '+result.detail);
 for(const privateField of ['PrivateRealValue999','SecretName'])
  assert(!JSON.stringify(result).includes(privateField),label+' leaked private content');
};
const fields=[
 {name:'VisitDate',type:'D',width:8},
 {name:'Active',type:'L',width:1},
 {name:'Label',type:'C',width:32}
];
const goodDbf=await zipDbf(fields,[{VisitDate:'20240229',Active:'T',Label:'PrivateRealValue999'}]);
const goodJson=json([{VisitDate:'2024-02-29',Active:true,Label:'PrivateRealValue999'}]);
check(await inspectGeojsonToShpDbfFidelity(goodJson,goodDbf),'pass','forward valid leap date/logical');
check(await inspectShpToGeojsonDbfFidelity(goodDbf,goodJson),'pass','reverse valid leap date/logical');
const parsed=await readUtf8ShapefileDbf(goodDbf);
assert.deepEqual(readComparableDbfValue(parsed,0,parsed.lookup.get('VisitDate')),{kind:'date',value:'2024-02-29'});
assert.deepEqual(readComparableDbfValue(parsed,0,parsed.lookup.get('Active')),{kind:'boolean',value:true});
const falseDbf=await zipDbf(fields,[{VisitDate:'20240228',Active:'f',Label:'normal'}]);
check(await inspectShpToGeojsonDbfFidelity(falseDbf,json([{VisitDate:'2024-02-28',Active:false,Label:'normal'}])),
 'pass','lowercase logical false');
check(await inspectGeojsonToShpDbfFidelity(goodJson,await zipDbf(fields,[{
 VisitDate:'20240229',Active:'F',Label:'PrivateRealValue999'
}])),'review','changed boolean output');
check(await inspectShpToGeojsonDbfFidelity(goodDbf,json([{
 VisitDate:'2024-02-29',Active:1,Label:'PrivateRealValue999'
}])),'review','boolean changed to numeric output');
const invalidDate=await zipDbf(fields,[{VisitDate:'20250229',Active:'?',Label:'PrivateRealValue999'}]);
check(await inspectShpToGeojsonDbfFidelity(invalidDate,goodJson),'unavailable',
 'invalid source date and null logical cannot be guessed');
check(await inspectGeojsonToShpDbfFidelity(goodJson,invalidDate),'review',
 'invalid emitted date/logical from known original');
const trimmed=await zipDbf([{name:'Label',type:'C',width:16},{name:'Valid',type:'N',width:3}],
 [{Label:'',Valid:'7'}]);
check(await inspectGeojsonToShpDbfFidelity(json([{Label:'',Valid:7}]),trimmed),
 'unavailable','empty source string is DBF blank ambiguity');
check(await inspectShpToGeojsonDbfFidelity(trimmed,json([{Label:null,Valid:7}])),
 'unavailable','blank DBF source is not certified as null');
check(await inspectGeojsonToShpDbfFidelity(json([{Label:null,Valid:7}]),trimmed),
 'unavailable','explicit null not certified');
const numericBool=await zipDbf([{name:'Active',type:'N',width:3}],[{Active:'1'}]);
const booleanOutput=await inspectGeojsonToShpDbfFidelity(json([{Active:true}]),numericBool);
check(booleanOutput,'review','Boolean stored as number loses type');
assert.throws(()=>assertNoDetectedCriticalDataLoss({
 checks:[{id:'dbf-attribute-values',...booleanOutput}]
}),{code:'DATA_LOSS'});
const caseFields=[{name:'Name',type:'C',width:16},{name:'name',type:'C',width:16}];
const caseArchive=await zipDbf(caseFields,[{Name:'HELLO',name:'WORLD'}]);
const caseJson=json([{Name:'HELLO',name:'WORLD'}]);
check(await inspectGeojsonToShpDbfFidelity(caseJson,caseArchive),'unavailable',
 'casefold duplicate output fields not certified as independently addressable');
check(await inspectShpToGeojsonDbfFidelity(caseArchive,caseJson),'unavailable',
 'casefold duplicate source fields not certified');
const renamed=await zipDbf([{name:'Name',type:'C',width:16},{name:'name_1',type:'C',width:16}],
 [{Name:'HELLO',name_1:'WORLD'}]);
const renamedResult=await inspectGeojsonToShpDbfFidelity(caseJson,renamed);
check(renamedResult,'review','verified short casefold field rename is detectable');
assert.throws(()=>assertNoDetectedCriticalDataLoss({
 checks:[{id:'dbf-attribute-values',...renamedResult}]
}),{code:'DATA_LOSS'});
const quality=await createGISQualityReport(
 new File([caseJson],'case.geojson'), 'geojson', caseArchive,'shp');
const fieldRisk=quality.checks.find(c=>c.id==='shp-field-limits');
assert.equal(fieldRisk?.status,'review','case-insensitive collision risk missing');
assert(fieldRisk.detail.includes('case-insensitive name collisions'));
const nullDoc=json([{Flag:true,Title:'',Nullable:null}]);
const risk=await createGISQualityReport(
 new File([nullDoc],'nullable.geojson'),'geojson',numericBool,'shp');
const valueRisk=risk.checks.find(c=>c.id==='shp-value-limits');
assert.equal(valueRisk?.status,'review');
assert(valueRisk.detail.includes('ambiguous empty strings'));
assert(valueRisk.detail.includes('boolean values'));
console.log('P49_DBF_SEMANTICS PASSED: calendar dates, logical booleans, blank vs null uncertainty, missing/casefold field names, confirmed type corruption DATA_LOSS and privacy checks');
