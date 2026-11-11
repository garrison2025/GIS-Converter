import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {createGISQualityReport,inspectGISData,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';
let passed=0;const records=[];
const makeFile=(text,name='input.geojson')=>new File([text],name);
const buf=val=>new Uint8Array(Buffer.from(val));
function fixture(coords=[116.4,39.9],properties={Name:'测试'}){return JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties,geometry:{type:'Point',coordinates:coords}}]})}
async function test(name,fn){try{await fn();records.push({name,status:'PASSED'});passed++}catch(e){records.push({name,status:'FAILED',error:String(e.stack||e)})}}
const check=(r,id)=>r.checks.find(c=>c.id===id);
async function makeShp(count=1){
 const z=new JSZip(),shp=new Uint8Array(128),shx=new Uint8Array(108),dbf=new Uint8Array(32);
 const v=new DataView(shp.buffer);v.setInt32(32,1,true);v.setFloat64(36,116.4,true);v.setFloat64(44,39.9,true);v.setFloat64(52,116.4,true);v.setFloat64(60,39.9,true);
 const dv=new DataView(dbf.buffer);dv.setUint32(4,count,true);
 z.file('points.shp',shp);z.file('points.shx',shx);z.file('points.dbf',dbf);
 z.file('points.prj','GEOGCS["WGS 84", DATUM["WGS_1984"]]');
 return new Uint8Array(await z.generateAsync({type:'uint8array'}));
}
await test('GeoJSON point count and bounds pass',async()=>{
 const source=fixture();
 const r=await createGISQualityReport(makeFile(source),'geojson',buf(source),'geojson');
 assert.equal(check(r,'feature-count').status,'pass');
 assert.equal(check(r,'coordinate-bounds').status,'pass');
 assert.deepEqual(r.input.bbox,[116.4,39.9,116.4,39.9]);
});
await test('Changed feature count produces review, never pass',async()=>{
 const input=JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[116.4,39.9]}},
 {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[117,40]}}
 ]});
 const r=await createGISQualityReport(makeFile(input),'geojson',buf(fixture()),'geojson');
 assert.equal(check(r,'feature-count').status,'review');
 assert.equal(r.status,'review');
});
await test('Coordinates changed produces review',async()=>{
 const r=await createGISQualityReport(makeFile(fixture()),'geojson',buf(fixture([116.41,39.9])),'geojson');
 assert.equal(check(r,'coordinate-bounds').status,'review');
});
await test('GeoJSON polygon: no unsupported coordinate point comparison',async()=>{
 const polygon=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
 const r=await createGISQualityReport(makeFile(polygon),'geojson',buf(polygon),'geojson');
 assert.equal(check(r,'coordinate-bounds').status,'unavailable');
 assert.equal(check(r,'feature-count').status,'pass');
});
await test('CSV with quoted comma and multiline fields',async()=>{
 const m=await inspectGISData('csv',buf('longitude,latitude,Name\n116.4,39.9,"Beijing, China"\n116.5,39.8,"two\nlines"\n'));
 assert.equal(m.features,2);assert.equal(m.complete,true);
 assert.deepEqual(m.bbox,[116.4,39.8,116.5,39.9]);
});
await test('Bad CSV coordinates produce review',async()=>{
 const input='longitude,latitude\n116.4,39.9\n,999\n';
 const r=await createGISQualityReport(makeFile(input,'bad.csv'),'csv',buf(fixture()),'geojson');
 assert.equal(r.input.complete,false);assert.equal(r.status,'review');
});
await test('KML single point independently comparable to GeoJSON',async()=>{
 const kml='<kml><Document><Placemark><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
 const r=await createGISQualityReport(makeFile(kml,'x.kml'),'kml',buf(fixture()),'geojson');
 assert.equal(check(r,'feature-count').status,'pass');
 assert.equal(check(r,'coordinate-bounds').status,'pass');
});
await test('GPX waypoint to KML point check',async()=>{
 const gpx='<gpx><wpt lon="116.4" lat="39.9"><name>A</name></wpt></gpx>';
 const kml='<kml><Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark></kml>';
 const r=await createGISQualityReport(makeFile(gpx,'x.gpx'),'gpx',buf(kml),'kml');
 assert.equal(check(r,'feature-count').status,'pass');assert.equal(check(r,'coordinate-bounds').status,'pass');
});
await test('GPX track prevents unsupported feature-count certification',async()=>{
 const gpx='<gpx><trk><trkseg><trkpt lat="39.9" lon="116.4"/></trkseg></trk></gpx>';
 const r=await createGISQualityReport(makeFile(gpx,'x.gpx'),'gpx',buf(fixture()),'geojson');
 assert.equal(check(r,'feature-count').status,'unavailable');
 assert.equal(check(r,'coordinate-bounds').status,'unavailable');
});
await test('Invalid JSON cannot be marked inspected',async()=>{
 const meta=await inspectGISData('geojson',buf('{ bad json'));
 assert.equal(meta.complete,false);assert(meta.issues.length);
});
await test('SHP ZIP record counts and WGS84 bounds',async()=>{
 const shp=await makeShp();
 const m=await inspectGISData('shp',shp);
 assert.equal(m.features,1);assert.equal(m.complete,true);assert.equal(m.crs,'WGS84');
 assert.deepEqual(m.bbox,[116.4,39.9,116.4,39.9]);
});
await test('SHP inconsistent record count yields review',async()=>{
 const shp=await makeShp(2);
 const r=await createGISQualityReport(new File([shp],'source.zip'),'shp',buf(fixture()),'geojson');
 assert.equal(r.input.complete,false);
 assert.equal(r.status,'review');
});
await test('KMZ doc.kml parsed independently',async()=>{
 const z=new JSZip();z.file('doc.kml','<kml><Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark></kml>');
 const m=await inspectGISData('kmz',new Uint8Array(await z.generateAsync({type:'uint8array'})));
 assert.equal(m.features,1);assert.equal(m.pointOnly,true);
});
await test('Invalid KMZ is explicitly unavailable',async()=>{
 const m=await inspectGISData('kmz',buf('garbage'));
 assert.equal(m.complete,false);assert(m.issues.length>0);
});
await test('CRS comparison suppressed for projected SHP',async()=>{
 const z=await JSZip.loadAsync(await makeShp());
 z.file('points.prj','PROJCS["WGS_84_Pseudo_Mercator",GEOGCS["WGS 84"]]');
 const b=new Uint8Array(await z.generateAsync({type:'uint8array'}));
 const r=await createGISQualityReport(new File([b],'source.zip'),'shp',buf(fixture()),'geojson');
 assert.equal(r.input.crs,'unknown');
 assert.equal(check(r,'coordinate-bounds').status,'unavailable');
});
await test('Explicit standard CRS84 GeoJSON is WGS84 without false alarms',async()=>{
 const original=JSON.parse(fixture());
 original.crs={type:'name',properties:{name:'urn:ogc:def:crs:OGC:1.3:CRS84'}};
 const r=await createGISQualityReport(makeFile(fixture()),'geojson',buf(JSON.stringify(original)),'geojson');
 assert.equal(r.output.crs,'WGS84');assert.equal(r.output.issues.length,0);
 assert.equal(check(r,'coordinate-bounds').status,'pass');
});
await test('Unrecognized projected GeoJSON CRS remains unverified',async()=>{
 const original=JSON.parse(fixture());
 original.crs={type:'name',properties:{name:'EPSG:3857'}};
 const r=await createGISQualityReport(makeFile(fixture()),'geojson',buf(JSON.stringify(original)),'geojson');
 assert.equal(r.output.crs,'unknown');
 assert.equal(r.status,'review');
 assert.equal(check(r,'coordinate-bounds').status,'unavailable');
});
await test('Unsafe JSON does not leak source features into quality report',async()=>{
 const geo=fixture([116.4,39.9],{PRIVATE:'private-person-name'});
 const r=await createGISQualityReport(makeFile(geo),'geojson',buf(geo),'geojson');
 assert(!JSON.stringify(r).includes('private-person-name'));
 assert.equal(r.disclaimer.includes('NOT data certification'),true);
});
await test('Critical output feature loss blocks delivery',async()=>{
 const report=await createGISQualityReport(makeFile(JSON.stringify({type:'FeatureCollection',features:[
  {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[116.4,39.9]}},
  {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[116.5,39.8]}}
 ]})),'geojson',buf(fixture()),'geojson');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
});
await test('Critical point coordinate drift blocks delivery',async()=>{
 const report=await createGISQualityReport(makeFile(fixture()),'geojson',buf(fixture([116.41,39.9])),'geojson');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
});
await test('Unknown projection and unsupported checks remain warnings, not a block',async()=>{
 const original=JSON.parse(fixture());original.crs={type:'name',properties:{name:'EPSG:3857'}};
 const report=await createGISQualityReport(makeFile(JSON.stringify(original)),'geojson',buf(fixture()),'geojson');
 assert.equal(report.checks.find(c=>c.id==='coordinate-bounds').status,'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(report),true);
});
await test('Shapefile long field names and collisions are flagged without leaking keys',async()=>{
 const geo=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',
  properties:{LongFieldNameOne:'private 1',LongFieldNameTwo:'private 2',Data:[1,2]},
  geometry:{type:'Point',coordinates:[116.4,39.9]}}]});
 const r=await createGISQualityReport(makeFile(geo),'geojson',buf(geo),'shp');
 const risk=r.checks.find(x=>x.id==='shp-field-limits');
 assert.equal(risk.status,'review');
 assert(risk.detail.includes('field names exceed 10'));
 assert(!JSON.stringify(r).includes('LongFieldNameOne'));
 assert(!JSON.stringify(r).includes('private 1'));
});
await test('Safe short scalar properties do not trigger Shapefile name warning',async()=>{
 const geo=fixture([116.4,39.9],{Seq:7,Label:'ok'});
 const r=await createGISQualityReport(makeFile(geo),'geojson',buf(geo),'shp');
 assert.equal(r.checks.find(x=>x.id==='shp-field-limits').status,'pass');
 assert.equal(r.checks.find(x=>x.id==='attribute-fidelity').status,'unavailable');
});
await test('Field risk analysis does not pretend to certify attribute values',async()=>{
 const geo=fixture([116.4,39.9],{Seq:1});
 const r=await createGISQualityReport(makeFile(geo),'geojson',buf(fixture([116.4,39.9],{Seq:999})),'shp');
 assert.equal(r.checks.find(x=>x.id==='shp-field-limits').status,'pass');
 assert.equal(r.checks.find(x=>x.id==='attribute-fidelity').status,'unavailable');
});
const summary={status:passed===records.length?'PASSED':'FAILED',passed,total:records.length,records};
console.log(JSON.stringify(summary,null,2));
if(summary.status!=='PASSED')process.exitCode=1;
