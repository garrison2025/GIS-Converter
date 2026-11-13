/**
 * P40 independent complex GIS geometry regressions.
 * All fixtures are synthetic in-memory WGS84. No personal coordinates leave.
 */
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import JSZip from 'jszip';
import {inspectComplexGeometryFidelity} from '../src/lib/complex-geometry-fidelity.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';

const bytes=text=>new TextEncoder().encode(text);
const feat=(type,coordinates)=>({type:'Feature',properties:{},geometry:{type,coordinates}});
const geojson=(...features)=>JSON.stringify({type:'FeatureCollection',features});
const kml=body=>'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'+body+'</Placemark></Document></kml>';
const line=xy=>'<LineString><coordinates>'+xy.map(p=>p.join(',')+',0').join(' ')+'</coordinates></LineString>';
const boundary=(kind,xy)=>'<'+kind+'><LinearRing><coordinates>'+xy.map(p=>p.join(',')).join(' ')+
 '</coordinates></LinearRing></'+kind+'>';
const polygon=rings=>'<Polygon>'+boundary('outerBoundaryIs',rings[0])+
 rings.slice(1).map(r=>boundary('innerBoundaryIs',r)).join('')+'</Polygon>';
const square=[[0,0],[0,4],[4,4],[4,0],[0,0]];
const hole=[[1,1],[2,1],[2,2],[1,2],[1,1]];
const second=[[10,10],[10,12],[12,12],[12,10],[10,10]];
const multipoly=[ [square,hole], [second] ];
const changedHole=[[1,1],[3,1],[3,2],[1,2],[1,1]];
const lineSource=[[0,0],[1,1],[2,0],[3,1]];
const lineChanged=[[0,0],[1,0.25],[2,0],[3,1]]; // same bbox
const check=async (sourceFmt,source,targetFmt,target,status,reason)=>{
 const result=await inspectComplexGeometryFidelity(bytes(source),sourceFmt,bytes(target),targetFmt);
 assert.equal(result.status,status,reason+': '+JSON.stringify(result));
 assert(!result.detail.includes('1,0.25'), 'Privacy: coordinate value should not leak');
 return result;
};
const originalLine=geojson(feat('LineString',lineSource));
const modifiedLine=kml(line(lineChanged));
await check('geojson',originalLine,'kml',modifiedLine,'review','Interior line vertex moved within same bbox');
await check('geojson',originalLine,'kml',kml(line([...lineSource].reverse())),
 'pass','Reversed line traversal has equivalent geometry');
const shortenedLine=kml(line(lineSource.slice(0,3)));
await check('geojson',originalLine,'kml',shortenedLine,'review','Missing line vertex');
const multiLine=geojson(feat('MultiLineString',[lineSource,[[10,10],[12,12]]]));
await check('geojson',multiLine,'kml',
 kml('<MultiGeometry>'+line([[10,10],[12,12]])+line([...lineSource].reverse())+'</MultiGeometry>'),
 'pass','Reordered MultiLineString segments');
await check('geojson',multiLine,'kml',
 kml(line(lineSource.concat([[10,10],[12,12]]))),
 'review','Multipart structure collapsed into one line');

const originalPoly=geojson(feat('Polygon',[square,hole]));
await check('geojson',originalPoly,'kml',kml(polygon([square])),'review','Missing hole');
await check('geojson',originalPoly,'kml',
 kml(polygon([square,changedHole])),'review','Interior hole moved with identical feature bbox');
const rotated=(r,i)=>r.slice(i,-1).concat(r.slice(0,i),[r[i]]);
await check('geojson',originalPoly,'kml',
 kml(polygon([rotated([...square].reverse(),2),rotated(hole,2)])),
 'pass','Reversed/rotated shell and rotated interior ring');

const originalMulti=geojson(feat('MultiPolygon',multipoly));
await check('geojson',originalMulti,'kml',
 kml('<MultiGeometry>'+polygon([second])+polygon([square,hole])+'</MultiGeometry>'),
 'pass','Reordered islands in MultiPolygon');
await check('geojson',originalMulti,'kml',
 kml(polygon([square,hole])),'review','Entire second polygon island lost');
const kmzArchive=new JSZip();
kmzArchive.file('doc.kml',kml(polygon([square,hole])));
const kmz=await kmzArchive.generateAsync({type:'uint8array',compression:'DEFLATE'});
const zipResult=await inspectComplexGeometryFidelity(bytes(originalPoly),'geojson',kmz,'kmz');
assert.equal(zipResult.status,'pass','KMZ polygon and hole should read from doc.kml');

