import JSZip from 'jszip';
import {applyGpxElevationToKml} from './gpx-elevation.mjs';
import {enhanceGpxTimedKml} from './gpx-timed-track.mjs';
export const routes=[
['kmz-to-shp','kmz','shp'],['kml-to-shp','kml','shp'],['shp-to-kml','shp','kml'],
['kmz-to-gpx','kmz','gpx'],['kml-to-gpx','kml','gpx'],['gpx-to-kml','gpx','kml'],
['kmz-to-kml','kmz','kml'],['kml-to-kmz','kml','kmz'],['geojson-to-shp','geojson','shp'],
['shp-to-geojson','shp','geojson'],['geojson-to-kml','geojson','kml'],
['kml-to-geojson','kml','geojson'],['shp-to-kmz','shp','kmz'],
['kml-to-csv','kml','csv'],['kmz-to-csv','kmz','csv'],
['csv-to-kml','csv','kml'],['csv-to-kmz','csv','kmz'],
['gpx-to-kmz','gpx','kmz'],['kmz-to-geojson','kmz','geojson']
];
const types={shp:'ESRI Shapefile',kml:'KML',gpx:'GPX',geojson:'GeoJSON',csv:'CSV',kmz:'KML'};
function safeName(n){const b=String(n).split('/').pop();if(!/^[a-zA-Z0-9_.-]{1,130}$/.test(b)||b==='.'||b==='..')throw Error('Unsafe output path '+n);return b;}
async function collect(gdal,path){
 const list=Array.isArray(path?.all)&&path.all.length?path.all:[path];const files=new Map();let total=0;
 for(const p of list){
  const name=safeName(p?.local||p),bytes=await gdal.getFileBytes(p);
  if(!(bytes?.length>0))throw Error('Empty GDAL output '+name);
  if(files.has(name))throw Error('Duplicate output '+name);
  total+=bytes.length;if(total>35000000||files.size>=32)throw Error('Output exceeds engineering limit');
  files.set(name,new Uint8Array(bytes));
 }
 return files;
}
export async function convertGdal(gdal,input,src,dst){
 if(!types[dst]||!types[src])throw Error('Unsupported GIS format');
 if(input.size>15*1024*1024)throw Error('Input exceeds the 15 MiB test limit');
 const openOptions=src==='csv'?['X_POSSIBLE_NAMES=longitude,lon,x','Y_POSSIBLE_NAMES=latitude,lat,y']:[];
 const opened=await gdal.open(input,openOptions,['shp','kmz'].includes(src)?['vsizip']:[]);
 const ds=opened.datasets?.[0];if(!ds)throw Error('GDAL could not open '+src+': '+JSON.stringify(opened.errors||[]));
 let files;
 try{
  const options=['-f',types[dst]];
  if(src==='csv')options.push('-a_srs','EPSG:4326');
  else if(['shp','kml','kmz','gpx','geojson'].includes(dst))options.push('-t_srs','EPSG:4326');
  if(dst==='csv')options.push('-lco','GEOMETRY=AS_XY');
  if(dst==='shp')options.push('-lco','ENCODING=UTF-8');
  // GDAL exposes GPX route_points/track_points as auxiliary layers in addition
  // to the actual waypoint, route and track features. Exporting all five
  // layers can duplicate vertices as standalone KML Points.
  // Select the three logical feature layers explicitly (GDAL GPX driver).
  if(src==='gpx')options.push('waypoints','routes','tracks');
  files=await collect(gdal,await gdal.ogr2ogr(ds,options,'gis_'+src+'_to_'+dst));
 }finally{try{gdal.close(ds)}catch{}}
 if(src==='gpx'&&['kml','kmz'].includes(dst)){
  // The tested browser GDAL build does not reliably materialize GPX <ele>
  // as KML Z even when ELE_AS_25D is requested. Add *unambiguous* source
  // elevation values to the output's existing Point/LineString coordinates.
  // Never infer timestamps or vertical datums, and never manufacture Z when
  // source elevation is absent or ambiguous.
  const kmlKey=[...files.keys()].find(name=>name.toLowerCase().endsWith('.kml'));
  if(kmlKey){
   const sourceBytes=new Uint8Array(await input.arrayBuffer());
   const patched=applyGpxElevationToKml(sourceBytes,files.get(kmlKey));
   // Upgrade only source track segments with a complete, valid timestamp
   // on every vertex and an unambiguous GDAL LineString correspondence.
   // Routes, waypoints and partial-time tracks keep ordinary KML geometry.
   const timed=enhanceGpxTimedKml(sourceBytes,patched.bytes);
   files.set(kmlKey,timed.bytes);
  }
 }
 if(dst==='shp'){
  const exts=[...files.keys()].map(n=>n.toLowerCase().split('.').pop());
  for(const ext of ['shp','shx','dbf'])if(!exts.includes(ext))throw Error('Shapefile missing .'+ext);
  const zip=new JSZip();for(const [name,data] of files)zip.file(name,data);
  return {name:'converted-shapefile.zip',bytes:new Uint8Array(await zip.generateAsync({type:'uint8array'})),mime:'application/zip',files:[...files.keys()],warning:'Shapefile field names can be truncated. Review attributes before use.'};
 }
 if(dst==='kmz'){
  const key=[...files.keys()].find(n=>n.toLowerCase().endsWith('.kml'));
  if(!key)throw Error('GDAL could not generate KML for KMZ');
  const zip=new JSZip();zip.file('doc.kml',files.get(key));
  return {name:'converted.kmz',bytes:new Uint8Array(await zip.generateAsync({type:'uint8array'})),mime:'application/vnd.google-earth.kmz',files:[...files.keys()],warning:'KML styles and archive attachments may not be preserved.'};
 }
 const ext=dst==='geojson'?'geojson':dst;
 const key=[...files.keys()].find(n=>n.toLowerCase().endsWith('.'+ext));
 if(!key)throw Error('Expected '+ext+' missing: '+[...files.keys()].join(','));
 return {name:'converted.'+ext,bytes:files.get(key),mime:dst==='geojson'?'application/geo+json':'text/plain',files:[...files.keys()],warning:dst==='gpx'?'GPX cannot represent polygon geometries; information may be lost.':''};
}
const kml='<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Sample Point</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
export async function makeFixture(format,shpZip){
 if(format==='kml')return new File([kml],'sample.kml');
 if(format==='kmz'){const z=new JSZip();z.file('doc.kml',kml);return new File([await z.generateAsync({type:'uint8array'})],'sample.kmz');}
 if(format==='geojson')return new File([JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{Name:'Sample Point'},geometry:{type:'Point',coordinates:[116.4,39.9]}}]})],'sample.geojson');
 if(format==='gpx')return new File(['<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="39.9" lon="116.4"><name>Sample Point</name></wpt></gpx>'],'sample.gpx');
 if(format==='csv')return new File(['longitude,latitude,Name\n116.4,39.9,Sample Point\n'],'sample.csv');
 if(format==='shp'&&shpZip)return new File([shpZip],'sample.zip');
 throw Error('Missing fixture '+format);
}
export async function inspectResult(format,converted){
 const bytes=converted.bytes;if(!bytes?.length)throw Error('Empty result');
 if(format==='shp'||format==='kmz'){
  const zip=await JSZip.loadAsync(bytes);const names=Object.keys(zip.files);
  if(format==='shp')for(const ext of ['.shp','.shx','.dbf'])if(!names.some(n=>n.endsWith(ext)))throw Error('Missing SHP file '+ext);
  if(format==='kmz'&&!zip.file('doc.kml'))throw Error('Missing KMZ doc.kml');
  return {kind:'ZIP',files:names};
 }
 const val=new TextDecoder().decode(bytes);
 if(format==='geojson'){
  const obj=JSON.parse(val),c=obj.features?.[0]?.geometry?.coordinates;
  if(obj.type!=='FeatureCollection'||!c)throw Error('Invalid GeoJSON feature');
  if(Math.abs(c[0]-116.4)>.001||Math.abs(c[1]-39.9)>.001)throw Error('Coordinate error');
  return {kind:'GeoJSON',features:obj.features.length};
 }
 if(format==='kml'&&!/<kml[\s>]/i.test(val))throw Error('Invalid KML');
 if(format==='gpx'&&!/<gpx[\s>]/i.test(val))throw Error('Invalid GPX');
 if(format==='csv'&&!val.includes('116.4'))throw Error('CSV missing sample coordinate');
 return {kind:format,size:val.length};
}
