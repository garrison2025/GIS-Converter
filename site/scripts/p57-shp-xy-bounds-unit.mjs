/** P57 isolated Shapefile XY boundaries and corruption regressions. */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {File} from 'node:buffer';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
import {inspectShpXYBounds} from '../src/lib/shp-xy-bounds.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from
  '../src/lib/quality-report.mjs';

const geo=JSON.stringify({type:'FeatureCollection',features:[{
 type:'Feature',geometry:{type:'Point',coordinates:[116.4,39.9]},
 properties:{Site:'synthetic'}
}]});
const dec=async scenario=>{
 const file=await makeScenarioGISFile('shp',scenario);
 const zip=await JSZip.loadAsync(await file.arrayBuffer());
 return {zip,shp:await zip.file('example.shp').async('uint8array'),
   shx:await zip.file('example.shx').async('uint8array')};
};
const check=(shp,shx)=>inspectShpXYBounds(shp,shx).status;
const mutate=async (scenario,part,fn)=>{
 const layer=await dec(scenario);
 fn(layer[part],new DataView(layer[part].buffer));
 layer.zip.file('example.'+part,layer[part]);
 return {status:check(layer.shp,layer.shx),
  zip:new Uint8Array(await layer.zip.generateAsync({type:'uint8array'}))};
};
let tests=0;
for(const scenario of ['point','line','polygon']){
 const {shp,shx}=await dec(scenario);
 assert.equal(check(shp,shx),'pass',scenario+' verified coordinates');
 tests++;
}
for(const scenario of ['line','polygon']){
 const r=await mutate(scenario,'shp',(_,v)=>{
  // Per-record bbox differs from actual vertex extents (file-level unchanged).
  v.setFloat64(112,v.getFloat64(112,true)-2,true);
 });
 assert.equal(r.status,'review',scenario+' corrupt record envelope');
 tests++;
 const {shp,shx}=await dec(scenario);
 const v=new DataView(shp.buffer);
 const nParts=v.getInt32(144,true);
 v.setFloat64(152+4*nParts,9999,true);
 assert.equal(check(shp,shx),'review',scenario+' silently changed XY vertex');
 tests++;
}
{
 const {shp,shx}=await dec('point');
 const s=new DataView(shp.buffer),x=new DataView(shx.buffer);
 s.setFloat64(36,0,true);x.setFloat64(36,0,true);
 assert.equal(check(shp,shx),'review','both SHP and SHX envelopes tampered');
 tests++;
}
{
 const {shp,shx}=await dec('point');
 const v=new DataView(shp.buffer);
 v.setFloat64(112,NaN,true);
 assert.equal(check(shp,shx),'review','non-finite real point');
 tests++;
}
{
 const {shp,shx}=await dec('point');
 const s=new DataView(shp.buffer),x=new DataView(shx.buffer);
 s.setFloat64(112,14000000,true);s.setFloat64(120,4500000,true);
 for(const v of [s,x]){
  v.setFloat64(36,14000000,true);v.setFloat64(44,4500000,true);
  v.setFloat64(52,14000000,true);v.setFloat64(60,4500000,true);
 }
 assert.equal(check(shp,shx),'pass',
  'legitimate projected XY beyond longitude/latitude range must remain valid');
 tests++;
}
{
 const {shp,shx}=await dec('point');
 const s=new DataView(shp.buffer);
 s.setInt32(108,0,true);
 assert.equal(check(shp,shx),'unavailable',
  'Null Shape geometry cannot earn false coordinate certification');
 tests++;
}
{
 const {shp,shx}=await dec('line');
 new DataView(shp.buffer).setInt32(144,-1,true);
 assert.equal(check(shp,shx),'review','negative multipart count rejected');
 tests++;
}
{
 const {shp,shx}=await dec('polygon');
 new DataView(shp.buffer).setInt32(156,0,true);
 assert.equal(check(shp,shx),'review','duplicate multipart part boundaries rejected');
 tests++;
}
{
 const {shp,shx}=await dec('line');
 new DataView(shp.buffer).setInt32(148,999999,true);
 assert.equal(check(shp,shx),'review','out-of-record XY array rejected');
 tests++;
}
{
 const {shp,shx}=await dec('line');
 new DataView(shp.buffer).setInt32(148,1_000_001,true);
 assert.equal(check(shp,shx),'review',
  'Corrupt million-plus XY count must be rejected before budget fallback');
 tests++;
}
{
 const {shp,shx}=await dec('polygon');
 new DataView(shp.buffer).setInt32(144,1_000_001,true);
 assert.equal(check(shp,shx),'review',
  'Corrupt oversized part count must not bypass vertex bounds');
 tests++;
}
// Review regression: a structurally plausible 1,000,001-vertex record must
// not stop validation of a later corrupt record. The first record alone is
// (correctly) unavailable under the scan budget; both records must be review.
{
 const n=1_000_001, firstSize=48+16*n, secondSize=64;
 const secondAt=100+8+firstSize;
 const shp=new Uint8Array(secondAt+8+secondSize),shx=new Uint8Array(116);
 const s=new DataView(shp.buffer),x=new DataView(shx.buffer);
 for(const [v,bytes] of [[s,shp.length],[x,shx.length]]){
  v.setUint32(0,9994,false);v.setUint32(24,bytes/2,false);
  v.setUint32(28,1000,true);v.setInt32(32,3,true);
 }
 s.setUint32(100,1,false);s.setUint32(104,firstSize/2,false);
 s.setInt32(108,3,true);s.setInt32(144,1,true);
 s.setInt32(148,n,true);s.setInt32(152,0,true);
 x.setUint32(100,50,false);x.setUint32(104,firstSize/2,false);
 s.setUint32(secondAt,2,false);s.setUint32(secondAt+4,secondSize/2,false);
 s.setInt32(secondAt+8,3,true);s.setInt32(secondAt+44,1,true);
 s.setInt32(secondAt+48,999999,true);s.setInt32(secondAt+52,0,true);
 x.setUint32(108,secondAt/2,false);x.setUint32(112,secondSize/2,false);
 const oneShp=shp.slice(0,secondAt),oneShx=shx.slice(0,108);
 new DataView(oneShp.buffer).setUint32(24,oneShp.length/2,false);
 new DataView(oneShx.buffer).setUint32(24,oneShx.length/2,false);
 assert.equal(check(oneShp,oneShx),'unavailable',
  'Structurally plausible oversized single line is not falsely certified');
 assert.equal(check(shp,shx),'review',
  'Malformed second record must not bypass XY checks after scan cap');
 const dbf=new Uint8Array(35);
 dbf[0]=3;const d=new DataView(dbf.buffer);
 d.setUint32(4,2,true);d.setUint16(8,33,true);
 d.setUint16(10,1,true);dbf[32]=0x0d;dbf[33]=32;dbf[34]=32;
 const zip=new JSZip();
 for(const [ext,bytes] of [['shp',shp],['shx',shx],['dbf',dbf]])
  zip.file('budget-test.'+ext,bytes);
 zip.file('budget-test.prj','GEOGCS["WGS 84", DATUM["WGS_1984"]]');
 const archive=new Uint8Array(await zip.generateAsync({
  type:'uint8array',compression:'DEFLATE'
 }));
 const point={type:'Feature',properties:{},
  geometry:{type:'Point',coordinates:[116.4,39.9]}};
 const input=JSON.stringify({type:'FeatureCollection',features:[point,point]});
 const report=await createGISQualityReport(
  new File([input],'source.geojson'),'geojson',archive,'shp');
 assert.equal(report.checks.find(c=>c.id==='feature-count')?.status,'pass');
 assert.equal(report.checks.find(c=>c.id==='shp-record-integrity')?.status,'pass');
 assert.equal(report.checks.find(c=>c.id==='shp-xy-bounds')?.status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 tests++;
}
// End-to-end: even when SHX count, DBF rows and index offsets agree,
// corrupt XY bytes in an otherwise valid output must trigger DATA_LOSS.
{
 const result=await mutate('point','shp',(_,v)=>{
  v.setFloat64(112,130,true); // header and SHX still claim 116.4
 });
 assert.equal(result.status,'review');
 const report=await createGISQualityReport(
  new File([geo],'synthetic.geojson'),'geojson',result.zip,'shp');
 const gate=report.checks.find(c=>c.id==='shp-xy-bounds');
 assert.equal(gate?.status,'review');
 assert.equal(report.output.shpRecordIntegrity,'pass');
 assert.equal(report.output.complete,false);
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 assert(!gate.detail.includes('130')&&!gate.detail.includes('116.4'),
  'No user coordinates may enter new integrity diagnostic');
 tests++;
}
console.log('P57_SHP_XY_BOUNDS PASSED: '+tests+
 ' verified synthetic/complex and projected geometry fixtures; tampered file/record envelopes, XY doubles, null shapes, malformed parts and real DATA_LOSS gate');
