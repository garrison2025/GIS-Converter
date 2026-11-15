/**
 * P44: deterministic, privacy-preserving GIS conversion error guidance.
 *
 * A browser/WASM/OGR error can contain raw feature coordinates, local paths,
 * SQL driver text or attributes. These must NEVER be echoed into the UI.
 * We inspect the error class and return ONLY curated literal wording.
 * These tips are suggestions, not auto-repair, CRS inference or data-loss
 * certification. All conversion guards remain authoritative.
 */

const make=(id,title,summary,steps,canRetry=false)=>Object.freeze({
 id,title,summary,steps:Object.freeze(steps),canRetry
});
const guidance={
 'data-loss':make('data-loss','Output geometry or attributes changed',
  'Output integrity mismatch: the file was withheld to prevent detected GIS data loss.',
  ['Open the source in QGIS and compare feature count, coordinates, geometry parts and attributes.',
   'Repair invalid geometry, multipart boundaries or DBF fields in a copy of the source; export again.',
   'Retry the conversion and inspect the new quality report. Do not use the withheld output.']),
 'crs-missing':make('crs-missing','Shapefile coordinate reference system missing',
  'Shapefile component .prj missing; source CRS must be declared.',
  ['Open the source layer in QGIS and confirm its actual coordinate reference system using authoritative metadata.',
   'Only if that CRS is known, export the layer with its correct .prj and then ZIP the same-name .shp, .shx, .dbf and .prj files.',
   'Do not assign EPSG:4326 solely to make the error disappear; assigning the wrong CRS moves features.']),
 'crs-unknown':make('crs-unknown','Coordinate reference system could not be confirmed',
  'The file has an unknown or unsupported CRS; coordinates cannot safely be reprojected.',
  ['Find the source CRS in the original GIS export/project or provider documentation.',
   'With a verified CRS, re-export or reproject in QGIS to EPSG:4326, preserving attributes.',
   'Retry and compare output coordinates in QGIS. Do not guess the source EPSG code.']),
 'geometry-mixed':make('geometry-mixed','Mixed geometry types need separate layers',
  'mixed geometry families cannot safely become one Shapefile layer.',
  ['In QGIS, separate Point/MultiPoint, LineString/MultiLineString and Polygon/MultiPolygon into distinct layers.',
   'Export each layer as GeoJSON with its CRS preserved or explicitly transformed.',
   'Convert each file independently and compare feature counts and geometry components.']),
 'geometry-unsupported':make('geometry-unsupported','This geometry structure is not supported',
  'Null, unsupported or GeometryCollection features cannot safely become one Shapefile layer.',
  ['Inspect the source geometry types and null/empty shapes in your GIS editor.',
   'Export only supported nonempty Point, MultiPoint, LineString, MultiLineString, Polygon or MultiPolygon features of one family.',
   'Retain an unchanged original copy and verify the number of features after filtering.']),
 'geometry-invalid':make('geometry-invalid','GIS geometry may need repair',
  'The conversion could not safely process the supplied geometry.',
  ['Open the original in QGIS and run its Check Validity tool; review reported invalid geometries.',
   'Repair only confirmed issues on a copy and compare the resulting geometries before exporting.',
   'Retry with the repaired file and independently review geometry counts, parts and holes.']),
 'csv-coordinates':make('csv-coordinates','CSV coordinates need WGS84 longitude/latitude',
  'CSV longitude outside WGS84 bounds or latitude outside WGS84 bounds.',
  ['Confirm that coordinates are decimal degrees in WGS84 (EPSG:4326), not projected meters.',
   'Check longitude is between -180 and 180 and latitude is between -90 and 90; remove invalid or empty coordinate rows.',
   'For coordinates in another CRS, reproject them in GIS software before exporting the CSV.']),
 'csv-columns':make('csv-columns','CSV coordinate columns could not be recognized',
  'CSV must contain one unambiguous longitude and latitude column.',
  ['Use a UTF-8 CSV with exactly one longitude/lon/x column and one latitude/lat/y column.',
   'Ensure every row has the same number of columns and the coordinate cells contain decimal numbers.',
   'Save as comma-separated UTF-8 (RFC 4180-style quoting) and retry.']),
 'csv-encoding':make('csv-encoding','CSV text encoding is not UTF-8',
  'CSV must use valid UTF-8 encoding.',
  ['In Excel or your GIS editor, explicitly export the CSV as UTF-8.',
   'Confirm the original longitude/latitude columns and accented or Chinese labels survive the export.',
   'Retry with the new UTF-8 file; do not use a lossy encoding conversion.']),
 'legacy-encoding':make('legacy-encoding','Shapefile DBF character encoding is ambiguous',
  'Legacy Shapefile DBF encoding could not be safely preserved.',
  ['In QGIS, open the Shapefile using the known encoding shown by its .cpg or original producer.',
   'Check accented and Chinese fields in the attribute table, then export the layer with UTF-8 encoding.',
   'ZIP the resulting .shp/.shx/.dbf/.prj and optional .cpg together, and retry. Do not silently replace garbled text.']),
 'zip-damaged':make('zip-damaged','GIS archive is malformed or incomplete',
  'The selected ZIP/KMZ has an invalid ZIP header or directory.',
  ['Create a fresh ZIP or KMZ from the original GIS export; do not just rename a file extension.',
   'For Shapefile ZIPs, include one matching .shp, .shx, .dbf and .prj at ZIP root; for KMZ, include one KML.',
   'Check that the archive opens locally before retrying, and use an unencrypted ZIP.']),
 'zip-parts':make('zip-parts','Shapefile ZIP components are incomplete',
  'Shapefile ZIP must contain one matching .shp, .shx, .dbf and .prj.',
  ['Re-export the complete layer from QGIS, with its known source CRS.',
   'Put .shp, .shx, .dbf, .prj and optional .cpg in the same ZIP root under one shared base name.',
   'Do not upload a lone .shp or rename a nested project archive to .zip.']),
 'zip-unsafe':make('zip-unsafe','Archive exceeds secure ZIP handling limits',
  'The archive uses an unsupported or unsafe ZIP structure.',
  ['Export a single GIS dataset as an unencrypted, conventional ZIP/KMZ with safe relative paths.',
   'Remove nested archives, symlinks or unsupported compression, not GIS records themselves.',
   'If the dataset is too large, split it into smaller geographic or feature-based files and verify totals.']),
 'xml-unsafe':make('xml-unsafe','XML input contains unsupported directives',
  'XML DTD/entities or invalid text encoding are unsupported for local GIS conversion.',
  ['Re-export the KML/GPX file from a trusted GIS application as normal UTF-8 XML.',
   'Do not enable external XML entity processing or paste unknown entities into the file.',
   'Retry with the re-exported KML/GPX and check geometry and metadata.']),
 'geojson-invalid':make('geojson-invalid','GeoJSON input is not a valid FeatureCollection',
  'GeoJSON is not valid JSON or lacks a nonempty FeatureCollection.',
  ['Validate the file as UTF-8 JSON and confirm its root is a FeatureCollection with nonempty features.',
   'Correct syntax errors and export a new GeoJSON from QGIS while preserving its real CRS.',
   'Retry and inspect the feature count; do not repair by dropping unknown features silently.']),
 'format':make('format','Wrong input format or file extension',
  'The filename extension does not match the selected source format.',
  ['Choose the matching converter route for the file you actually have.',
   'Export a genuine file in that format; changing its extension does not convert it.',
   'For Shapefile use a ZIP containing same-name sidecars; then reselect it.']),
 'size':make('size','Input or output exceeds safe processing limits',
  'The GIS file exceeds the 15 MiB per-file or applicable mini-batch size limit.',
  ['Use one file at a time, particularly on phones or low-memory devices.',
   'Split the source using a GIS editor into smaller parts while recording original feature totals.',
   'Avoid losing geometries or columns while shrinking the file; independently verify all parts.']),
 'timeout':make('timeout','GIS conversion exceeded the allowed time',
  'Conversion timed out; the isolated worker was terminated.',
  ['Try a smaller file or fewer geometries; avoid running several browser conversions at once.',
   'Enable memory-saving mode to skip the optional map preview, or use a desktop GIS application for large files.',
   'Reselect the original file and retry; do not trust an incomplete or absent download.'],true),
 'memory':make('memory','Browser did not have sufficient resources',
  'The isolated GIS conversion stopped due to a browser or worker resource error.',
  ['Try one smaller file in memory-saving mode and close other heavy tabs.',
   'If it still fails, use a desktop GIS editor to split/convert the input.',
   'Only use a completed download that includes a quality report; verify it in GIS software.'],true),
 'gdal-open':make('gdal-open','GIS file could not be opened safely',
  'GDAL could not open the selected GIS input.',
  ['Check the format and all required companion files. For Shapefile, confirm the source CRS from its .prj.',
   'Try opening the original in QGIS; re-export a valid copy without losing geometries or fields.',
   'Retry with the re-exported file and inspect the quality report.'],true),
 'generic':make('generic','GIS conversion did not complete',
  'GIS conversion failed. No completed output file was made available.',
  ['Verify the source format, file integrity, geometry types and CRS in QGIS.',
   'Retry one smaller file in memory-saving mode, or re-export it with a known CRS and UTF-8 text.',
   'If the problem repeats, keep the original file and report the converter route and guidance code, not private GIS data.'],true)
};
const test=(expression,s)=>expression.test(s);
export function diagnoseGISFailure(error,{code,source,target}={}){
 const raw=typeof error==='string'?error:
  error instanceof Error?error.message:String(error??'');
 const message=raw.slice(0,8192);
 const kind=String(code||((error&&typeof error==='object')?error.code:'')||'').toUpperCase();
 let id='generic';
 // Precedence matters: explicit data loss and invalid/missing CRS must never
 // be presented as a simple retryable runtime error.
 if(kind==='DATA_LOSS'||test(/output integrity mismatch|generated file was withheld/i,message))id='data-loss';
 else if(test(/shapefile component \.prj missing|source CRS must be declared/i,message))id='crs-missing';
 else if(test(/unknown|unrecognized|missing|unsupported/i,message)&&
   test(/\bCRS\b|coordinate reference|spatial reference|EPSG|reproject/i,message))id='crs-unknown';
 else if(test(/mixed geometry families/i,message))id='geometry-mixed';
 else if(test(/geometrycollection|unsupported or geometrycollection|(?:null|unsupported).*features/i,message))id='geometry-unsupported';
 else if(test(/legacy shapefile dbf encoding|cp1252.*could not|codepage|unsupported character encoding/i,message))id='legacy-encoding';
 else if(test(/\bCSV\b/i,message)&&test(/(?:outside WGS84 bounds)|(?:missing or non-decimal)|(?:longitude.*latitude.*bounds)/i,message))id='csv-coordinates';
 else if(test(/\bCSV\b/i,message)&&test(/UTF-8|encoding|NUL bytes/i,message))id='csv-encoding';
 else if(test(/\bCSV\b/i,message))id='csv-columns';
 else if(test(/shapefile component \.(?:shp|shx|dbf) missing|exactly one \.shp is required|multiple shapefiles unsupported/i,message))id='zip-parts';
 else if(test(/invalid ZIP header|ZIP end-of-central-directory not found|malformed central directory|invalid local ZIP header|(?:zip|archive).*corrupt/i,message))id='zip-damaged';
 else if(test(/\bZIP\b|KMZ|archive/i,message)&&
  test(/unsafe|unsupported|encrypted|too many|expansion|path|nested|symlink|checksum|boundar|overlap|entries|compression/i,message))id='zip-unsafe';
 else if(test(/XML DTD|<!DOCTYPE|<!ENTITY|XML entit|UTF-16|NUL bytes/i,message))id='xml-unsafe';
 else if(test(/GeoJSON is not valid JSON|GeoJSON must be a non-empty FeatureCollection/i,message))id='geojson-invalid';
 else if(test(/filename extension does not match|unsupported source format|unsupported GIS format/i,message))id='format';
 else if(test(/invalid geometry|self-intersect|ring not closed|topolog|geos exception/i,message))id='geometry-invalid';
 else if(kind==='TIMEOUT'||test(/conversion timed out|time limit|timed out/i,message))id='timeout';
 else if(test(/file empty|15 MiB|30 MiB|12 MiB|24 MiB|96 MiB|larger|exceeds .*limit|too large|maximum size|too many files|3 files/i,message))id='size';
 else if(test(/out of memory|memory allocation|cannot allocate|memory exhausted|abort\(|runtimeerror:.*memory/i,message))id='memory';
 else if(test(/GDAL could not open|failed to open|not recognized as a supported file format/i,message))id='gdal-open';
 const selected=guidance[id];
 // The format context is a short, internal route code, never supplied file
 // content or filename; omit it from UI when unknown.
 const route=/^(shp|kml|kmz|geojson|gpx|csv)$/.test(source)&&
  /^(shp|kml|kmz|geojson|gpx|csv)$/.test(target)?source+'-to-'+target:null;
 return {...selected,steps:[...selected.steps],route};
}
export const GIS_RECOVERY_CATEGORIES=Object.freeze(Object.keys(guidance));
