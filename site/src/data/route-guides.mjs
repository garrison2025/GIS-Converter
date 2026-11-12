/**
 * P28: route-specific examples, input constraints and output checks.
 * Educational content only: no claim of complete metadata preservation.
 */
export const routeGuides={
  "kml-to-shp": {
    "example": "Move a KML collection of GPS survey points into a Shapefile layer for desktop GIS.",
    "inputs": "Use a valid .kml file with one geometry family, such as Point placemarks. A Shapefile cannot combine unrelated point and polygon layers in a single geometry type.",
    "output": "Download a ZIP containing .shp geometry, .shx index, .dbf attributes and .prj projection. Keep these files together when opening the layer.",
    "verify": "Open the extracted layer in QGIS and compare feature count, geometry type and attribute field values with the original KML. Check truncated DBF field names.",
    "mistake": "Mixed point/line/polygon geometry should be separated into homogeneous source layers; the converter should reject rather than silently drop incompatible features.",
    "faq": [
      [
        "Can a single SHP contain both lines and points?",
        "No. A single Shapefile layer has one geometry family. Split the source or use GeoJSON when multiple families must stay together."
      ],
      [
        "Will KML colors and balloon styling transfer to SHP?",
        "No reliable style equivalence exists. Check geometry and DBF attributes; style the layer again in the destination GIS application."
      ]
    ]
  },
  "kmz-to-shp": {
    "example": "Extract geographic vector features from a compressed Google Earth KMZ for spatial analysis in GIS software.",
    "inputs": "Supply an unencrypted .kmz file with a supported KML document. Extra photos, network-linked overlays and style assets are not separate SHP geometry.",
    "output": "A downloadable ZIP of Shapefile components (.shp, .shx, .dbf and .prj), not a copy of the original KMZ archive assets.",
    "verify": "Inspect the ZIP entries, load the .shp in QGIS, and compare layer count, feature count and longitude/latitude placement with Google Earth.",
    "mistake": "A KMZ containing raster ground overlays or mixed vector geometry may not have a faithful one-layer Shapefile equivalent.",
    "faq": [
      [
        "Does this extract embedded KMZ images into SHP?",
        "No. Shapefile represents vector geometry and tabular attributes; embedded images and KML styling need a separate workflow."
      ],
      [
        "Why is the result a ZIP rather than a .shp file?",
        "A usable Shapefile consists of multiple matching files; the ZIP keeps the geometry, index, attributes and CRS together."
      ]
    ]
  },
  "shp-to-kml": {
    "example": "Publish a projected GIS point or polygon layer into a KML file for viewing in Google Earth.",
    "inputs": "Zip the matching .shp, .shx, .dbf and .prj files. Add a UTF-8 .cpg if the DBF contains non-ASCII text.",
    "output": "A KML document with geographic vector geometry, transformed to the longitude/latitude reference expected by KML.",
    "verify": "Open the generated KML alongside the source Shapefile in GIS software, confirm its CRS transformation, spatial location and text labels.",
    "mistake": "A missing or incorrect .prj can shift features thousands of kilometres even if conversion completes; do not guess the source CRS.",
    "faq": [
      [
        "Can I upload only a .shp file?",
        "No. Supply a ZIP with the companion index, attribute and projection files so the converter can validate the dataset."
      ],
      [
        "Will source GIS symbology be preserved?",
        "Not reliably. KML geometry is the focus; review labels, popups, colors and other visualization settings separately."
      ]
    ]
  },
  "shp-to-kmz": {
    "example": "Share a Shapefile layer as a compact KMZ document compatible with Google Earth.",
    "inputs": "Create a ZIP holding exactly one matching Shapefile dataset with .prj. The source must have a known projection; UTF-8 .cpg is recommended.",
    "output": "A .kmz archive containing KML geometry. It does not reconstruct a full QGIS project or copy all source symbology.",
    "verify": "Inspect doc.kml in the archive and open the KMZ in Google Earth; compare bounds, representative coordinates and feature count with the source layer.",
    "mistake": "Do not interpret KMZ file compression as a guarantee that DBF field types, symbol rules or complex polygon details remain unchanged.",
    "faq": [
      [
        "Does KMZ preserve the original .dbf?",
        "Not as a DBF file. Attributes may map into KML properties, so validate any fields required by your workflow."
      ],
      [
        "Why do my features appear in the wrong place?",
        "Verify the source .prj and GIS layer CRS before conversion; KML expects geographic positioning."
      ]
    ]
  },
  "shp-to-geojson": {
    "example": "Convert an EPSG-defined zipped Shapefile into GeoJSON for Leaflet, MapLibre or a GIS API.",
    "inputs": "Upload a ZIP with .shp, .shx, .dbf and .prj for one dataset. A .cpg is important for non-English DBF labels.",
    "output": "A .geojson FeatureCollection containing coordinates and feature properties, normally in geographic WGS84-style longitude/latitude.",
    "verify": "Open both datasets in QGIS; compare feature count, property names and numeric/text values. Check transformed coordinates and polygon holes.",
    "mistake": "A missing projection or misencoded DBF may create plausible-looking but inaccurate location or text attributes. Read the quality report.",
    "faq": [
      [
        "Why is .prj required even when I know the coordinates?",
        "The file documents the source CRS so the transform to geographic GeoJSON is not based on an unsafe assumption."
      ],
      [
        "Can GeoJSON retain long Shapefile field names?",
        "GeoJSON supports longer property names, but it cannot restore names that were truncated when the source DBF was originally created."
      ]
    ]
  },
  "geojson-to-shp": {
    "example": "Export web-map GeoJSON features into a Shapefile for QGIS or a legacy GIS workflow.",
    "inputs": "Use a valid GeoJSON FeatureCollection with geographic coordinates and a compatible geometry family.",
    "output": "Download a ZIP with .shp, .shx, .dbf and .prj components. Attribute schema and field names must fit DBF limitations.",
    "verify": "Inspect the .dbf field names (maximum ten bytes in the legacy field header), compare counts and representative attribute values.",
    "mistake": "GeoJSON allows long property names and mixed geometries that one Shapefile cannot fully express; check the report before reusing output.",
    "faq": [
      [
        "Why did my GeoJSON property name shorten?",
        "The Shapefile DBF format limits field names to roughly ten characters. Rename source keys deliberately and check for collisions."
      ],
      [
        "Can I convert points and polygons in one request?",
        "Not into a single homogeneous Shapefile layer. Separate feature groups before conversion."
      ]
    ]
  },
  "geojson-to-kml": {
    "example": "Turn a GeoJSON FeatureCollection into vector overlays viewable in Google Earth.",
    "inputs": "Provide .geojson or .json with valid geometries in WGS84-style longitude/latitude order.",
    "output": "A standalone KML document representing supported vector features; nested JSON properties may not map one-to-one into ExtendedData.",
    "verify": "Open in Google Earth and compare geometry type, number of features and spatial positioning. Inspect property descriptions separately.",
    "mistake": "Do not swap coordinate order: GeoJSON uses [longitude, latitude], not [latitude, longitude].",
    "faq": [
      [
        "Can GeoJSON styles be converted automatically?",
        "Standard GeoJSON has no universal styling schema; KML style settings usually need independent review."
      ],
      [
        "Will all nested object properties appear in Google Earth?",
        "Not necessarily. Complex JSON values may be flattened or omitted when translated into KML attributes."
      ]
    ]
  },
  "kml-to-geojson": {
    "example": "Move KML placemark geometry into a GeoJSON layer for browser-based mapping or GIS analysis.",
    "inputs": "Upload a standalone KML file containing supported point, line or polygon placemarks.",
    "output": "A GeoJSON FeatureCollection with geographic coordinates and any properties the KML translator can represent.",
    "verify": "Compare number of placemarks/features, coordinate bounds, geometry families and important names or attributes in a separate map viewer.",
    "mistake": "KML icons, camera positions, external links and rendered colors are not GeoJSON geometry; treating them as preserved features is incorrect.",
    "faq": [
      [
        "Does GeoJSON preserve KML visual styles?",
        "No. KML symbology does not map automatically to standard GeoJSON; add a separate style layer in your web map."
      ],
      [
        "Which CRS does the output use?",
        "Standard web GeoJSON uses geographic longitude/latitude coordinates. Verify unusual or nonstandard source files."
      ]
    ]
  },
  "gpx-to-kml": {
    "example": "Inspect GPX GPS tracks and waypoints on a KML-compatible desktop map.",
    "inputs": "Upload .gpx with waypoints, routes or track segments. Complete, valid and ordered per-point timestamps are needed for supported gx:Track time export.",
    "output": "KML containing points, route lines and eligible timed track segments. Unclear or partially timed segments stay as ordinary lines.",
    "verify": "Open the KML in a viewer supporting gx:Track and compare point counts, segment boundaries, positions, times and optional elevation.",
    "mistake": "GPS device extensions such as heart rate are not guaranteed; a missing point-level timestamp must never be silently fabricated.",
    "faq": [
      [
        "Will all tracks play as animations in Google Earth?",
        "Only segments with complete compatible per-point times are eligible for native gx:Track; actual Earth playback still requires separate client verification."
      ],
      [
        "What happens if some GPX trackpoints have no time?",
        "Those segments retain ordinary KML geometry rather than an invented time sequence. Check the downloadable quality report."
      ]
    ]
  },
  "gpx-to-kmz": {
    "example": "Package a GPX route or timed track into compressed KML for sharing with Google Earth users.",
    "inputs": "Choose a valid GPX 1.0/1.1 file containing waypoints, routes or track segments, up to the stated browser upload limit.",
    "output": "A KMZ archive containing doc.kml with supported GPX geometries. Eligible fully timed tracks may be represented by gx:Track.",
    "verify": "Extract doc.kml or open the KMZ in a desktop viewer; compare track segment count, paired time/coordinate arrays and sampled elevations.",
    "mistake": "Compression does not recover device-specific GPX fields, and the KML gx extension is not recognized by every mapping application.",
    "faq": [
      [
        "Is GPX converted on a server?",
        "The conversion runs with GDAL/WebAssembly in your browser; no GPX conversion upload is needed."
      ],
      [
        "Are route times and device heart-rate extensions guaranteed?",
        "No. The supported timed geometry is conditional, and specialized GPX metadata remains subject to a review warning."
      ]
    ]
  },
  "kmz-to-kml": {
    "example": "Extract a usable KML geometry document from an existing KMZ package.",
    "inputs": "Supply a nonencrypted .kmz containing a supported KML document; archives with unsafe entries or oversized expansions are rejected.",
    "output": "A standalone .kml file. Binary pictures, models and external linked assets may still require separate extraction.",
    "verify": "Open the output .kml and compare placemarks and coordinates with the source KMZ in Google Earth.",
    "mistake": "A KML-only download may reference textures or pictures stored exclusively inside the original KMZ; those links can break.",
    "faq": [
      [
        "Does this unpack every file in the KMZ?",
        "No. This route exports the geographic KML document, not a general-purpose resource archive extractor."
      ],
      [
        "Why are icons missing after conversion?",
        "The icon or image may be an asset within the original KMZ that is not embedded in the standalone KML."
      ]
    ]
  },
  "kml-to-kmz": {
    "example": "Compress standalone KML place and geometry data into a KMZ archive for easier distribution.",
    "inputs": "Use a valid .kml with embedded geographic geometry. Review whether external icons or models are referenced.",
    "output": "A KMZ file containing the KML document; references to external images are not downloaded automatically.",
    "verify": "Open the KMZ with a ZIP tool to check its KML entry, then test geometry and placemarks in a KML viewer.",
    "mistake": "Do not assume that making a KMZ automatically copies remote images or third-party network-linked resources into the archive.",
    "faq": [
      [
        "Is KMZ simply a ZIP file?",
        "KMZ is a ZIP container centred on a KML document and optional assets. This converter focuses on the document's geography."
      ],
      [
        "Will linked image overlays work offline?",
        "Not unless the required assets are already embedded and references resolve inside the archive. Verify independently."
      ]
    ]
  },
  "kmz-to-geojson": {
    "example": "Convert vectors stored inside a Google Earth KMZ file to GeoJSON for web applications.",
    "inputs": "Use an unencrypted KMZ with vector placemarks that GDAL can parse. Photo overlays and resource attachments are not GeoJSON geometry.",
    "output": "A .geojson FeatureCollection representing supported geographic points, lines or polygons.",
    "verify": "Check output feature count, geometry families and coordinate bounds in QGIS or a web map. Inspect important attributes individually.",
    "mistake": "Raster overlays and KMZ package resources are not transformed into GeoJSON vector data; do not call this full archive preservation.",
    "faq": [
      [
        "Can I convert a KMZ image overlay into a GeoJSON polygon?",
        "Not automatically. GeoJSON stores vector geometries, not the image pixels in a ground overlay."
      ],
      [
        "Will output have the same placemark names?",
        "Some attribute translation is supported, but verify names and descriptions in the output FeatureCollection."
      ]
    ]
  },
  "kmz-to-gpx": {
    "example": "Extract supported KMZ placemarks and paths for GPS navigation software using GPX.",
    "inputs": "Choose a KMZ archive whose KML contains navigable points or lines, rather than polygons or photo overlays.",
    "output": "A GPX file with representable waypoints, routes or tracks. KML styling and rich archive assets have no GPX equivalent.",
    "verify": "Open the GPX in a GPS viewer, then compare waypoint locations, route vertices and segment organization.",
    "mistake": "A KML polygon or overlay cannot become an equivalent GPX polygon. Check data-loss warnings instead of relying on file size.",
    "faq": [
      [
        "Why are some shapes missing in GPX?",
        "GPX is primarily for points and paths; polygons and style layers do not have a standard direct representation."
      ],
      [
        "Are KMZ embedded images converted?",
        "No. Images are not GPX navigation points or tracks."
      ]
    ]
  },
  "kml-to-gpx": {
    "example": "Export Google Earth placemarks or supported paths to a GPX file for GPS tools.",
    "inputs": "Use KML with point or line geometry. Avoid polygons and screen overlays when a no-loss GPS export is required.",
    "output": "GPX XML containing compatible waypoint, route or track data, but not KML camera views or arbitrary styles.",
    "verify": "Compare waypoint positions and each line's vertex count in a GPX viewer; assess timestamp fields before assuming they survived.",
    "mistake": "KML's flexible placemark types and GX extensions do not map fully onto GPX 1.1; reject or review unsupported geometry.",
    "faq": [
      [
        "Can I turn a KML polygon into a GPX track?",
        "A polygon has area semantics while a GPX track is a path. Do not treat a simple outline as equivalent without reviewing intent."
      ],
      [
        "Will Google Earth icons remain in the GPX?",
        "No. Icon styles are KML visualization details, not standard GPS point geometry."
      ]
    ]
  },
  "kml-to-csv": {
    "example": "Turn KML point placemarks into a table that can be inspected in Excel or a spreadsheet.",
    "inputs": "Supply KML with geographic point features. Lines and polygons cannot be represented faithfully as single latitude/longitude CSV rows.",
    "output": "A comma-separated text table containing parsed fields and coordinates where supported.",
    "verify": "Open the CSV as UTF-8 and compare the number of point records, coordinate columns and text attribute values against source placemarks.",
    "mistake": "CSV does not retain shape boundaries, KML style or nesting, and a row count alone cannot certify a complex geographic conversion.",
    "faq": [
      [
        "Can this preserve a polygon in one CSV row?",
        "Not as ordinary latitude/longitude point columns. Use GeoJSON or Shapefile for area geometries."
      ],
      [
        "Why do non-English names look wrong in a spreadsheet?",
        "Check UTF-8 import settings in the spreadsheet application; text encoding varies between import workflows."
      ]
    ]
  },
  "kmz-to-csv": {
    "example": "Export Google Earth point placemarks stored in KMZ as spreadsheet-friendly CSV records.",
    "inputs": "Use KMZ with supported KML point features. An image-only KMZ is not a point table.",
    "output": "A CSV text file of available point coordinates and attributes; compressed image assets and style definitions are not retained.",
    "verify": "Compare source point placemarks to CSV rows, inspect longitude and latitude numeric columns, and check character encoding.",
    "mistake": "Extracting a CSV is not an archive backup. KMZ raster resources, network links and line/polygon geometry can be lost.",
    "faq": [
      [
        "Will the CSV include photos embedded in the KMZ?",
        "No. CSV values are table cells, not a container for KMZ pictures or models."
      ],
      [
        "Is CSV enough to recover a KMZ with polygon areas?",
        "No. Choose GeoJSON or Shapefile to retain actual polygon geometry where supported."
      ]
    ]
  },
  "csv-to-kml": {
    "example": "Plot a list of longitude/latitude coordinates from a CSV table as KML points in Google Earth.",
    "inputs": "Prepare comma-delimited UTF-8 CSV with explicit longitude/lon/x and latitude/lat/y columns; values must be WGS84 decimal degrees.",
    "output": "A KML point feature for every accepted CSV data row, with supported text columns translated as attributes.",
    "verify": "Count the output placemarks, check the location of your first and last rows and ensure coordinate order is longitude then latitude.",
    "mistake": "Semicolon-delimited data, swapped columns, ambiguous headers and invalid decimal coordinates are rejected rather than silently skipped.",
    "faq": [
      [
        "Should the first coordinate column be latitude?",
        "The order of CSV columns is flexible when headers identify them, but KML coordinates always use longitude,latitude."
      ],
      [
        "Can I use addresses instead of coordinates?",
        "Not in this converter. It does not geocode postal addresses; provide actual decimal-degree longitude and latitude."
      ]
    ]
  },
  "csv-to-kmz": {
    "example": "Create a compact Google Earth KMZ point map from longitude/latitude CSV data.",
    "inputs": "Use comma-delimited UTF-8 columns clearly named longitude and latitude (or accepted aliases). Every point must lie within geographic coordinate ranges.",
    "output": "A KMZ containing a KML representation of the CSV coordinate rows, not the original spreadsheet formulas or cells.",
    "verify": "Open the KMZ in Google Earth, inspect doc.kml, compare point count and check several exact coordinate rows.",
    "mistake": "A KMZ file is not a spreadsheet archive. Excel formulas, formatting and invalid input coordinate rows do not become KML points.",
    "faq": [
      [
        "Is a CSV row with missing latitude simply ignored?",
        "No. Invalid or missing coordinates should cause input rejection rather than silently dropping a record."
      ],
      [
        "Does KMZ compression change point locations?",
        "Compression should not alter valid coordinates, but verify representative points in the resulting KMZ before sharing."
      ]
    ]
  }
};
