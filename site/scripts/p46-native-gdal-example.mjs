/**
 * P46 independent native GDAL/OGR confirmation of the in-browser generated
 * synthetic Shapefile. This script REQUIRES the CI job's native ogr2ogr
 * executable, not the website's GDAL/WASM. It does not access user GIS data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import JSZip from 'jszip';
import {makeDemoGISFile} from '../src/lib/demo-gis-files.mjs';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'p46-native-shape-'));
try{
 const file=await makeDemoGISFile('shp');
 const zip=await JSZip.loadAsync(await file.arrayBuffer());
 for(const name of ['example.shp','example.shx','example.dbf','example.prj','example.cpg'])
  fs.writeFileSync(path.join(folder,name),await zip.file(name).async('nodebuffer'));
 const source=path.join(folder,'example.shp');
 const out=execFileSync('ogr2ogr',['-f','GeoJSON','/vsistdout/',source,
  '-t_srs','EPSG:4326'],{encoding:'utf8',maxBuffer:1024*1024,timeout:20000,
  env:{...process.env,SHAPE_ENCODING:'UTF-8'}});
 const parsed=JSON.parse(out);
 assert.equal(parsed.type,'FeatureCollection');
 assert.equal(parsed.features.length,1);
 const f=parsed.features[0];
 assert.equal(f.geometry.type,'Point');
 assert(Math.abs(f.geometry.coordinates[0]-116.4)<.0000001);
 assert(Math.abs(f.geometry.coordinates[1]-39.9)<.0000001);
 assert.equal(String(f.properties.Name).trim(),'Example point');
 assert.equal(Number(f.properties.Code),1);
 const info=execFileSync('ogrinfo',['-ro','-so','-al',source],{encoding:'utf8',
  maxBuffer:1024*1024,timeout:20000});
 assert(info.includes('EPSG')||info.includes('WGS 84'),
  'Native GDAL cannot recognize the source point sample WGS84 CRS');
 console.log('P46_NATIVE_GDAL PASSED: real ogr2ogr read source demo SHP/SHX/DBF/PRJ/CPG; one WGS84 point (116.4,39.9), Name and Code retained');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