const bad=geojson(feat('LineString',[[0,0],[200,12]]));
await check('geojson',bad,'kml',kml(line(lineSource)),'unavailable','Invalid geographic coordinates');
await check('geojson',geojson(feat('GeometryCollection',[])),'kml',
 kml(line(lineSource)),'unavailable','Unknown geometry must not be certified');
await check('geojson',originalLine,'kml',
 kml('<Point><coordinates>1,2</coordinates></Point>'),
 'unavailable','Unsupported Point requires P39, not P40');

const report=await createGISQualityReport(
 new File([originalPoly],'area.geojson'),'geojson',bytes(kml(polygon([square]))),'kml');
const value=report.checks.find(c=>c.id==='complex-geometry-values');
assert.equal(value?.status,'review','Real quality report should detect removed hole');
assert.throws(()=>assertNoDetectedCriticalDataLoss(report),{code:'DATA_LOSS'});
assert.equal(report.checks.find(c=>c.id==='feature-count')?.status,'unavailable',
 'Existing KML structural checker should not claim full complex geometry coverage');

const preserved=await createGISQualityReport(new File([originalPoly],'area.geojson'),
 'geojson',bytes(kml(polygon([square,hole]))),'kml');
assert.equal(preserved.checks.find(c=>c.id==='complex-geometry-values')?.status,'pass');
assert.equal(assertNoDetectedCriticalDataLoss(preserved),true);

const makeShp=async rings=>{
 // Single 2D Polygon SHP, valid paired SHX, WGS84 .prj and DBF header.
 const n=rings.reduce((x,r)=>x+r.length,0),parts=rings.length,record=44+4*parts+16*n;
 const raw=new Uint8Array(100+8+record),view=new DataView(raw.buffer);
 view.setInt32(0,9994,false);view.setInt32(24,raw.length/2,false);
 view.setInt32(28,1000,true);view.setInt32(32,5,true);
 view.setInt32(100,1,false);view.setInt32(104,record/2,false);
 view.setInt32(108,5,true);
 view.setInt32(144,parts,true);view.setInt32(148,n,true);
 let at=0,ptr=152+4*parts;
 for(let i=0;i<parts;i++){
  view.setInt32(152+i*4,at,true);
  for(const [x,y] of rings[i]){
   view.setFloat64(ptr,x,true);view.setFloat64(ptr+8,y,true);ptr+=16;at++;
  }
 }
 const shx=new Uint8Array(108),xv=new DataView(shx.buffer);
 xv.setInt32(0,9994,false);xv.setInt32(24,54,false);
 xv.setInt32(28,1000,true);xv.setInt32(32,5,true);
 xv.setInt32(100,50,false);xv.setInt32(104,record/2,false);
 const dbf=new Uint8Array(33+1),dv=new DataView(dbf.buffer);
 dv.setUint32(4,1,true);dv.setUint16(8,33,true);dv.setUint16(10,1,true);dbf[32]=13;dbf[33]=32;
 const archive=new JSZip();archive.file('site.shp',raw);archive.file('site.shx',shx);
 archive.file('site.dbf',dbf);archive.file('site.prj','GEOGCS["WGS 84",DATUM["WGS_1984"],UNIT["degree",0.0174532925199433]]');
 return archive.generateAsync({type:'uint8array',compression:'DEFLATE'});
};
const shp=await makeShp([square,hole]);
const shpMatch=await inspectComplexGeometryFidelity(bytes(originalPoly),'geojson',shp,'shp');
assert.equal(shpMatch.status,'pass','Independent SHP record reader must preserve hole');
const shpLoss=await inspectComplexGeometryFidelity(bytes(originalPoly),'geojson',
 await makeShp([square]),'shp');
assert.equal(shpLoss.status,'review','SHP missing hole must be reported');
const shpToGeojson=await inspectComplexGeometryFidelity(shp,'shp',bytes(originalPoly),'geojson');
assert.equal(shpToGeojson.status,'pass','SHP and GeoJSON bidirectional geometry readback');
const blockedShp=await createGISQualityReport(
 new File([originalPoly],'area.geojson'),'geojson',await makeShp([square]),'shp');
assert.equal(blockedShp.checks.find(c=>c.id==='complex-geometry-values')?.status,'review');
assert.throws(()=>assertNoDetectedCriticalDataLoss(blockedShp),{code:'DATA_LOSS'});
console.log('P40_COMPLEX_GEOMETRY PASSED: line vertex movement, segment loss, polygon hole/ring integrity, MultiPolygon islands, GeoJSON/KML/KMZ/SHP independent readback and critical blocking');
