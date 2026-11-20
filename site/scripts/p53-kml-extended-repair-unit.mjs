/**
 * P53 synthetic-only regression: exact KML/KMZ field restoration, never
 * guessed by feature order, and never bypasses independent DATA_LOSS gates.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {restoreKmlExtendedAttributes} from '../src/lib/kml-extended-data-repair.mjs';
import {inspectComplexFeatureAttributeFidelity} from '../src/lib/complex-feature-attribute-fidelity.mjs';
import {createGISQualityReport,assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';

const enc=new TextEncoder();
const coords=[
 [[116.4,39.9],[116.45,39.95],[116.5,40]],
 [[117.1,39.3],[117.12,39.33],[117.14,39.35]]
];
const labels=[['Survey east','R-A01'],['Survey west','R-B02']];
function makeKml(){
 return '<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+
 '<Schema id="survey"><SimpleField name="Code" type="string"/></Schema>'+
 coords.map((line,i)=>
  '<Placemark><name>'+labels[i][0]+'</name>'+
  '<ExtendedData><SchemaData schemaUrl="#survey">'+
  '<SimpleData name="Code">'+labels[i][1]+'</SimpleData>'+
  '</SchemaData></ExtendedData>'+
  '<LineString><coordinates>'+line.map(p=>p.join(',')+',0').join(' ')+
  '</coordinates></LineString></Placemark>').join('')+
 '</Document></kml>';
}
const source=enc.encode(makeKml());
const input=new File([source],'survey.kml',{type:'application/vnd.google-earth.kml+xml'});
const feature=(i,properties={Name:labels[i][0]})=>({
 type:'Feature',properties,geometry:{type:'LineString',coordinates:coords[i]}
});
const geo=features=>enc.encode(JSON.stringify({type:'FeatureCollection',features}));
const missing=geo([feature(1),feature(0)]); // deliberately swapped row order
const before=await inspectComplexFeatureAttributeFidelity(source,'kml',missing,'geojson');
assert.equal(before.status,'review','Missing source Code fields should be detected');
const fixed=await restoreKmlExtendedAttributes(input,missing);
assert.equal(fixed.status,'restored-by-unique-geometry');
assert.equal(fixed.fieldsRestored,2);
const decoded=JSON.parse(new TextDecoder().decode(fixed.bytes));
assert.deepEqual(decoded.features.map(f=>f.properties.Code),['R-B02','R-A01'],
 'Field recovery must follow unique geometry, not output row order');
assert.equal((await inspectComplexFeatureAttributeFidelity(source,'kml',fixed.bytes,'geojson')).status,'pass');
const q=await createGISQualityReport(input,'kml',fixed.bytes,'geojson');
assert.equal(q.checks.find(c=>c.id==='complex-feature-attributes')?.status,'pass');
assertNoDetectedCriticalDataLoss(q);

const zip=new JSZip();
zip.file('doc.kml',makeKml());
const zipBytes=await zip.generateAsync({type:'uint8array'});
const kmz=new File([zipBytes],'survey.kmz',{type:'application/vnd.google-earth.kmz'});
const unzipped=await restoreKmlExtendedAttributes(kmz,missing,'kmz');
assert.equal(unzipped.fieldsRestored,2,'KMZ must recover uniquely matched text cells');
assert.equal((await inspectComplexFeatureAttributeFidelity(zipBytes,'kmz',unzipped.bytes,'geojson')).status,'pass');

const conflict=geo([feature(1,{Name:'Survey west',Code:'WRONG'}),feature(0)]);
const partial=await restoreKmlExtendedAttributes(input,conflict);
assert.equal(partial.fieldsRestored,1,'Never replace a pre-existing conflicting Code');
assert.equal(JSON.parse(new TextDecoder().decode(partial.bytes)).features[0].properties.Code,'WRONG');
const badQ=await createGISQualityReport(input,'kml',partial.bytes,'geojson');
assert.equal(badQ.checks.find(c=>c.id==='complex-feature-attributes')?.status,'review');
assert.throws(()=>assertNoDetectedCriticalDataLoss(badQ),{code:'DATA_LOSS'});

const changed=geo([feature(1),{...feature(0),geometry:{
 type:'LineString',coordinates:[[116.4,39.9],[116.46,39.95],[116.5,40]]
}}]);
assert.equal((await restoreKmlExtendedAttributes(input,changed)).status,'unavailable',
 'No geometry mismatch can be repaired');
const duplicate=geo([feature(0),feature(0)]);
assert.equal((await restoreKmlExtendedAttributes(input,duplicate)).status,'unavailable',
 'Repeated geometry must not be matched by row index');
const hostile=new File([makeKml().replace('<Document>','<!DOCTYPE evil><Document>')],'evil.kml');
assert.equal((await restoreKmlExtendedAttributes(hostile,missing)).status,'unavailable');
const aliases=geo([feature(1,{Name:'Survey west',code:'R-B02'}),
 feature(0,{Name:'Survey east',code:'R-A01'})]);
assert.equal((await restoreKmlExtendedAttributes(input,aliases)).status,'unavailable',
 'Do not duplicate case-folded field name aliases');
const original=geo([feature(1,{Name:'Survey west',Code:'R-B02'}),
 feature(0,{Name:'Survey east',Code:'R-A01'})]);
assert.equal((await restoreKmlExtendedAttributes(input,original)).status,'unavailable',
 'Already correct data must not be rewritten');
console.log('P53_KML_EXTENDED_REPAIR PASSED: unique line geometry, swapped rows, KML/KMZ, conflicts, changed vertices, duplicate geometry, XML attack, case-fold aliases, strict DATA_LOSS');
