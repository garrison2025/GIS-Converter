import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {inspectGpxLineFidelity} from '../src/lib/gpx-fidelity.mjs';
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
await test('GPX logical waypoints routes and tracks count excludes auxiliary track vertices',async()=>{
 const gpx='<gpx version="1.1"><wpt lon="116.4" lat="39.9"/><wpt lon="116.5" lat="39.8"/>'+
  '<rte><name>Route One</name><rtept lon="116.6" lat="39.8"/><rtept lon="116.7" lat="39.9"/></rte>'+
  '<trk><name>Track One</name><trkseg><trkpt lon="116.8" lat="40.0"/><trkpt lon="116.9" lat="40.1"/></trkseg></trk></gpx>';
 const kml='<kml><Document>'+
 '<Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark>'+
 '<Placemark><Point><coordinates>116.5,39.8</coordinates></Point></Placemark>'+
 '<Placemark><LineString><coordinates>116.6,39.8 116.7,39.9</coordinates></LineString></Placemark>'+
 '<Placemark><LineString><coordinates>116.8,40.0 116.9,40.1</coordinates></LineString></Placemark>'+
 '</Document></kml>';
 const r=await createGISQualityReport(makeFile(gpx,'complex.gpx'),'gpx',buf(kml),'kml');
 assert.deepEqual(r.input.gpxTypes,{waypoints:2,routes:1,tracks:1});
 assert.equal(r.input.gpxLogicalFeatures,4);
 assert.equal(check(r,'gpx-logical-features').status,'pass');
 assert.equal(check(r,'feature-count').status,'unavailable'); // complex geometry comparison remains limited
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
});
await test('Missing GPX track in KML blocks delivery despite incomplete geometry inspection',async()=>{
 const gpx='<gpx><wpt lon="116.4" lat="39.9"/><rte><rtept lon="116.5" lat="39.8"/></rte>'+
 '<trk><trkseg><trkpt lon="116.6" lat="39.7"/></trkseg></trk></gpx>';
 const kml='<kml><Document><Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark>'+
 '<Placemark><LineString><coordinates>116.5,39.8</coordinates></LineString></Placemark></Document></kml>';
 const r=await createGISQualityReport(makeFile(gpx,'loss.gpx'),'gpx',buf(kml),'kml');
 assert.equal(check(r,'gpx-logical-features').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('GPX comments and CDATA cannot invent logical waypoint or route features',async()=>{
 const source='<gpx><!-- <wpt lat="40" lon="100"/> -->'+
  '<wpt lon="116.4" lat="39.9"><name><![CDATA[<rte><trk>]]></name></wpt></gpx>';
 const m=await inspectGISData('gpx',buf(source));
 assert.equal(m.gpxLogicalFeatures,1);
 assert.deepEqual(m.gpxTypes,{waypoints:1,routes:0,tracks:0});
});
const p21Gpx='<gpx version="1.1"><wpt lon="116.4" lat="39.9"><time>2025-01-01T00:00:00Z</time></wpt>'+
 '<rte><rtept lon="116.5" lat="39.8"><ele>45</ele></rtept><rtept lon="116.6" lat="39.7"/></rte>'+
 '<trk><trkseg><trkpt lon="116.7" lat="39.6"><time>2025-01-01T00:00:01Z</time><ele>50</ele></trkpt>'+
 '<trkpt lon="116.8" lat="39.5"/></trkseg><trkseg><trkpt lon="116.9" lat="39.4"/>'+
 '<trkpt lon="117.0" lat="39.3"><extensions><sensor>private</sensor></extensions></trkpt></trkseg></trk></gpx>';
const p21Kml='<kml><Document>'+
 '<Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark>'+
 '<Placemark><LineString><coordinates>116.5,39.8 116.6,39.7</coordinates></LineString></Placemark>'+
 '<Placemark><MultiGeometry><LineString><coordinates>116.7,39.6 116.8,39.5</coordinates></LineString>'+
 '<LineString><coordinates>116.9,39.4 117,39.3</coordinates></LineString></MultiGeometry></Placemark>'+
 '</Document></kml>';
await test('P21 GPX route/track segment vertices and limited precision match',async()=>{
 const r=await createGISQualityReport(makeFile(p21Gpx,'with-tracks.gpx'),'gpx',buf(p21Kml),'kml');
 assert.equal(check(r,'gpx-logical-features').status,'pass');
 assert.equal(check(r,'gpx-line-geometry').status,'pass');
 assert.equal(check(r,'gpx-vertex-metadata').status,'review');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 assert(!JSON.stringify(r).includes('2025-01-01T00:00:01Z'));
 assert(!JSON.stringify(r).includes('private'));
});
await test('P21 GPX lost track vertex blocks output even if three Placemarks survive',async()=>{
 const bad=p21Kml.replace('116.7,39.6 116.8,39.5','116.7,39.6');
 const r=await createGISQualityReport(makeFile(p21Gpx,'with-tracks.gpx'),'gpx',buf(bad),'kml');
 assert.equal(check(r,'gpx-logical-features').status,'pass');
 assert.equal(check(r,'gpx-line-geometry').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P21 GPX moved track vertex blocks output without a count mismatch',async()=>{
 const bad=p21Kml.replace('116.8,39.5','116.85,39.5');
 const r=await createGISQualityReport(makeFile(p21Gpx,'moved.gpx'),'gpx',buf(bad),'kml');
 assert.equal(check(r,'gpx-line-geometry').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P21 GPX changed track segment count blocks output',async()=>{
 const bad=p21Kml.replace('</coordinates></LineString><LineString><coordinates>',' 116.9,39.4</coordinates></LineString><LineString><coordinates>');
 const r=await createGISQualityReport(makeFile(p21Gpx,'segment.gpx'),'gpx',buf(bad),'kml');
 assert.equal(check(r,'gpx-line-geometry').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P21 KMZ unwrap uses bounded independent GPX line check',async()=>{
 const zip=new JSZip();zip.file('doc.kml',p21Kml);
 const r=await createGISQualityReport(makeFile(p21Gpx,'meta.gpx'),'gpx',
  new Uint8Array(await zip.generateAsync({type:'uint8array'})),'kmz');
 assert.equal(check(r,'gpx-line-geometry').status,'pass');
 assert.equal(check(r,'gpx-vertex-metadata').status,'review');
});
await test('P21 waypoint-only GPX has no line invariant to certify',async()=>{
 const src='<gpx><wpt lon="116.4" lat="39.9"/></gpx>';
 const output='<kml><Placemark><Point><coordinates>116.4,39.9</coordinates></Point></Placemark></kml>';
 const r=await createGISQualityReport(makeFile(src,'waypoint.gpx'),'gpx',buf(output),'kml');
 assert.equal(check(r,'gpx-line-geometry').status,'unavailable');
 assert.equal(check(r,'gpx-logical-features').status,'pass');
});
await test('P21 DBF risk report covers null, string width and high precision without leaking values',async()=>{
 const props={Label:'私人字段内容'.repeat(50),Nullable:null,Score:1.2345678901234567,Count:9007199254740992};
 const src=fixture([116.4,39.9],props);
 const r=await createGISQualityReport(makeFile(src),'geojson',buf(src),'shp');
 const risk=check(r,'shp-value-limits');
 assert.equal(risk.status,'review');
 assert(risk.detail.includes('explicit nulls'));
 assert(risk.detail.includes('UTF-8 strings longer'));
 assert(!JSON.stringify(r).includes('私人字段内容'));
});
await test('P21 ordinary short scalar DBF values do not trigger new width/precision warning',async()=>{
 const src=fixture([116.4,39.9],{Code:'A1',Count:2,Score:2.5});
 const r=await createGISQualityReport(makeFile(src),'geojson',buf(src),'shp');
 assert.equal(check(r,'shp-value-limits').status,'pass');
 assert.equal(check(r,'attribute-fidelity').status,'unavailable');
});

await test('P21 over-limit GPX XML remains unavailable rather than consuming unbounded inspector memory',async()=>{
 const r=inspectGpxLineFidelity('a'.repeat(4*1024*1024+1),'<kml/>');
 assert.equal(r.status,'unavailable');
 assert.equal(r.metadata.status,'unavailable');
});

// P22: Construct independent binary DBF fixtures without relying on GDAL's reader.
async function p22Zip(fields,records,{cpg=true}={}){
 const bytesEncoder=new TextEncoder();
 const head=32+fields.length*32+1,recLen=1+fields.reduce((n,f)=>n+f.width,0);
 const dbf=new Uint8Array(head+recLen*records.length+1),dv=new DataView(dbf.buffer);
 dbf[0]=3;dv.setUint32(4,records.length,true);dv.setUint16(8,head,true);dv.setUint16(10,recLen,true);
 for(let i=0;i<fields.length;i++){
  const f=fields[i],at=32+i*32;
  dbf.set(bytesEncoder.encode(f.name),at);
  dbf[at+11]=f.type.charCodeAt(0);
  dbf[at+16]=f.width;dbf[at+17]=f.decimal||0;
 }
 dbf[head-1]=0x0d;
 records.forEach((rec,row)=>{
  let off=head+row*recLen;dbf[off++]=0x20;
  for(const f of fields){
   const raw=String(rec[f.name]??'');
   const encoded=bytesEncoder.encode(raw);
   if(encoded.length>f.width)throw Error('Test record field exceeds its width: '+f.name);
   const b=new Uint8Array(f.width).fill(0x20);
   b.set(encoded,f.type==='C'?0:f.width-encoded.length);
   dbf.set(b,off);off+=f.width;
  }
 });
 dbf[dbf.length-1]=0x1a;
 const zip=new JSZip();zip.file('data.dbf',dbf);if(cpg)zip.file('data.cpg','UTF-8');
 return new Uint8Array(await zip.generateAsync({type:'uint8array'}));
}
const p22Fields=[{name:'Code',type:'C',width:8},{name:'Label',type:'C',width:28},
 {name:'Count',type:'N',width:8,decimal:0},{name:'Score',type:'N',width:14,decimal:4}];
const p22Input={type:'FeatureCollection',features:[
 {type:'Feature',properties:{Code:'A01',Label:'北京公园',Count:12,Score:12.75},
  geometry:{type:'Point',coordinates:[116.4,39.9]}},
 {type:'Feature',properties:{Code:'B02',Label:'深圳公园',Count:-3,Score:-2.125},
  geometry:{type:'Point',coordinates:[114.1,22.5]}}
]};
const p22Rows=p22Input.features.map(f=>f.properties);
await test('P22 independently parsed UTF-8 DBF safe fields and values match',async()=>{
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(p22Fields,p22Rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'pass');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
});
await test('P22 altered DBF Chinese text is withheld',async()=>{
 const rows=p22Rows.map(row=>({...row}));rows[1].Label='深圳公園';
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(p22Fields,rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 assert(!JSON.stringify(r).includes('深圳公園'));
});
await test('P22 numeric DBF precision loss is withheld',async()=>{
 const rows=p22Rows.map(row=>({...row}));rows[1].Score=-2.1;
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(p22Fields,rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P22 missing DBF field is withheld only when comparable source values exist',async()=>{
 const fields=p22Fields.filter(f=>f.name!=='Code'),rows=p22Rows.map(({Code,...rest})=>rest);
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(fields,rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P22 truncated DBF text is independently detected',async()=>{
 const fields=p22Fields.map(f=>f.name==='Label'?{...f,width:4}:f);
 const rows=p22Rows.map(r=>({...r,Label:'test'}));
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(fields,rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});
await test('P22 null DBF values remain unavailable and are not falsely certified',async()=>{
 const obj=structuredClone(p22Input);obj.features[0].properties.Label=null;
 const rows=p22Rows.map(r=>({...r}));rows[0].Label='';
 const r=await createGISQualityReport(makeFile(JSON.stringify(obj)),'geojson',
   await p22Zip(p22Fields,rows),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'unavailable');
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
});
await test('P22 no DBF code-page marker remains unavailable rather than triggering false loss',async()=>{
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(p22Fields,p22Rows,{cpg:false}),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'unavailable');
});
await test('P22 invalid DBF record byte bounds remain unavailable',async()=>{
 const zip=await JSZip.loadAsync(await p22Zip(p22Fields,p22Rows));
 const dbf=await zip.file('data.dbf').async('uint8array');
 new DataView(dbf.buffer).setUint16(10,1,true);
 zip.file('data.dbf',dbf);
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
  new Uint8Array(await zip.generateAsync({type:'uint8array'})),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'unavailable');
});
await test('P22 DBF data count mismatch blocks download',async()=>{
 const r=await createGISQualityReport(makeFile(JSON.stringify(p22Input)),'geojson',
   await p22Zip(p22Fields,[p22Rows[0]]),'shp');
 assert.equal(check(r,'dbf-attribute-values').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
});

const summary={status:passed===records.length?'PASSED':'FAILED',passed,total:records.length,records};
console.log(JSON.stringify(summary,null,2));
if(summary.status!=='PASSED')process.exitCode=1;
