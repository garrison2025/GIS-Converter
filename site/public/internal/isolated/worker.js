/* Isolated GDAL/WASM experiment, classic Worker; intentionally NO production use until CI passes. */
self.onmessage=async event=>{
 if(event.data?.type!=='convert')return;
 try{
  importScripts('/engine/gdal3/gdal3.js');
  if(typeof initGdalJs!=='function')throw new Error('gdal3 loader not available in classic worker');
  const gdal=await initGdalJs({path:'/engine/gdal3',useWorker:false});
  const kml='<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Worker Test</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
  const input=new File([kml],'worker.kml');
  const opened=await gdal.open(input);
  const ds=opened.datasets?.[0];
  if(!ds)throw new Error('GDAL.open returned no dataset');
  const exported=await gdal.ogr2ogr(ds,['-f','GeoJSON','-t_srs','EPSG:4326'],'worker.geojson');
  const file=exported.all?.[0]||exported;
  const bytes=await gdal.getFileBytes(file);
  const parsed=JSON.parse(new TextDecoder().decode(bytes));
  const coords=parsed?.features?.[0]?.geometry?.coordinates;
  if(!coords||Math.abs(coords[0]-116.4)>.001||Math.abs(coords[1]-39.9)>.001)throw new Error('Output coordinates wrong');
  self.postMessage({type:'done',coords,bytes:bytes.byteLength});
 }catch(e){self.postMessage({type:'error',error:e instanceof Error?e.stack:String(e)})}
};
