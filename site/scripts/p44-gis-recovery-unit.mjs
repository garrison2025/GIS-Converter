/**
 * P44 deterministic GIS recovery guidance contract:
 * each error family returns safe literal instructions without copying
 * private source paths, coordinates or GDAL exception fields into the UI.
 */
import assert from 'node:assert/strict';
import {diagnoseGISFailure,GIS_RECOVERY_CATEGORIES} from '../src/lib/gis-error-guidance.mjs';
const cases=[
 ['Output integrity mismatch: expected 12, found 11. The generated file was withheld.',{code:'DATA_LOSS'},'data-loss'],
 ['GIS input rejected: Shapefile component .prj missing; source CRS must be declared.',{},'crs-missing'],
 ['GIS input rejected: mixed geometry families cannot safely become one Shapefile layer; split points, lines and polygons into separate files',{},'geometry-mixed'],
 ['GIS input rejected: null, unsupported or GeometryCollection features cannot safely become one Shapefile layer',{},'geometry-unsupported'],
 ['GIS input rejected: CSV row 3 has longitude outside WGS84 bounds',{},'csv-coordinates'],
 ['GIS input rejected: CSV row 2 has missing or non-decimal latitude',{},'csv-coordinates'],
 ['GIS input rejected: CSV must have one unambiguous longitude/lon/x and latitude/lat/y column',{},'csv-columns'],
 ['GIS input rejected: CSV must use valid UTF-8 encoding',{},'csv-encoding'],
 ['Legacy Shapefile DBF encoding could not be safely preserved. Export input layer with UTF-8',{},'legacy-encoding'],
 ['GIS input rejected: invalid ZIP header',{},'zip-damaged'],
 ['GIS input rejected: ZIP end-of-central-directory not found',{},'zip-damaged'],
 ['GIS input rejected: Shapefile component .dbf missing',{},'zip-parts'],
 ['GIS input rejected: exactly one .shp is required',{},'zip-parts'],
 ['GIS input rejected: encrypted ZIP unsupported',{},'zip-unsafe'],
 ['GIS input rejected: suspicious ZIP expansion ratio',{},'zip-unsafe'],
 ['GIS input rejected: XML DTD/entities unsupported',{},'xml-unsafe'],
 ['GIS input rejected: GeoJSON is not valid JSON',{},'geojson-invalid'],
 ['GIS input rejected: GeoJSON must be a non-empty FeatureCollection for Shapefile output',{},'geojson-invalid'],
 ['GIS input rejected: filename extension does not match selected source format',{},'format'],
 ['GIS input rejected: file empty or exceeds 15 MiB limit',{},'size'],
 ['Conversion timed out; the isolated worker was terminated.',{code:'TIMEOUT'},'timeout'],
 ['RuntimeError: memory allocation failed for dataset',{},'memory'],
 ['GDAL could not open shp dataset',{},'gdal-open'],
 ['Unknown EPSG / unsupported coordinate reference system',{},'crs-unknown'],
 ['Invalid geometry: self-intersection in polygon',{},'geometry-invalid'],
 ['Unmapped renderer crash with private coordinates 120.23456, 31.3321',{},'generic']
];
const sensitive=['/Users/alice/secret.shp','D:/Private/Tax.geojson',
 '120.23456','31.3321','client-contact=Jane'];
let passed=0;
for(const [message,options,expected] of cases){
 const contaminated=message+'; hidden secret /Users/alice/secret.shp D:/Private/Tax.geojson client-contact=Jane';
 const guidance=diagnoseGISFailure(contaminated,{...options,source:'shp',target:'geojson'});
 assert.equal(guidance.id,expected,message);
 assert(guidance.steps.length>=2&&guidance.steps.length<=4,
  'Remediation should be concise and executable for '+expected);
 assert(guidance.summary.length>=12&&guidance.title.length>0);
 assert.equal(guidance.route,'shp-to-geojson');
 const visible=JSON.stringify(guidance);
 for(const secret of sensitive)assert(!visible.includes(secret),
  'Unsafe GDAL or user data entered the recovery guidance: '+expected);
 assert(!/turn off.*safeguard|ignore.*warning|upload.*external/i.test(visible),
  'Do not recommend bypassing data integrity or privacy checks');
 passed++;
}
assert.equal(GIS_RECOVERY_CATEGORIES.length,25,
 'Error taxonomy unexpectedly changed: review matching precedence before modifying');
assert.equal(diagnoseGISFailure(new Error('unknown'),{source:'foo',target:'bar'}).route,null);
assert.equal(diagnoseGISFailure(new Error('permission denied')).id,'generic');
assert.equal(diagnoseGISFailure('Output integrity mismatch: unknown').canRetry,false);
assert.equal(diagnoseGISFailure('Conversion timed out',{code:'TIMEOUT'}).canRetry,true);
assert.equal(diagnoseGISFailure('Shapefile component .prj missing').id,'crs-missing');
console.log('P44_GIS_RECOVERY_UNIT PASSED: '+passed+' controlled failure classes, source-specific no-guess recovery, data-loss protection, safe privacy redaction');
