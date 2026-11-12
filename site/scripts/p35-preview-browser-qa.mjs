/**
 * P35 real browser GDAL/WASM preview checks. Results are sampled from the
 * actual downloaded GIS output, not the original source file. Test examples
 * are synthetic; no external basemap or geocoding requests.
 */
import fs from 'node:fs';
import {chromium,firefox,webkit} from 'playwright';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const origin=(process.env.GIS_BASE_URL||'https://gis-converter.pages.dev').replace(/\/+$/,'');
const local=origin.startsWith('http://127.0.0.1:');
const outfile=local?'p35-preview-local-results.json':'p35-preview-live-results.json';
const report={kind:'p35-actual-output-local-vector-preview',mode:local?'local':'public',
 origin,status:'FAILED',cases:[],failed:[],errors:[]};
const kml=(lon,lat,label)=>'<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>'+label+
 '</name><Point><coordinates>'+lon+','+lat+',0</coordinates></Point></Placemark></Document></kml>';
const polygon=JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',properties:{Name:'Park',Count:2},geometry:{type:'Polygon',
  coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]}}
]});
const csv='longitude,latitude,Name\n116.4,39.9,One\n';
const gpx='<?xml version="1.0"?><gpx version="1.1" creator="p35" xmlns="http://www.topografix.com/GPX/1/1">'+
 '<wpt lat="39.9" lon="116.4"><name>Test</name></wpt></gpx>';
