/**
 * P51 independently link real complex geometry with each feature's attributes.
 * Synthetic bytes; geometry is deliberately reordered and attributes swapped.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {inspectComplexFeatureAttributeFidelity} from '../src/lib/complex-feature-attribute-fidelity.mjs';
import {assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';
const encode=s=>new TextEncoder().encode(s);
const lineA=[[116.40,39.90],[116.43,39.92],[116.46,39.91]];
const lineB=[[117.10,39.30],[117.12,39.33],[117.14,39.34]];
const polygonA=[[[116,39],[116,40],[117,40],[117,39],[116,39]],
 [[116.2,39.2],[116.2,39.4],[116.4,39.4],[116.4,39.2],[116.2,39.2]]];
const polygonB=[[[118,39],[118,40],[119,40],[119,39],[118,39]]];
const geo=features=>encode(JSON.stringify({type:'FeatureCollection',features:features.map(f=>({
 type:'Feature',properties:{Name:f.name,Code:f.code},geometry:{type:f.type,coordinates:f.coords}
}))}));
const lines=[{type:'LineString',coords:lineA,name:'Alpha',code:'A-001'},
 {type:'LineString',coords:lineB,name:'Beta',code:'B-002'}];
const polygons=[{type:'Polygon',coords:polygonA,name:'Alpha',code:'A-001'},
 {type:'Polygon',coords:polygonB,name:'Beta',code:'B-002'}];
const coord=items=>items.map(p=>p.join(',')).join(' ');
const geometry=f=>{
 if(f.type==='LineString')return '<LineString><coordinates>'+coord(f.coords)+'</coordinates></LineString>';
 if(f.type==='MultiLineString')return '<MultiGeometry>'+f.coords.map(c=>'<LineString><coordinates>'+
  coord(c)+'</coordinates></LineString>').join('')+'</MultiGeometry>';
 const polygon=parts=>'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+
  coord(parts[0])+'</coordinates></LinearRing></outerBoundaryIs>'+
  parts.slice(1).map(x=>'<innerBoundaryIs><LinearRing><coordinates>'+
   coord(x)+'</coordinates></LinearRing></innerBoundaryIs>').join('')+'</Polygon>';
 if(f.type==='Polygon')return polygon(f.coords);
 if(f.type==='MultiPolygon')return '<MultiGeometry>'+f.coords.map(polygon).join('')+'</MultiGeometry>';
 throw Error('bad test shape');
};
const mark=f=>'<Placemark><name>'+f.name+'</name><ExtendedData>'+
 '<Data name="Code"><value>'+f.code+'</value></Data></ExtendedData>'+
 geometry(f)+'</Placemark>';
const kml=fs=>encode('<?xml version="1.0"?><kml xmlns="http://www.openg.net/kml/2.2">'+
 '<Document>'+fs.map(mark).join('')+'</Document></kml>');
async function zip(name,data,extras=[]){
 const archive=new JSZip();archive.file(name,data);
 for(const [p,v] of extras)archive.file(p,v);
 return archive.generateAsync({type:'uint8array',compression:'STORE'});
}
const status=async(a,s,b,t)=>{
 const result=await inspectComplexFeatureAttributeFidelity(a,s,b,t);
 for(const privateValue of ['Alpha','Beta','A-001','116.40','39.90'])
  assert(!JSON.stringify(result).includes(privateValue),'private GIS data in attribute summary');
 return result;
};
const expect=async(src,sf,out,tf,expected,why)=>{
 const r=await status(src,sf,out,tf);
 assert.equal(r.status,expected,why+': '+r.detail);
 return r;
};
const exact=kml([lines[1],lines[0]]);
await expect(geo(lines),'geojson',exact,'kml','pass',
 'Reordered real line features with original attributes must match by geometry');
await expect(exact,'kml',geo(lines),'geojson','pass',
 'Reverse ordered KML lines join to original GeoJSON feature');
await expect(geo(lines),'geojson',await zip('doc.kml',exact),'kmz','pass',
 'KMZ must join original line geometries and code values');
const exchanged=kml([{...lines[1],code:'A-001'},{...lines[0],code:'B-002'}]);
const loss=await expect(geo(lines),'geojson',exchanged,'kml','review',
 'Swapping named attributes between unchanged geometries is confirmed loss');
assert.throws(()=>assertNoDetectedCriticalDataLoss({checks:[{
 id:'complex-feature-attributes',...loss
}]}),{code:'DATA_LOSS'});
await expect(geo(polygons),'geojson',kml([polygons[1],polygons[0]]),'kml','pass',
 'Polygon with an interior hole must associate its original code, regardless of order');
await expect(geo(polygons),'geojson',kml([{...polygons[0],code:'B-002'},polygons[1]]),
 'kml','review','Polygon hole geometry unchanged but attribute replaced');
const mixed=[
 {type:'MultiLineString',coords:[lineA,lineB],name:'Alpha',code:'A-001'}
];
await expect(geo(mixed),'geojson',kml(mixed),'kml','pass',
 'MultiLineString attributes attached to same multipart feature');
const polys=[
 {type:'MultiPolygon',coords:[polygonA,polygonB],name:'Alpha',code:'A-001'}
];
await expect(geo(polys),'geojson',kml(polys),'kml','pass',
 'MultiPolygon with hole attributes match the full multipart shape');
await expect(geo([lines[0],{...lines[0],name:'Beta',code:'B-002'}]),'geojson',
 kml([lines[0],{...lines[0],name:'Beta',code:'B-002'}]),'kml','unavailable',
 'Identical geometries are not uniquely pairable even when row orders agree');
await expect(geo(lines),'geojson',kml([lines[0],{...lines[1],coords:[
 [117.10,39.30],[117.12,39.35],[117.14,39.34]]}]),'kml','unavailable',
 'Changed complex XY geometry cannot be used to make unsupported attribute assertions');
// A deliberately handcrafted 2-record WGS84 PolyLine shapefile in reversed
// order. Independent byte readers (not GDAL) verify geometric row linkage.
function shapefile(rows){
 const bytesRecord=rows.map(f=>{
  const points=f.coords,contentLength=4+32+4+4+4+points.length*16;
  const buf=new Uint8Array(contentLength),v=new DataView(buf.buffer);
  v.setInt32(0,3,true);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  for(const [pos,val] of [[4,Math.min(...xs)],[12,Math.min(...ys)],
   [20,Math.max(...xs)],[28,Math.max(...ys)]])v.setFloat64(pos,val,true);
  v.setInt32(36,1,true);v.setInt32(40,points.length,true);
  v.setInt32(44,0,true);
  for(const [j,p] of points.entries()){
   v.setFloat64(48+j*16,p[0],true);v.setFloat64(56+j*16,p[1],true);
  }
  return buf;
 });
 const offsets=[];let fileSize=100;
 for(const record of bytesRecord){offsets.push(fileSize);fileSize+=record.length+8;}
 const shp=new Uint8Array(fileSize),shx=new Uint8Array(100+8*rows.length);
 function header(arr){
  const v=new DataView(arr.buffer);
  v.setInt32(0,9994,false);v.setInt32(24,arr.length/2,false);
  v.setInt32(28,1000,true);v.setInt32(32,3,true);
 }
 header(shp);header(shx);
 const x=new DataView(shp.buffer),iv=new DataView(shx.buffer);
 for(let i=0;i<rows.length;i++){
  const pos=offsets[i],n=bytesRecord[i].length/2;
  x.setInt32(pos,i+1,false);x.setInt32(pos+4,n,false);
  shp.set(bytesRecord[i],pos+8);
  iv.setInt32(100+i*8,pos/2,false);iv.setInt32(104+i*8,n,false);
 }
 const fields=[['Name',16],['Code',16]];
 const headerLength=33+32*fields.length,recLength=1+fields.reduce((n,f)=>n+f[1],0);
 const dbf=new Uint8Array(headerLength+recLength*rows.length+1),dv=new DataView(dbf.buffer);
 dbf[0]=3;dv.setUint32(4,rows.length,true);dv.setUint16(8,headerLength,true);
 dv.setUint16(10,recLength,true);dbf[headerLength-1]=13;
 fields.forEach(([name,width],i)=>{
  const start=32+i*32;dbf.set(encode(name),start);
  dbf[start+11]=67;dbf[start+16]=width;
 });
 rows.forEach((row,i)=>{
  let off=headerLength+i*recLength;dbf[off++]=32;
  for(const [key,width] of fields){
   dbf.fill(32,off,off+width);dbf.set(encode(key==='Name'?row.name:row.code),off);off+=width;
  }
 });
 dbf[dbf.length-1]=26;
 return zip('layer.shp',shp,[
  ['layer.shx',shx],['layer.dbf',dbf],['layer.cpg','UTF-8'],
  ['layer.prj','GEOGCS["WGS 84",DATUM["WGS_1984"],UNIT["degree",0.0174532925199433]]']
 ]);
}
const shpReordered=await shapefile([lines[1],lines[0]]);
await expect(geo(lines),'geojson',shpReordered,'shp','pass',
 'Attribute values must associate with same SHP line geometry when SHP order changes');
await expect(shpReordered,'shp',geo(lines),'geojson','pass',
 'Reverse SHP to GeoJSON correctly rejoins original geometry and attributes');
await expect(geo(lines),'geojson',await shapefile([
 {...lines[1],code:'A-001'}, {...lines[0],code:'B-002'}
]),'shp','review','Detected field swap must block GeoJSON to SHP even when DBF rows exist');
console.log('P51_COMPLEX_ATTRIBUTE PASSED: reordered lines, polygon holes, MultiLineString, MultiPolygon, SHP DBF geometry join, swapped attributes DATA_LOSS and repeated geometry uncertainty');
