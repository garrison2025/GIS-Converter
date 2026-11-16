/**
 * P45: single, light-weight source of truth for supported converter routes.
 * Keep the catalogue separate from GDAL/JSZip so the homepage quick picker
 * does not download the conversion engine while browsing.
 */
export const routes=Object.freeze([
 ['kmz-to-shp','kmz','shp'],['kml-to-shp','kml','shp'],['shp-to-kml','shp','kml'],
 ['kmz-to-gpx','kmz','gpx'],['kml-to-gpx','kml','gpx'],['gpx-to-kml','gpx','kml'],
 ['kmz-to-kml','kmz','kml'],['kml-to-kmz','kml','kmz'],['geojson-to-shp','geojson','shp'],
 ['shp-to-geojson','shp','geojson'],['geojson-to-kml','geojson','kml'],
 ['kml-to-geojson','kml','geojson'],['shp-to-kmz','shp','kmz'],
 ['kml-to-csv','kml','csv'],['kmz-to-csv','kmz','csv'],
 ['csv-to-kml','csv','kml'],['csv-to-kmz','csv','kmz'],
 ['gpx-to-kmz','gpx','kmz'],['kmz-to-geojson','kmz','geojson']
].map(tuple=>Object.freeze(tuple)));
export const FORMAT_CODES=Object.freeze(['kml','kmz','shp','geojson','gpx','csv']);