function check(value,message){if(!value)throw Error(message)}
function fixture(value,name,mime='text/plain'){return {name,mimeType:mime,buffer:Buffer.from(value)}}
async function submit(page,slug,files){
 const response=await page.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
 check(response?.ok(),'Route unavailable '+slug);
 await page.locator('#file').setInputFiles(files);
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:125000})}
 catch{throw Error(slug+' conversion failed '+await page.locator('#error').textContent())}
 const dl=await Promise.all([page.waitForEvent('download',{timeout:15000}),page.locator('#download').click()]);
 const download=dl[0];
 return {name:download.suggestedFilename(),bytes:fs.readFileSync(await download.path())};
}
async function resultReady(page){
 check(await page.locator('#preview-panel').isVisible(),'Preview section is missing');
 const body=page.locator('#preview-body');
 check(await body.getAttribute('data-status')==='ready',
   'Actual output GIS preview was unavailable: '+await body.innerText());
 check(await page.locator('.preview-map svg').count()===1,'No vector SVG scene');
 check(await page.locator('#preview-feature-select option').count()>0,
  'Cannot select or inspect the plotted feature');
 check((await page.locator('#preview-bounds').count())===0||
  (await page.locator('.preview-bounds').innerText()).includes('WGS84'),
  'Preview coordinate bounding box missing');
 const requests=await page.evaluate(()=>performance.getEntriesByType('resource')
  .filter(x=>/tile\.openstreetmap|mapbox|maps\.google|api\.maptiler|leaflet/i.test(x.name))
  .map(x=>x.name));
 check(requests.length===0,'External maps requested for private GIS preview');
}
async function test(name,fn){
 const entry={name,status:'FAILED'},time=Date.now();
 report.cases.push(entry);
 try{Object.assign(entry,await fn(),{status:'PASSED',durationMs:Date.now()-time});
  console.log('P35_PREVIEW '+name+' PASSED')}
 catch(e){entry.error=String(e?.stack||e).slice(0,2200);report.failed.push(name);
  console.error('P35_PREVIEW '+name+' FAILED '+entry.error)}
}
let browser;
try{
 browser=await chromium.launch({headless:true});
 await test('kml_to_geojson_point_svg_fields_and_download',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  page.on('pageerror',e=>report.errors.push(String(e)));
  const out=await submit(page,'kml-to-geojson',fixture(kml(116.4,39.9,'Preview Test'),'one.kml'));
  check(out.name.endsWith('.geojson'),'Original GeoJSON download changed');
  const json=JSON.parse(out.bytes.toString('utf8'));
  check(json.features.length===1,'Converted output malformed');
  await resultReady(page);
  check((await page.locator('.preview-summary').innerText()).includes('1 of 1 features'),
   'GeoJSON sample count incorrect');
  check((await page.locator('.preview-fields').innerText()).includes('Preview Test'),
   'Actual converted output attributes not shown');
  return {mappedFeatures:1,actualOutputVerified:true};
 });
 await test('polygon_hole_to_shapefile_zip_svg_polygon_readback',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'geojson-to-shp',fixture(polygon,'park.geojson','application/geo+json'));
  check(out.name.endsWith('.zip'),'Original zipped Shapefile download changed');
  await resultReady(page);
  check(await page.locator('.preview-map svg path[fill-rule="evenodd"]').count()>0,
   'Polygon with hole is not drawn with evenodd SVG fill rule');
  return {polygonHoleDrawn:true,actualShapefileZIPPreview:true};
 });
 await test('kml_to_kmz_zip_readback_svg',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'kml-to-kmz',fixture(kml(116.4,39.9,'KMZ'),'in.kml'));
  check(out.name.endsWith('.kmz'),'Original KMZ download changed');
  await resultReady(page);
  check(await page.locator('.preview-map svg circle').count()===1,
   'KMZ point was not previewed from actual output');
  return {kmzPoint:true};
 });
 await test('gpx_timed_track_to_kmz_draws_actual_gx_track_line',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const timed='<?xml version="1.0" encoding="UTF-8"?>'+
   '<gpx version="1.1" creator="P35" xmlns="http://www.topografix.com/GPX/1/1">'+
   '<trk><name>Timed Preview</name><trkseg>'+
   '<trkpt lat="39.9" lon="116.4"><ele>20</ele><time>2026-01-01T00:00:00Z</time></trkpt>'+
   '<trkpt lat="39.91" lon="116.41"><ele>21</ele><time>2026-01-01T00:01:00Z</time></trkpt>'+
   '<trkpt lat="39.92" lon="116.42"><ele>22</ele><time>2026-01-01T00:02:00Z</time></trkpt>'+
   '</trkseg></trk></gpx>';
  const out=await submit(page,'gpx-to-kmz',
   fixture(timed,'timed.gpx','application/gpx+xml'));
  check(out.name.endsWith('.kmz'),'Actual timed GPX conversion did not return KMZ');
  await resultReady(page);
  check((await page.locator('.preview-summary').innerText()).includes('1 lines'),
   'Timed GPX track was not represented as one line');
  check(await page.locator('.preview-map svg path[fill="none"]').count()>=1,
   'Timed line SVG path missing');
  return {timedGpxTrackLine:true,source:'actual generated KMZ'};
 });
 await test('p38_real_public_etrex_timed_gpx_to_kmz_geometry_and_timestamp_readback',async()=>{
  // Licensed public fixture already used for independent P29 fidelity tests.
  // No private GPS data, and no coordinates are logged to CI.
  const page=await browser.newPage({acceptDownloads:true});
  const data=fs.readFileSync('test-fixtures/public-gpx/etrex20x-real-track.gpx');
  const out=await submit(page,'gpx-to-kmz',{
   name:'public-etrex20x.gpx',mimeType:'application/gpx+xml',buffer:data
  });
  check(out.name.endsWith('.kmz'),'Real GPX output did not produce KMZ');
  const zip=await JSZip.loadAsync(out.bytes);
  const entry=zip.file('doc.kml');
  check(entry,'Real GPX output KMZ has no doc.kml');
  const xml=await entry.async('string');
  const times=[...xml.matchAll(/<when\b[^>]*>/gi)].length;
  const coords=[...xml.matchAll(/<gx:coord\b[^>]*>/gi)].length;
  check(times===104&&coords===104,
   'Real-source GPS timeline and gx:Track positions were not paired 1:1');
  await resultReady(page);
  const summary=await page.locator('.preview-summary').innerText();
  check(summary.includes('104 vertices')&&summary.includes('1 lines'),
   'Real GPX output preview omitted timed track vertices');
  check(await page.locator('.preview-map svg path[fill="none"]').count()>=1,
   'Real public GPX converted track SVG is missing');
  return {realPublicFixture:true,timedVertices:104,pairedTimeElements:104,
   actualOutputKMZ:true,previewFromOutput:true};
 });
 await test('p39_real_csv_to_kml_quality_report_independently_checks_all_point_values',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const three='longitude,latitude,Name\n'+
   '-10,0,First\n0.153219,2.421738,Middle\n10,10,Last\n';
  const out=await submit(page,'csv-to-kml',fixture(three,'three-points.csv','text/csv'));
  check(out.name.endsWith('.kml'),'Actual CSV to KML download unavailable');
  const xml=out.bytes.toString('utf8');
  check((xml.match(/<Point\b/g)||[]).length===3,
   'Expected three independent point geometries in real converted KML');
  await resultReady(page);
  const [download]=await Promise.all([
   page.waitForEvent('download',{timeout:15000}),
   page.locator('#quality-download').click()
  ]);
  const report=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  check(report.kind==='local-structural-quality-report','Actual quality JSON missing');
  const value=report.checks.find(x=>x.id==='point-coordinate-values');
  check(value?.status==='pass',
   'Real GDAL conversion failed independent output point coordinate test: '+
    (value?.detail||'missing check'));
  check((report.checks.find(x=>x.id==='feature-count'))?.status==='pass',
   'Converted point feature count does not match source');
  check((report.checks.find(x=>x.id==='coordinate-bounds'))?.status==='pass',
   'Converted point bounds do not match source');
  check(!value.detail.includes('0.153219'),
   'Point-level private GIS coordinates leaked into quality check details');
  return {realWasmConversion:true,allThreePointValuesCompared:true,
   independentlyDownloadedReport:true};
 });
 await test('csv_to_kml_wgs84_point_and_attributes',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'csv-to-kml',fixture(csv,'points.csv','text/csv'));
  check(out.name.endsWith('.kml'),'Original KML download changed');
  await resultReady(page);
  check(await page.locator('.preview-map svg circle').count()===1,'KML point preview missing');
  return {csvWgs84Point:true};
 });
 await test('gpx_output_waypoint_readback_preview',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'kml-to-gpx',fixture(kml(116.4,39.9,'GPX'),'gps.kml'));
  check(out.name.endsWith('.gpx'),'Original GPX download changed');
  await resultReady(page);
  check(await page.locator('.preview-map svg circle').count()>=1,'GPX preview missing waypoint');
  return {gpxWaypointsPreviewed:true};
 });
 await test('kml_to_csv_point_readback_preview',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'kml-to-csv',fixture(kml(116.4,39.9,'CSV'),'point.kml'));
  check(out.name.endsWith('.csv'),'Original CSV download changed');
  await resultReady(page);
  return {csvGeoCoordinatesPreviewed:true};
 });
 await test('p37_dateline_kml_to_geojson_continuous_svg_and_unchanged_download',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const crossing='<?xml version="1.0" encoding="UTF-8"?>'+
   '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'+
   '<name>International Date Line</name><LineString><coordinates>'+
   '179.5,12,0 -179.5,13,0</coordinates></LineString></Placemark></Document></kml>';
  const out=await submit(page,'kml-to-geojson',
   fixture(crossing,'dateline.kml','application/vnd.google-earth.kml+xml'));
  check(out.name.endsWith('.geojson'),'Dateline result download must be GeoJSON');
  const geo=JSON.parse(out.bytes.toString('utf8'));
  const vertices=geo.features?.[0]?.geometry?.coordinates;
  check(Array.isArray(vertices)&&vertices.length===2,'Converted dateline line missing');
  check(Math.abs(vertices[0][0]-179.5)<0.001&&
    Math.abs(vertices[1][0]+179.5)<0.001,
    'Output geographic coordinates must NOT be shifted into SVG drawing frame');
  await resultReady(page);
  check(await page.locator('.preview-map svg').getAttribute('data-antimeridian-view')
   ==='unwrapped','SVG did not use continuous antimeridian drawing coordinates');
  const labels=await page.locator('.preview-bounds').allInnerTexts();
  check(labels.length===2&&labels[0].includes('WGS84')&&
   labels[1].includes('179.5')&&labels[1].includes('180.5'),
   'Original WGS84 bounds and shifted drawing bounds are not separately visible');
  check((await page.locator('.preview-warnings').innerText()).includes('shortest-longitude-arc'),
   'Antimeridian geometry assumption warning missing');
  check(await page.locator('.preview-map svg path[fill="none"]').count()>=1,
   'Unwrapped SVG line path missing');
  return {actualConvertedGeoJSONUnchanged:true,datelineSVGUnwrapped:true};
 });
 await test('two_file_batch_preview_switch_and_no_download_regression',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  const out=await submit(page,'kml-to-geojson',[
   fixture(kml(116.4,39.9,'First'),'first.kml'),
   fixture(kml(114.1,22.5,'Second'),'second.kml')
  ]);
  check(out.name.endsWith('batch-2.zip'),'Batch download changed');
  await resultReady(page);
  check(await page.locator('#preview-file-select option').count()===2,
   'Batch preview cannot choose individual source file');
  await page.locator('#preview-file-select').selectOption('1');
  await resultReady(page);
  check((await page.locator('.preview-fields').innerText()).includes('Second'),
   'Preview did not switch to second converted output');
  return {batchPreviewChoices:2};
 });
 await test('changing_file_clears_all_previous_preview_and_download',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await submit(page,'kml-to-geojson',fixture(kml(116.4,39.9,'Old'),'old.kml'));
  await resultReady(page);
  await page.locator('#file').setInputFiles(fixture(kml(114.1,22.5,'New'),'new.kml'));
  check(await page.locator('#preview-panel').isHidden(),'Old geographic map still shown for a new file');
  check(await page.locator('#preview-panel').locator('svg').count()===0,
   'Old SVG geometry was retained after source file changed');
  check((await page.locator('#download').getAttribute('href'))===null,
   'Old conversion download href leaked');
  return {stalePreviewCleared:true};
 });
 await test('bad_input_does_not_show_preview_or_stale_output',async()=>{
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(origin+'/converter/kml-to-geojson/');
  await page.locator('#file').setInputFiles(fixture('not valid KML','broken.kml'));
  await page.locator('#submit').click();
  await page.locator('#error').waitFor({state:'visible',timeout:70000});
  check(await page.locator('#preview-panel').isHidden(),'Invalid conversion exposed preview');
  check(await page.locator('#result').isHidden(),'Invalid conversion exposed download');
  return {invalidInputSafe:true};
 });
 // At least one independent engine beyond Chromium must render the local SVG.
 await test('firefox_rendered_preview_with_real_gdal_output',async()=>{
  const firefoxBrowser=await firefox.launch({headless:true});
  try{
   const page=await firefoxBrowser.newPage({acceptDownloads:true});
   await submit(page,'kml-to-geojson',fixture(kml(116.4,39.9,'Firefox'),'fx.kml'));
   await resultReady(page);
   return {engine:'Firefox'};
  }finally{await firefoxBrowser.close()}
 });
 await test('webkit_rendered_preview_with_real_gdal_output',async()=>{
  const browserKit=await webkit.launch({headless:true});
  try{
   const page=await browserKit.newPage({acceptDownloads:true});
   await submit(page,'kml-to-geojson',fixture(kml(116.4,39.9,'WebKit'),'wk.kml'));
   await resultReady(page);
   return {engine:'WebKit'};
  }finally{await browserKit.close()}
 });
 report.status=report.failed.length===0&&report.cases.length===15&&!report.errors.length?
  'PASSED':'FAILED';
}catch(e){report.fatal=String(e?.stack||e).slice(0,2500)}
finally{
 report.passed=report.cases.filter(x=>x.status==='PASSED').length;
 fs.writeFileSync(outfile,JSON.stringify(report,null,2));
 console.log('P35_PREVIEW_SUMMARY '+JSON.stringify({
  status:report.status,passed:report.passed,expected:15,failed:report.failed,
  pageErrors:report.errors,fatal:report.fatal
 }));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
