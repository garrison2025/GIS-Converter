/**
 * Native GDAL independent interoperability check of pure-JavaScript binary
 * PolyLine and Polygon Shapefile examples; not GDAL/WASM self-validation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import JSZip from 'jszip';
import {makeScenarioGISFile} from '../src/lib/demo-gis-scenarios.mjs';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'gis-p47-native-'));
const area=ring=>Math.abs(ring.reduce((a,p,i)=>i===ring.length-1?a:
 a+(p[0]*ring[i+1][1]-ring[i+1][0]*p[1]),0)/2);
try{
 for(const scenario of ['line','polygon']){
  const example=await makeScenarioGISFile('shp',scenario);
  const zip=await JSZip.loadAsync(await example.arrayBuffer());
  const temp=path.join(folder,scenario);fs.mkdirSync(temp,{recursive:true});
  for(const extension of ['shp','shx','dbf','prj','cpg']){
   const bytes=await zip.file('example.'+extension).async('nodebuffer');
   fs.writeFileSync(path.join(temp,'example.'+extension),bytes);
  }
  const shapefile=path.join(temp,'example.shp');
  const text=execFileSync('ogr2ogr',['-f','GeoJSON','/vsistdout/',shapefile,
   '-t_srs','EPSG:4326'],{encoding:'utf8',timeout:20000,
   env:{...process.env,SHAPE_ENCODING:'UTF-8'}});
  const parsed=JSON.parse(text);
  assert.equal(parsed.type,'FeatureCollection');
  assert.equal(parsed.features.length,1);
  const feature=parsed.features[0];
  assert.equal(feature.geometry.type,scenario==='line'?'LineString':'Polygon');
  assert.equal(Number(feature.properties.Code),scenario==='line'?2:3);
  assert.equal(String(feature.properties.Name).trim(),
   scenario==='line'?'Example line':'Example polygon');
  if(scenario==='line'){
   assert.equal(feature.geometry.coordinates.length,3);
   assert(Math.abs(feature.geometry.coordinates[1][0]-116.45)<1e-7);
   assert(Math.abs(feature.geometry.coordinates[1][1]-39.95)<1e-7);
  }else{
   assert.equal(feature.geometry.coordinates.length,2,'QGIS/OGR lost the interior hole');
   const rings=feature.geometry.coordinates;
   assert.equal(rings[0].length,5);assert.equal(rings[1].length,5);
   assert(Math.abs(area(rings[0])-0.01)<1e-6,'Polygon exterior ring area drifted');
   assert(Math.abs(area(rings[1])-0.0025)<1e-6,'Polygon hole ring area drifted');
   assert(Math.abs(area(rings[0])-area(rings[1])-0.0075)<1e-6,
    'Net polygon area or hole size corrupted');
  }
  const info=execFileSync('ogrinfo',['-ro','-so','-al',shapefile],{encoding:'utf8',timeout:20000});
  assert(info.includes('EPSG')||info.includes('WGS 84'),
   'Native GDAL did not recognize WGS84 CRS');
  console.log('P47_NATIVE_GDAL '+scenario+' PASSED: independent SHP/SHX/DBF/PRJ native OGR reader, geometry parts, attributes and WGS84');
 }
}catch(e){console.error('P47_NATIVE_GDAL_FAILED',e);throw e}
finally{fs.rmSync(folder,{recursive:true,force:true})}
