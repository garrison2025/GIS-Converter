/**
 * P36: preview data-integrity regressions. All fixtures are synthetic and
 * produced in memory; no GDAL, network, uploads or map tiles are required.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {extractConvertedOutputPreview} from '../src/lib/converted-output-preview.mjs';

const bytes=text=>new TextEncoder().encode(text);
const preview=(text,format='csv')=>extractConvertedOutputPreview(null,bytes(text),format);
const points='longitude,latitude,Name\n';

const actualZero=await preview(points+'0,0,Origin\n');
assert.equal(actualZero.status,'ready','A real 0,0 coordinate should be supported');
assert.deepEqual(actualZero.features[0].coordinates,[0,0]);

for(const [name,csv] of [
 ['missing longitude',points+',23.2,Missing longitude\n'],
 ['missing latitude',points+'12.5,,Missing latitude\n'],
 ['blank with spaces',points+'   ,23.2,Blank longitude\n'],
 ['non-numeric longitude',points+'not-a-number,23.2,Bad longitude\n'],
 ['non-finite exponent',points+'1e999,23.2,Bad exponent\n']
]){
 const result=await preview(csv);
 assert.equal(result.status,'unavailable',
  name+' must never be shown as a point (0,0) or an invented coordinate');
 assert.match(result.reason,/CSV|coordinate|preview/i);
}

function shpWithNullFirst(){
 // ESRI SHP main header: 100 bytes; record #1 is a 4-byte Null Shape,
 // record #2 is a point. DBF rows must correspond to physical record order.
 const raw=new Uint8Array(140),dv=new DataView(raw.buffer);
 dv.setInt32(0,9994,false);
 dv.setInt32(24,raw.length/2,false);
 dv.setInt32(28,1000,true);
 dv.setInt32(32,1,true);
 dv.setInt32(100,1,false);
 dv.setInt32(104,2,false);
 dv.setInt32(108,0,true);
 dv.setInt32(112,2,false);
 dv.setInt32(116,10,false);
 dv.setInt32(120,1,true);
 dv.setFloat64(124,12.5,true);
 dv.setFloat64(132,48.1,true);
 return raw;
}
function dbfWithTwoRows(){
 const headerLength=65,recordLength=13;
 const raw=new Uint8Array(headerLength+2*recordLength+1);
 const dv=new DataView(raw.buffer);
 raw[0]=0x03;
 dv.setUint32(4,2,true);
 dv.setUint16(8,headerLength,true);
 dv.setUint16(10,recordLength,true);
 raw.set(bytes('Name'),32);
 raw[32+11]='C'.charCodeAt(0);
 raw[32+16]=12;
 raw[64]=0x0d;
 for(const [index,name] of ['NullRow','LiveRow'].entries()){
  const offset=headerLength+index*recordLength;
  raw[offset]=0x20;
  raw.set(bytes(name.padEnd(12,' ')),offset+1);
 }
 raw[raw.length-1]=0x1a;
 return raw;
}
async function zipShp(prjPath='sample.prj'){
 const zip=new JSZip();
 zip.file('sample.shp',shpWithNullFirst());
 zip.file('sample.dbf',dbfWithTwoRows());
 zip.file('sample.cpg','UTF-8');
 zip.file(prjPath,'GEOGCS["WGS 84",DATUM["WGS_1984"],UNIT["degree",0.0174532925199433]]');
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

const shp=await extractConvertedOutputPreview(null,await zipShp(),'shp');
assert.equal(shp.status,'ready','Synthetic SHP with a Null Shape must remain previewable');
assert.equal(shp.displayed,1,'Null Shape must not become a point');
assert.deepEqual(shp.features[0].coordinates,[12.5,48.1]);
assert.equal(shp.features[0].properties.Name,'LiveRow',
 'Actual SHP record #2 must receive DBF row #2, never DBF row #1');
const noMatchingPrj=await extractConvertedOutputPreview(null,await zipShp('another-layer.prj'),'shp');
assert.equal(noMatchingPrj.status,'unavailable',
 'A different layer projection file must not authenticate sample.shp');

console.log('P36_PREVIEW_DATA_INTEGRITY PASSED: CSV empty/invalid rejection, genuine zero, SHP Null Shape DBF row alignment, matching CRS sidecar');