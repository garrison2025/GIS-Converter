export const formats={
 kml:{name:'KML',long:'Keyhole Markup Language',accept:'.kml',help:'Upload a standalone .kml file containing geographic points, paths or polygons.',features:'KML is common in Google Earth and supports geometries, descriptions and styling. Styling may change during conversion.'},
 kmz:{name:'KMZ',long:'Compressed KML archive',accept:'.kmz',help:'Upload a .kmz archive containing exactly one KML document. Encrypted and oversized archives are blocked.',features:'KMZ bundles a KML document with optional linked resources. This converter preserves geometries but may not preserve archive attachments or styles.'},
 shp:{name:'SHP',long:'ESRI Shapefile',accept:'.zip',help:'Upload a .zip with one matching .shp, .shx, .dbf and .prj, preferably with a UTF-8 .cpg file.',features:'A Shapefile is a group of files. A declared coordinate reference system (.prj) is required; field names can be truncated.'},
 geojson:{name:'GeoJSON',long:'Geographic JSON',accept:'.json,.geojson',help:'Upload a .geojson or .json GeoJSON FeatureCollection with a declared WGS84-style longitude/latitude geometry.',features:'GeoJSON stores geometries and attributes in JSON. Check how other formats represent field types and three-dimensional coordinates.'},
 gpx:{name:'GPX',long:'GPS Exchange Format',accept:'.gpx',help:'Upload an XML-based .gpx file containing waypoints, routes or tracks.',features:'GPX is designed for GPS waypoints, tracks and routes. Polygons and some custom fields may not be representable.'},
 csv:{name:'CSV',long:'Comma-Separated Values',accept:'.csv',help:'Use UTF-8 CSV containing longitude and latitude columns (or lon/lat, x/y) in decimal degrees.',features:'CSV holds tabular point coordinates. This tool expects separate longitude and latitude fields; arbitrary WKT geometries are not interpreted as source features.'}
};
export const notes={
 'kmz-to-shp':{context:'Move Google Earth KMZ geometry into a GIS desktop workflow as a zipped Shapefile.',caution:'Archive resources and KML styling are not SHP fields. Review field names and geometry type.'},
 'kml-to-shp':{context:'Convert Google Earth KML vector features into Shapefile components for GIS software.',caution:'One Shapefile layer supports one geometry family; output may not preserve complex styling.'},
 'shp-to-kml':{context:'Use Shapefile features from a GIS project in KML viewers such as Google Earth.',caution:'The source ZIP must include a .prj; verify projected coordinates are mapped correctly to WGS84.'},
 'kmz-to-gpx':{context:'Extract compatible KML waypoint or line geometry from KMZ into a GPS exchange file.',caution:'GPX does not support polygons. Some labels and style information may be dropped.'},
 'kml-to-gpx':{context:'Export compatible KML points or paths for GPS and navigation applications.',caution:'GPX has limited geometry and metadata support, especially for polygons.'},
 'gpx-to-kml':{context:'View GPS tracks, routes or waypoints as KML in Google Earth or other mapping tools.',caution:'Check waypoint names and track organization after conversion.'},
 'kmz-to-kml':{context:'Extract KML geometry from a compressed KMZ archive.',caution:'Embedded images and linked KMZ resources are not automatically extracted into the downloaded KML.'},
 'kml-to-kmz':{context:'Package KML geography into the compressed KMZ file format.',caution:'External resource links are not automatically downloaded or embedded.'},
 'geojson-to-shp':{context:'Prepare GeoJSON vector features for desktop GIS workflows that require Shapefile files.',caution:'Shapefile field lengths, field types and geometry families can constrain the output.'},
 'shp-to-geojson':{context:'Convert a zipped Shapefile layer with known source CRS into portable GeoJSON.',caution:'Upload all required SHP components including .prj; verify properties and coordinate transformation.'},
 'geojson-to-kml':{context:'Create KML geometry from GeoJSON for a map viewer.',caution:'Complex GeoJSON properties may not map directly to KML descriptions or ExtendedData.'},
 'kml-to-geojson':{context:'Turn KML vector geography into GeoJSON features for web maps and modern GIS tools.',caution:'Check the generated feature properties and geometry before using it downstream.'},
 'shp-to-kmz':{context:'Create compressed KML geometry from Shapefile features for Google Earth workflows.',caution:'Shapefile attributes may not appear in KMZ exactly as in the original GIS layer.'},
 'kml-to-csv':{context:'Export KML point geometry and available attributes into a spreadsheet-friendly CSV.',caution:'CSV tabular output is best for points; complex lines and polygons require other formats.'},
 'kmz-to-csv':{context:'Create a coordinate and attribute CSV from KMZ point features.',caution:'Linked archive resources, symbology and non-point geometry cannot be fully represented as CSV rows.'},
 'csv-to-kml':{context:'Turn longitude/latitude spreadsheet rows into KML points for mapping.',caution:'Longitude and latitude must be in decimal degrees (WGS84). Check column headings and coordinates.'},
 'csv-to-kmz':{context:'Convert coordinate CSV rows to compressed KML points.',caution:'Only geocoded point fields are converted; do not expect CSV formatting or formulas to carry over.'},
 'gpx-to-kmz':{context:'Prepare GPS waypoints or tracks for compressed KML viewers.',caution:'Some GPX device-specific extensions are not supported by KML and can be lost.'},
 'kmz-to-geojson':{context:'Use compressed KML features as GeoJSON in a web map or GIS application.',caution:'Embedded images and styling resources are not converted into GeoJSON geometry.'}
};
export function getRouteNote(slug,source,target){
 const entry=notes[slug]||{context:'Convert '+source.toUpperCase()+' to '+target.toUpperCase()+'.',caution:'Verify the output before use.'};
 return {...entry,source:formats[source],target:formats[target]};
}
