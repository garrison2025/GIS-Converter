/** P54 synthetic-only regression for the reproducible human-QGIS artifact. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {packageQgisReleaseEvidence, QGIS_REQUIRED_ARTIFACTS} from
  './p54-package-qgis-evidence.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gis-p54-artifacts-'));
const source=path.join(tmp,'source'), output=path.join(tmp,'output');
fs.mkdirSync(source);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const geo=Buffer.from(JSON.stringify({
  type:'FeatureCollection',features:[{type:'Feature',
    geometry:{type:'Point',coordinates:[116.4,39.9]},
    properties:{Label:'synthetic'}}]}));
const png=Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(3000,1)
]);
const shp=Buffer.alloc(100,0);shp.writeUInt32BE(9994,0);
const kml=Buffer.from('<kml><Document><Placemark /></Document></kml>');
const outputCases={
  'p53-browser-survey-lines.kml':
    'browser_two_lines_geojson_to_kml_with_attribute_pairing',
  'p53-browser-survey-lines-roundtrip.geojson':
    'browser_two_lines_kml_to_geojson_for_independent_qgis',
  'p43-browser-cp1252.geojson':
    'native_cp1252_shape_to_browser_geojson',
  'p43-browser-reprojected.geojson':
    'native_epsg3857_shp_to_browser_wgs84_geojson'
};
const writeJson=(file,value)=>fs.writeFileSync(
  path.join(source,file),JSON.stringify(value));
try{
  for(const name of QGIS_REQUIRED_ARTIFACTS){
    if(name.endsWith('.json'))continue;
    const bytes=name.endsWith('.shp')||name.endsWith('.shx')?shp:
      name.endsWith('.geojson')?geo:
      name.endsWith('.kml')?kml:
      name.endsWith('.png')?png:Buffer.from('synthetic QGIS fixture');
    fs.writeFileSync(path.join(source,name),bytes);
  }
  // Extra files must never be archived automatically.
  fs.writeFileSync(path.join(source,'customer-private.geojson'),geo);
  fs.writeFileSync(path.join(source,'p43-browser-polygon.cpg'),'UTF-8');
  const cases=Object.entries(outputCases).map(([name,caseName])=>({
    name:caseName,sha256:sha(fs.readFileSync(path.join(source,name))),
    bytes:fs.statSync(path.join(source,name)).size
  }));
  const browser={status:'PASSED',physicalDevice:'NOT_TESTED',
    origin:'http://127.0.0.1:8784',cases};
  const qgis={status:'PASSED',manualQgisInteraction:'NOT_TESTED',
    physicalDevice:'NOT_TESTED',qgisVersion:'synthetic test stub',
    checks:[
      {name:'QGIS_gui_real_KML_and_roundtrip_line_vertices_attributes',status:'PASSED'},
      {name:'QGIS_actual_Qt_map_canvas_rendered_and_screenshot',status:'PASSED'},
      ...Array.from({length:10},(_,i)=>({name:'synthetic_'+i,status:'PASSED'}))
    ]};
  writeJson('browser-evidence.json',browser);
  writeJson('qgis-desktop-evidence.json',qgis);

  const manifest=packageQgisReleaseEvidence({source,output,commit:'example-sha'});
  assert.equal(manifest.expectedCommit,'example-sha');
  assert.equal(manifest.manualQgisInteraction,'NOT_TESTED');
  assert(manifest.files.some(f=>f.file==='qgis-fixtures/p43-browser-polygon.cpg'),
    'Generated UTF-8 DBF codepage companion must be retained');
  assert(!manifest.files.some(f=>f.file.includes('customer-private')),
    'Unexpected user files must never be archived');
  for(const entry of manifest.files){
    const rel=entry.file.slice('qgis-fixtures/'.length);
    const bytes=fs.readFileSync(path.join(output,entry.file));
    assert.equal(entry.sha256,sha(bytes),'Manifest SHA must match copied bytes');
    assert.equal(entry.bytes,bytes.length,'Manifest byte count must match');
    assert(fs.existsSync(path.join(source,rel)));
  }
  assert.equal(fs.readdirSync(path.join(output,'qgis-fixtures')).length,
    QGIS_REQUIRED_ARTIFACTS.length+1);

  fs.writeFileSync(path.join(source,'p53-browser-survey-lines.kml'),
    Buffer.from('<kml>tampered</kml>'));
  assert.throws(()=>packageQgisReleaseEvidence({source,output}),
    /changed after source evidence capture/,
    'Modified original browser bytes must fail closed');
  assert(!fs.existsSync(output),
    'A failed recheck must invalidate any prior successful artifact');
  fs.writeFileSync(path.join(source,'p53-browser-survey-lines.kml'),kml);

  qgis.status='FAILED';writeJson('qgis-desktop-evidence.json',qgis);
  assert.throws(()=>packageQgisReleaseEvidence({source,output}),
    /QGIS Qt gate must pass/,'A failed installed QGIS run must not sign off');
  qgis.status='PASSED';writeJson('qgis-desktop-evidence.json',qgis);

  fs.unlinkSync(path.join(source,'p43-browser-polygon.dbf'));
  assert.throws(()=>packageQgisReleaseEvidence({source,output}),
    /ENOENT/,'Missing real DBF Shapefile sidecar must not silently pass');
  console.log('P54_QGIS_ARTIFACT_POLICY PASSED: verified synthetic files, SHA-256, optional CPG, no private files, tampering, failed Qt and missing DBF fail closed');
}finally{
  fs.rmSync(tmp,{recursive:true,force:true});
}
