import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {File} from 'node:buffer';
import {makeDemoGISFile,DEMO_COORDINATES,DEMO_SOURCES} from '../src/lib/demo-gis-files.mjs';
import {preflightGISInput} from '../src/lib/input-preflight.mjs';
import {routes} from '../src/lib/converter-routes.mjs';
const seen=new Map();
assert.deepEqual(DEMO_COORDINATES,[116.4,39.9]);
assert.deepEqual([...DEMO_SOURCES].sort(),['csv','geojson','gpx','kml','kmz','shp'].sort());
for(const source of DEMO_SOURCES){
 const sample=await makeDemoGISFile(source);
 assert(sample instanceof File,source+' example must be an actual File');
 assert(sample.name.startsWith('gis-example.'),'Name is not clearly synthetic');
 assert(sample.size>0&&sample.size<16384,'Example exceeds 16 KiB demo bound');
 const route=routes.find(([,s])=>s===source);
 assert(route,source+' has no registered converter');
 await preflightGISInput(sample,source,route[2]);
 seen.set(source,sample);
 if(['kml','gpx'].includes(source)){
  const xml=await sample.text();
  assert(xml.includes('<'+source),'Example '+source+' has no supported XML root');
  assert(xml.includes('116.4')&&xml.includes('39.9'));
 }
 if(source==='geojson'){
  const obj=JSON.parse(await sample.text());
  assert.equal(obj.type,'FeatureCollection');
  assert.equal(obj.features.length,1);
  assert.deepEqual(obj.features[0].geometry.coordinates,[116.4,39.9]);
 }
 if(source==='csv'){
  const text=await sample.text();
  assert(text.startsWith('longitude,latitude'));
  assert(text.includes('116.4,39.9'));
 }
}
assert.equal(seen.size,6);
const zip=await JSZip.loadAsync(await seen.get('shp').arrayBuffer());
const names=Object.keys(zip.files).sort();
assert.deepEqual(names,['example.cpg','example.dbf','example.prj','example.shp','example.shx']);
const shp=await zip.file('example.shp').async('uint8array');
const shx=await zip.file('example.shx').async('uint8array');
assert.equal(shp.length,128);assert.equal(shx.length,108);
const shapefileView=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
const indexView=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
assert.equal(shapefileView.getInt32(0,false),9994);
assert.equal(shapefileView.getInt32(24,false),64);
assert.equal(shapefileView.getInt32(28,true),1000);
assert.equal(shapefileView.getInt32(32,true),1);
assert.equal(shapefileView.getInt32(100,false),1);
assert.equal(shapefileView.getInt32(104,false),10);
assert.equal(shapefileView.getInt32(108,true),1);
assert.equal(shapefileView.getFloat64(112,true),116.4);
assert.equal(shapefileView.getFloat64(120,true),39.9);
assert.equal(indexView.getInt32(24,false),54);
assert.equal(indexView.getInt32(100,false),50);
assert.equal(indexView.getInt32(104,false),10);
const dbf=await zip.file('example.dbf').async('uint8array');
const dbfView=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength);
assert.equal(dbfView.getUint32(4,true),1);
assert.equal(dbfView.getUint16(8,true),97);
assert.equal(dbfView.getUint16(10,true),31);
assert.equal(new TextDecoder().decode(dbf.subarray(98,111)),'Example point');
assert.equal(dbf[127],49);
const prj=await zip.file('example.prj').async('string');
assert(prj.includes('WGS_1984'));
assert.equal((await zip.file('example.cpg').async('string')),'UTF-8');
const kmz=await JSZip.loadAsync(await seen.get('kmz').arrayBuffer());
assert.deepEqual(Object.keys(kmz.files),['doc.kml']);
assert((await kmz.file('doc.kml').async('string')).includes('116.4,39.9,0'));
await assert.rejects(()=>makeDemoGISFile('unsupported'),/Unsupported sample source format/);
console.log('P46_DEMO_INPUTS PASSED: six bounded, correct WGS84 examples; binary SHP SHX DBF PRJ CPG byte checks, local preflight and KMZ ZIP headers');
