/**
 * Build a small *actual converted output* geometry sample without uploading
 * anything. The existing worker's already-initialized GDAL/WASM engine
 * reopens its own output, converts up to 60 features to WGS84 GeoJSON and
 * immediately closes the temporary dataset. Failure never invalidates a
 * successful GIS conversion.
 */
import {makeOutputGeometryPreview} from './output-geometry-preview.mjs';

const MAX_SOURCE_BYTES=5*1024*1024;
const MAX_GEOJSON_BYTES=850*1024;
const unavailable=reason=>({status:'unavailable',reason});
const extension=type=>type==='shp'?'zip':type==='geojson'?'geojson':type;
const namePattern=/^[a-zA-Z0-9._-]{1,160}$/;

export async function extractConvertedOutputPreview(gdal,outputBytes,format){
 if(!(outputBytes instanceof Uint8Array)||!outputBytes.byteLength)
  return unavailable('No converted output bytes available.');
 if(!['geojson','shp','kml','kmz','gpx','csv'].includes(format))
  return unavailable('This output format is not supported by the map preview.');
 if(outputBytes.length>MAX_SOURCE_BYTES)
  return unavailable('Converted file exceeds the 5 MiB safe preview limit. Download it to inspect in GIS software.');
 if(format==='geojson'){
  if(outputBytes.length>MAX_GEOJSON_BYTES)
   return unavailable('GeoJSON exceeds the safe preview parsing limit. The full file is still downloadable.');
  try {
   return makeOutputGeometryPreview(
    new TextDecoder('utf-8',{fatal:true}).decode(outputBytes),
    {source:'actual-converted-geojson'});
  }catch{return unavailable('Could not decode the converted GeoJSON for preview.')}
 }
 if(!gdal||typeof gdal.open!=='function'||typeof gdal.ogr2ogr!=='function')
  return unavailable('The local GDAL reader is unavailable for this output preview.');
 const ext=extension(format);
 if(!namePattern.test(ext))
  return unavailable('Invalid format name for the preview reader.');
 let dataset=null;
 try{
  // The output is the already-converted file, not the original input.
  // SHP remains a ZIP of DBF/PRJ/SHP/SHX; KMZ remains a KML ZIP.
  const file=new File([outputBytes],'p35-output.'+ext);
  const options=format==='csv'?[
   'X_POSSIBLE_NAMES=longitude,lon,x',
   'Y_POSSIBLE_NAMES=latitude,lat,y'
  ]:[];
  const opened=await gdal.open(file,options,
   ['shp','kmz'].includes(format)?['vsizip']:[]);
  dataset=opened?.datasets?.[0];
  if(!dataset)return unavailable('Converted GIS file could not be reopened for optional preview.');
  const args=['-f','GeoJSON','-t_srs','EPSG:4326','-limit','60'];
  if(format==='csv')args.push('-s_srs','EPSG:4326');
  if(format==='gpx')args.push('waypoints','routes','tracks');
  const written=await gdal.ogr2ogr(dataset,args,'p35-output-preview');
  const paths=Array.isArray(written?.all)&&written.all.length?written.all:[written];
  const jsonFile=paths.find(p=>(p?.local||p||'').toString().toLowerCase().endsWith('.geojson'))
   ||paths[0];
  if(!jsonFile)return unavailable('The converted GIS file has no geographic preview layer.');
  const bytes=new Uint8Array(await gdal.getFileBytes(jsonFile));
  if(bytes.length>MAX_GEOJSON_BYTES)
   return unavailable('The geographic preview sample is too large. The original download is unchanged.');
  const sample=makeOutputGeometryPreview(
   new TextDecoder('utf-8',{fatal:true}).decode(bytes),
   {source:'GDAL-readback-of-converted-'+format});
  if(sample.status==='ready'){
   // GDAL's -limit is per layer. Do NOT claim that our sample represents
   // every original feature or output layer.
   sample.totalKnown=null;
   sample.truncated=true;
   sample.warnings.push('Readback preview is capped at 60 displayed features, and may omit other layers or geometry.');
  }
  return sample;
 }catch{
  return unavailable('This converted GIS format could not be safely rendered as a local vector sample. The conversion download is unaffected.');
 }finally{
  if(dataset)try{gdal.close(dataset)}catch{}
 }
}
