/**
 * P50: independent, synthetic CSV/KML/KMZ/GeoJSON attribute byte scenarios.
 * No GDAL oracle: mutated outputs must be detected by the actual inspector.
 */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {inspectCrossFormatAttributeFidelity} from '../src/lib/cross-format-attribute-fidelity.mjs';
import {assertNoDetectedCriticalDataLoss} from '../src/lib/quality-report.mjs';
const enc=new TextEncoder(),u=s=>enc.encode(s);
const csv=u('longitude,latitude,Name,Code,Note\n116.4,39.9,Café,00123,"A&B, 中文"\n');
const kml=(code='00123',note='A&amp;B, 中文')=>u(
 '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+
 '<Placemark><name>Café</name><ExtendedData>'+
 '<Data name="Code"><value>'+code+'</value></Data>'+
 '<Data name="Note"><value>'+note+'</value></Data>'+
 '</ExtendedData><Point><coordinates>116.4,39.9,0</coordinates></Point>'+
 '</Placemark></Document></kml>');
const json=props=>u(JSON.stringify({type:'FeatureCollection',features:[{
 type:'Feature',properties:props,geometry:{type:'Point',coordinates:[116.4,39.9]}
}]}));
const z=async bytes=>{
 const arc=new JSZip();arc.file('doc.kml',bytes);
 return arc.generateAsync({type:'uint8array',compression:'STORE'});
};
async function status(src,sf,out,of){
 const r=await inspectCrossFormatAttributeFidelity(src,sf,out,of);
 assert(!JSON.stringify(r).includes('Café')&&!JSON.stringify(r).includes('中文')&&
 !JSON.stringify(r).includes('00123')&&!JSON.stringify(r).includes('116.4'),
  'User attributes or coordinates leaked into quality details');
 return r;
}
const accepted=await status(csv,'csv',kml(),'kml');
assert.equal(accepted.status,'pass',accepted.detail);
const packed=await z(kml());
assert.equal((await status(csv,'csv',packed,'kmz')).status,'pass');
assert.equal((await status(packed,'kmz',kml(),'kml')).status,'pass');
const changed=await status(csv,'csv',kml('123'),'kml');
assert.equal(changed.status,'review','CSV leading zeros are a comparable lexical value');
assert.throws(()=>assertNoDetectedCriticalDataLoss({
 checks:[{id:'cross-format-attributes',...changed}]
}),{code:'DATA_LOSS'});
const missing=await status(csv,'csv',u(
 '<kml><Document><Placemark><name>Café</name><Point><coordinates>116.4,39.9</coordinates></Point></Placemark></Document></kml>'),'kml');
assert.equal(missing.status,'review','Omitted named attributes must not be silently accepted');
const csvOutput=u('X,Y,Name,Code,Note\n116.4,39.9,Café,00123,"A&B, 中文"\n');
assert.equal((await status(kml(),'kml',csvOutput,'csv')).status,'pass',
 'KML ExtendedData and Placemark name should match CSV coordinate-derived columns');
const geo=json({Name:'Café',Code:'00123',Note:'A&B, 中文'});
assert.equal((await status(kml(),'kml',geo,'geojson')).status,'pass');
assert.equal((await status(kml(),'kml',json({Name:'Café',Code:123,Note:'A&B, 中文'}),'geojson')).status,'review',
 'Known identifier leading zeros changed by numeric coercion');
assert.equal((await status(geo,'geojson',kml(),'kml')).status,'pass');
const numeric=json({Name:'Café',Count:3000000000000,Note:'A&B, 中文'});
const numericKml=u('<kml><Document><Placemark><name>Café</name>'+
 '<ExtendedData><Data name="Count"><value>3000000000000</value></Data>'+
 '<Data name="Note"><value>A&amp;B, 中文</value></Data></ExtendedData>'+
 '<Point><coordinates>116.4,39.9</coordinates></Point></Placemark></Document></kml>');
assert.equal((await status(numeric,'geojson',numericKml,'kml')).status,'unavailable',
 'KML text cannot certify original GeoJSON numeric type');
const changedNumeric=u(new TextDecoder().decode(numericKml).replace('3000000000000','2999999999999'));
assert.equal((await status(numeric,'geojson',changedNumeric,'kml')).status,'review',
 'Actual numeric magnitude change must be detected');
const blank=u('longitude,latitude,Name,Note\n116.4,39.9,Café,\n');
assert.equal((await status(blank,'csv',u('<kml><Document><Placemark><name>Café</name>'+
 '<Point><coordinates>116.4,39.9</coordinates></Point></Placemark></Document></kml>'),'kml')).status,
 'unavailable','CSV blank is not a nonempty certified attribute');
const duplicate=u('longitude,latitude,Name\n116.4,39.9,One\n116.4,39.9,Two\n');
assert.equal((await status(duplicate,'csv',kml(),'kml')).status,'unavailable',
 'Duplicate/ambiguous point geometry cannot prove attribute row alignment');
const invalid=u('<!DOCTYPE kml [<!ENTITY xx "unsafe">]><kml><Placemark/></kml>');
assert.equal((await status(csv,'csv',invalid,'kml')).status,'unavailable',
 'XML entity and DTD processing remains fail-closed as unverifiable');
console.log('P50_CROSS_ATTR PASSED: 9-route-safe point values, CSV lexical identifiers, KML XML entities, exact mismatch DATA_LOSS, KMZ, ambiguous null/number/coordinates, no private data');
