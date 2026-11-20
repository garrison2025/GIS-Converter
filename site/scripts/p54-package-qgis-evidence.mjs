/**
 * P54: package ONLY known synthetic, QGIS-verified files for human release
 * signoff. Fail closed when real browser/QGIS acceptance failed or when a
 * browser output differs from its captured SHA-256 evidence.
 *
 * Run after the independent PyQGIS Qt step. This does not certify manual
 * QGIS operation, a physical mobile device, or a production release.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const required = Object.freeze([
  'p43-browser-polygon.shp', 'p43-browser-polygon.shx',
  'p43-browser-polygon.dbf', 'p43-browser-polygon.prj',
  'p43-native-cp1252.shp', 'p43-native-cp1252.shx',
  'p43-native-cp1252.dbf', 'p43-native-cp1252.prj',
  'p43-native-cp1252.cpg',
  'p43-native-epsg3857.shp', 'p43-native-epsg3857.shx',
  'p43-native-epsg3857.dbf', 'p43-native-epsg3857.prj',
  'p43-browser-cp1252.geojson', 'p43-browser-reprojected.geojson',
  'p53-browser-survey-lines.kml',
  'p53-browser-survey-lines-roundtrip.geojson',
  'browser-evidence.json', 'qgis-desktop-evidence.json',
  'p43-qgis-desktop-map.png'
]);
const browserCases = Object.freeze({
  'p53-browser-survey-lines.kml':
    'browser_two_lines_geojson_to_kml_with_attribute_pairing',
  'p53-browser-survey-lines-roundtrip.geojson':
    'browser_two_lines_kml_to_geojson_for_independent_qgis',
  'p43-browser-cp1252.geojson':
    'native_cp1252_shape_to_browser_geojson',
  'p43-browser-reprojected.geojson':
    'native_epsg3857_shp_to_browser_wgs84_geojson'
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function packageQgisReleaseEvidence(options = {}) {
  const source = path.resolve(options.source || 'p43-qgis-fixtures');
  const output = path.resolve(options.output || 'p54-qgis-release-artifacts');
  const browser = readJson(path.join(source, 'browser-evidence.json'));
  const qgis = readJson(path.join(source, 'qgis-desktop-evidence.json'));

  assert.equal(browser.status, 'PASSED', 'Browser GIS fixture gate must pass');
  assert.equal(qgis.status, 'PASSED', 'Independent installed QGIS Qt gate must pass');
  assert.equal(qgis.manualQgisInteraction, 'NOT_TESTED');
  assert.equal(qgis.physicalDevice, 'NOT_TESTED');
  assert.equal(browser.physicalDevice, 'NOT_TESTED');
  assert(Array.isArray(qgis.checks) && qgis.checks.length >= 12 &&
    qgis.checks.every(item => item.status === 'PASSED'),
    'QGIS must positively pass all layer, attribute and canvas checks');
  assert(qgis.checks.some(item =>
    item.name === 'QGIS_gui_real_KML_and_roundtrip_line_vertices_attributes'),
    'Independent QGIS survey line pairing evidence missing');
  assert(qgis.checks.some(item =>
    item.name === 'QGIS_actual_Qt_map_canvas_rendered_and_screenshot'),
    'Real Qt map canvas evidence missing');
  assert(Array.isArray(browser.cases), 'Browser GIS cases are absent');

  // Before creating any public artifact, read only explicitly named synthetic
  // fixture files. Never recursively archive the runner's working directory.
  const entries = [];
  const bytesByName = new Map();
  for (const name of required) {
    const file = path.join(source, name);
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink(),
      'Fixture must be a regular file: ' + name);
    assert(stat.size > 0 && stat.size <= 12 * 1024 * 1024,
      'Synthetic QGIS fixture outside safe size bounds: ' + name);
    const bytes = fs.readFileSync(file);
    bytesByName.set(name, bytes);
    entries.push({file: 'qgis-fixtures/' + name, bytes: bytes.length,
      sha256: sha(bytes)});

    if (name.endsWith('.shp') || name.endsWith('.shx')) {
      assert(bytes.length >= 100 && bytes.readUInt32BE(0) === 9994,
        'Invalid Shapefile component: ' + name);
    }
    if (name.endsWith('.geojson')) {
      const value = JSON.parse(bytes.toString('utf8'));
      assert(value.type === 'FeatureCollection' &&
        Array.isArray(value.features) && value.features.length > 0,
        'Invalid browser GeoJSON: ' + name);
    }
    if (name.endsWith('.kml')) {
      assert(/<kml[\s>]/i.test(bytes.toString('utf8')),
        'Invalid browser KML file');
    }
  }
  for (const [file, caseName] of Object.entries(browserCases)) {
    const matching = browser.cases.filter(item => item.name === caseName);
    assert.equal(matching.length, 1, 'Required browser case missing: ' + caseName);
    const captured = matching[0];
    assert.equal(sha(bytesByName.get(file)), captured.sha256,
      'Browser output changed after source evidence capture: ' + file);
    assert.equal(bytesByName.get(file).length, captured.bytes,
      'Browser output size differs from source evidence: ' + file);
  }
  assert(bytesByName.get('p43-qgis-desktop-map.png').subarray(0,8)
    .equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'QGIS Qt screenshot is not PNG');

  // Write output only after all checks pass. Remove stale output from retries.
  fs.rmSync(output, {recursive: true, force: true});
  const targetDir = path.join(output, 'qgis-fixtures');
  fs.mkdirSync(targetDir, {recursive: true});
  for (const [name, bytes] of bytesByName) {
    fs.writeFileSync(path.join(targetDir, name), bytes, {flag: 'wx'});
  }
  const manifest = {
    schemaVersion: 1,
    status: 'AUTOMATED_QGIS_PASSED_MANUAL_NOT_TESTED',
    expectedCommit: options.commit || process.env.GIS_EXPECTED_COMMIT || null,
    browserOrigin: browser.origin,
    independentQgisVersion: qgis.qgisVersion || null,
    manualQgisInteraction: 'NOT_TESTED',
    physicalDevice: 'NOT_TESTED',
    digest: 'SHA-256',
    files: entries
  };
  fs.writeFileSync(path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)) {
  try {
    const manifest = packageQgisReleaseEvidence();
    console.log('P54_QGIS_ARTIFACTS PASSED ' + JSON.stringify({
      files: manifest.files.length, commit: manifest.expectedCommit,
      status: manifest.status
    }));
  } catch (error) {
    console.error('P54_QGIS_ARTIFACTS FAILED: ' + error.message);
    process.exitCode = 1;
  }
}
