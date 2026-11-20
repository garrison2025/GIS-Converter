/** P58: real binary SHP Null Shape data loss regression; no user data. */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from
 '../src/lib/quality-report.mjs';

const pts=[[116.4,39.9],[116.5,40],[116.6,40.1]];
const json=coordinates=>JSON.stringify({type:'FeatureCollection',
 features:coordinates.map((coordinates,i)=>({
  type:'Feature',properties:{Code:i+1},
  geometry:coordinates?{type:'Point',coordinates}:null
 }))});
const source=new File([json(pts)],'source.geojson');
function shapefileHeader(view,fileLength,box){
 view.setUint32(0,9994,false);
 view.setUint32(24,fileLength/2,false);
 view.setUint32(28,1000,true);
 view.setInt32(32,1,true);
 [36,44,52,60].forEach((off,i)=>view.setFloat64(off,box[i],true));
}
async function makeShp(nullIndices=[],{noncanonicalNull=false}={}){
 const nulls=new Set(nullIndices),bodies=pts.map((_,i)=>
  nulls.has(i)?noncanonicalNull?20:4:20);
 const count=pts.length;
 const shp=new Uint8Array(100+bodies.reduce((n,len)=>n+8+len,0)),
  shx=new Uint8Array(100+8*count);
 const s=new DataView(shp.buffer),x=new DataView(shx.buffer);
 const active=pts.filter((_,i)=>!nulls.has(i));
 const box=active.length?[
  Math.min(...active.map(p=>p[0])),
  Math.min(...active.map(p=>p[1])),
  Math.max(...active.map(p=>p[0])),
  Math.max(...active.map(p=>p[1]))
 ]:[0,0,0,0];
 shapefileHeader(s,shp.length,box);
 shapefileHeader(x,shx.length,box);
 let pos=100;
 for(let i=0;i<count;i++){
  const length=bodies[i];
  s.setUint32(pos,i+1,false);s.setUint32(pos+4,length/2,false);
  s.setInt32(pos+8,nulls.has(i)?0:1,true);
  if(!nulls.has(i)){
   s.setFloat64(pos+12,pts[i][0],true);
   s.setFloat64(pos+20,pts[i][1],true);
  }
  x.setUint32(100+i*8,pos/2,false);
  x.setUint32(104+i*8,length/2,false);
  pos+=8+length;
 }
 assert.equal(pos,shp.length);
 // dBase III with one numeric Code field and exactly 3 live DBF rows.
 const width=8,header=65,record=1+width;
 const dbf=new Uint8Array(header+count*record+1).fill(0x20);
 const d=new DataView(dbf.buffer);
 dbf[0]=3;d.setUint32(4,count,true);
 d.setUint16(8,header,true);d.setUint16(10,record,true);
 dbf.set(new TextEncoder().encode('Code'),32);
 dbf[43]='N'.charCodeAt(0);dbf[48]=width;dbf[64]=0x0d;
 for(let i=0;i<count;i++){
  dbf[header+i*record]=0x20;
  const value=String(i+1).padStart(width,' ');
  dbf.set(new TextEncoder().encode(value),header+i*record+1);
 }
 dbf[dbf.length-1]=0x1a;
 const zip=new JSZip();
 for(const [ext,data] of [
  ['shp',shp],['shx',shx],['dbf',dbf],
  ['prj','GEOGCS["GCS_WGS_1984",DATUM["WGS_1984"]]'],['cpg','UTF-8']
 ])zip.file('synthetic.'+ext,data);
 return new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'STORE'}));
}
const check=(r,id)=>r.checks.find(c=>c.id===id);
let passed=0;
{
 const output=await makeShp();
 const r=await createGISQualityReport(source,'geojson',output,'shp');
 assert.equal(check(r,'shp-record-integrity').status,'pass');
 assert.equal(check(r,'shp-xy-bounds').status,'pass');
 assert.equal(check(r,'shp-null-shape-loss').status,'pass');
 assert.equal(check(r,'feature-count').status,'pass');
 assert.equal(r.output.shpNullShapes,0);
 assert.equal(assertNoDetectedCriticalDataLoss(r),true);
 passed++;
}
{
 const output=await makeShp([1]);
 const r=await createGISQualityReport(source,'geojson',output,'shp');
 assert.equal(r.input.complete,true);
 assert.equal(r.output.complete,true);
 assert.equal(r.output.shpNullShapes,1);
 assert.equal(check(r,'shp-record-integrity').status,'pass');
 assert.equal(check(r,'shp-xy-bounds').status,'pass');
 assert.equal(check(r,'feature-count').status,'pass');
 // The retained end points deliberately keep the original file-level bbox.
 assert.deepEqual(r.input.bbox,r.output.bbox);
 assert.equal(check(r,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 assert(!JSON.stringify(r).includes('synthetic.geojson'));
 passed++;
}
{
 const output=await makeShp([0,1,2]);
 const r=await createGISQualityReport(source,'geojson',output,'shp');
 assert.equal(r.output.shpNullShapes,3);
 assert.equal(check(r,'shp-record-integrity').status,'pass');
 assert.equal(check(r,'shp-xy-bounds').status,'unavailable');
 assert.equal(check(r,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 passed++;
}
{
 const output=await makeShp([1],{noncanonicalNull:true});
 const r=await createGISQualityReport(source,'geojson',output,'shp');
 assert.equal(check(r,'shp-record-integrity').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 passed++;
}
{
 const output=await makeShp([1]);
 const src=new File([json([pts[0],null,pts[2]])],'nullable.geojson');
 const r=await createGISQualityReport(src,'geojson',output,'shp');
 assert.equal(r.input.complete,false);
 assert.equal(check(r,'shp-null-shape-loss').status,'unavailable',
  'Unknown source geometry must not be claimed an independently detected loss');
 passed++;
}
// A shallow GeoJSON bbox walk can call an empty LineString, MultiPoint or
// Polygon "complete", even though OGR may legitimately write a Null Shape.
for(const geometry of [
 {type:'LineString',coordinates:[]},
 {type:'LineString',coordinates:[[116.5,40]]},
 {type:'MultiPoint',coordinates:[]},
 {type:'MultiLineString',coordinates:[[]]},
 {type:'Polygon',coordinates:[]},
 {type:'Polygon',coordinates:[[]]},
 {type:'MultiPolygon',coordinates:[]},
 {type:'Polygon',coordinates:[[
   [116.5,40],[116.5,40],[116.5,40],[116.5,40]
 ]]},
]){
 const document=JSON.parse(json(pts));
 document.features[1].geometry=geometry;
 const src=new File([JSON.stringify(document)],'ambiguous-geometry.geojson');
 const report=await createGISQualityReport(src,'geojson',
  await makeShp([1]),'shp');
 assert.equal(report.input.knownNonNullGeometries,false,
  geometry.type+' empty/degenerate geometry must not be certified');
 assert.equal(check(report,'shp-null-shape-loss').status,'unavailable',
  geometry.type+' Null Shape is not proven source geometry loss');
 passed++;
}
{
 const sourceJson=JSON.parse(json(pts));
 sourceJson.features[1].geometry={
  type:'Polygon',coordinates:[[
   [116.5,40],[116.55,40],[116.55,40.05],[116.5,40]
  ]]
 };
 const report=await createGISQualityReport(
  new File([JSON.stringify(sourceJson)],'nonempty-polygon.geojson'),
  'geojson',await makeShp([1]),'shp');
 assert.equal(report.input.knownNonNullGeometries,true);
 assert.equal(check(report,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 passed++;
}
{
 const kml='<kml><Document>'+pts.map(([lon,lat])=>
  '<Placemark><Point><coordinates>'+lon+','+lat+
  '</coordinates></Point></Placemark>').join('')+'</Document></kml>';
 const r=await createGISQualityReport(new File([kml],'points.kml'),'kml',
  await makeShp([1]),'shp');
 assert.equal(r.input.complete,true);
 assert.equal(check(r,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(r),{code:'DATA_LOSS'});
 passed++;
}
// P58: do not lose the older coordinate-bounds comparison when output
// contains a Null Shape. CSV and GPX are checked defensively by this generic
// inspector, even though not all source->SHP routes are publicly advertised.
{
 const output=await makeShp([1]);
 const csv='longitude,latitude,Code\n'+
  pts.map(([x,y],i)=>x+','+y+','+(i+1)).join('\n')+'\n';
 const report=await createGISQualityReport(
  new File([csv],'points.csv'),'csv',output,'shp');
 assert.equal(report.input.complete,true);
 assert.equal(check(report,'coordinate-bounds').status,'pass');
 assert.equal(check(report,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 passed++;
}
{
 const gpx='<gpx version="1.1">'+pts.map(([x,y])=>
  '<wpt lon="'+x+'" lat="'+y+'"/>').join('')+'</gpx>';
 const report=await createGISQualityReport(
  new File([gpx],'points.gpx'),'gpx',await makeShp([1]),'shp');
 assert.equal(report.input.complete,true);
 assert.equal(check(report,'coordinate-bounds').status,'pass');
 assert.equal(check(report,'shp-null-shape-loss').status,'review');
 assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
 passed++;
}
// KML with a fake Point inside a description, CDATA, or XML comment has no
// demonstrable middle geometry. Such source files may produce Null Shape.
for(const fake of [
 '<description><![CDATA[<Point><coordinates>116.5,40</coordinates></Point>]]></description>',
 '<!-- <Point><coordinates>116.5,40</coordinates></Point> -->',
 '<description><Point><coordinates>116.5,40</coordinates></Point></description>',
 '<Point/><description><coordinates>116.5,40</coordinates></description>',
 '<Point/><ExtendedData><fake:coordinates>116.5,40</fake:coordinates></ExtendedData>',
 '<Point><fake:coordinates xmlns:fake="urn:not-kml">116.5,40</fake:coordinates></Point>',
 '<fake:Point xmlns:fake="urn:not-kml"><coordinates>116.5,40</coordinates></fake:Point>',
 '<Point><coordinates xmlns="urn:not-kml">116.5,40</coordinates></Point>'
]){
 const good=([x,y])=>'<Placemark><Point><coordinates>'+
  x+','+y+'</coordinates></Point></Placemark>';
 const kml='<kml><Document>'+good(pts[0])+'<Placemark>'+
  fake+'</Placemark>'+good(pts[2])+'</Document></kml>';
 const file=new File([kml],'false-point.kml');
 const report=await createGISQualityReport(
  file,'kml',await makeShp([1]),'shp');
 assert.equal(report.input.knownNonNullGeometries,false);
 assert.equal(check(report,'shp-null-shape-loss').status,'unavailable');
 assert.equal(report.output.shpNullShapes,1);
 // Do not block an output whose source geometry was never proven.
 assert.equal(check(report,'shp-record-integrity').status,'pass');
 passed++;
 const kmz=new JSZip();kmz.file('doc.kml',kml);
 const kmzReport=await createGISQualityReport(
  new File([await kmz.generateAsync({type:'uint8array'})],'false-point.kmz'),
  'kmz',await makeShp([1]),'shp');
 assert.equal(kmzReport.input.knownNonNullGeometries,false);
 assert.equal(check(kmzReport,'shp-null-shape-loss').status,'unavailable');
 passed++;
}
{
 const point=([x,y])=>'<Placemark><Point><coordinates>'+
  x+','+y+'</coordinates></Point></Placemark>';
 const base='<Document>'+pts.map(point).join('')+'</Document>';
 const good='<kml xmlns="http://www.opengis.net/kml/2.2">'+base+'</kml>';
 const foreign='<kml xmlns="urn:not-kml">'+base+'</kml>';
 const yes=await createGISQualityReport(
  new File([good],'known-kml.kml'),'kml',await makeShp([1]),'shp');
 assert.equal(yes.input.knownNonNullGeometries,true,
  'Standard unprefixed KML default namespace permits direct Point proof');
 assert.equal(check(yes,'shp-null-shape-loss').status,'review');
 const no=await createGISQualityReport(
  new File([foreign],'foreign-root.kml'),'kml',await makeShp([1]),'shp');
 assert.equal(no.input.knownNonNullGeometries,false,
  'Foreign default namespace must not create an unsupported geometry guarantee');
 assert.equal(check(no,'shp-null-shape-loss').status,'unavailable');
 passed++;
}
console.log('P58_NULL_SHAPE_FIDELITY PASSED: '+passed+
 ' complete and incomplete GeoJSON/KML inputs, matching-count/bbox middle geometry deletion, all-null output, malformed null shape and critical DATA_LOSS');
