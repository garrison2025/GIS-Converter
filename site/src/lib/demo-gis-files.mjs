/**
 * P46 entirely local, small and synthetic GIS demonstration files.
 *
 * Format examples are the same WGS84 point (116.4, 39.9). Samples contain
 * no user data; generating samples makes no API request and no upload.
 * Shapefile components are written deterministically from ESRI's Point
 * binary record structure, not by the website's own GDAL export path.
 */
export const DEMO_COORDINATES=Object.freeze([116.4,39.9]);
export const DEMO_SOURCES=Object.freeze(['kml','kmz','shp','geojson','gpx','csv']);
const X=DEMO_COORDINATES[0],Y=DEMO_COORDINATES[1];
const encoder=new TextEncoder();
const KML='<?xml version="1.0" encoding="UTF-8"?>'+
 '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'+
 '<name>Example point</name><Point><coordinates>116.4,39.9,0</coordinates></Point>'+
 '</Placemark></Document></kml>';
const GPX='<?xml version="1.0" encoding="UTF-8"?>'+
 '<gpx version="1.1" creator="GIS Converter example" xmlns="http://www.topografix.com/GPX/1/1">'+
 '<wpt lat="39.9" lon="116.4"><name>Example point</name></wpt></gpx>';
const GEOJSON=JSON.stringify({type:'FeatureCollection',features:[{
 type:'Feature',properties:{Name:'Example point',Code:1},
 geometry:{type:'Point',coordinates:[X,Y]}
}]});
const CSV='longitude,latitude,Name,Code\r\n116.4,39.9,Example point,1\r\n';
const PRJ='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'+
 'SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],'+
 'UNIT["Degree",0.0174532925199433]]';
function pointShapefileHeader(byteLength){
 const bytes=new Uint8Array(100),view=new DataView(bytes.buffer);
 view.setInt32(0,9994,false);
 view.setInt32(24,byteLength/2,false);
 view.setInt32(28,1000,true);
 view.setInt32(32,1,true);
 view.setFloat64(36,X,true);view.setFloat64(44,Y,true);
 view.setFloat64(52,X,true);view.setFloat64(60,Y,true);
 return bytes;
}
function pointShapefile(){
 const shp=new Uint8Array(128),shx=new Uint8Array(108);
 shp.set(pointShapefileHeader(shp.length));shx.set(pointShapefileHeader(shx.length));
 const record=new DataView(shp.buffer);
 record.setInt32(100,1,false); // record number
 record.setInt32(104,10,false); // content length in 16-bit words
 record.setInt32(108,1,true); // 2D Point
 record.setFloat64(112,X,true);record.setFloat64(120,Y,true);
 const index=new DataView(shx.buffer);
 index.setInt32(100,50,false); // offset in 16-bit words
 index.setInt32(104,10,false);
 return {shp,shx};
}
function pointDbf(){
 // dBASE III: header 32 + 2 field descriptors 64 + terminator 1;
 // 1 record = deletion mark + 24-char Name + 6-digit Code; EOF marker.
 const headerLen=97,recordLen=31;
 const dbf=new Uint8Array(headerLen+recordLen+1);
 const view=new DataView(dbf.buffer);
 dbf[0]=0x03;dbf[1]=126;dbf[2]=11;dbf[3]=16;
 view.setUint32(4,1,true);view.setUint16(8,headerLen,true);
 view.setUint16(10,recordLen,true);
 dbf.set(encoder.encode('Name'),32);dbf[43]=0x43;dbf[48]=24;
 dbf.set(encoder.encode('Code'),64);dbf[75]=0x4e;dbf[80]=6;
 dbf[96]=0x0d;dbf[97]=0x20;
 dbf.fill(0x20,98,128);
 dbf.set(encoder.encode('Example point'),98);
 dbf[127]=0x31;
 dbf[128]=0x1a;
 return dbf;
}
async function makeZip(entries){
 // Lazy-load ZIP only on a person's direct sample action. Normal browsing
 // does not load JSZip or GDAL, keeping the converter form lightweight.
 const {default:JSZip}=await import('jszip');
 const zip=new JSZip();
 for(const [name,content] of entries)zip.file(name,content);
 return zip.generateAsync({type:'uint8array',compression:'STORE'});
}
export async function makeDemoGISFile(source){
 let name,mimeType,bytes;
 switch(source){
  case 'kml':name='gis-example.kml';mimeType='application/vnd.google-earth.kml+xml';bytes=KML;break;
  case 'geojson':name='gis-example.geojson';mimeType='application/geo+json';bytes=GEOJSON;break;
  case 'gpx':name='gis-example.gpx';mimeType='application/gpx+xml';bytes=GPX;break;
  case 'csv':name='gis-example.csv';mimeType='text/csv';bytes=CSV;break;
  case 'kmz':
   name='gis-example.kmz';mimeType='application/vnd.google-earth.kmz';
   bytes=await makeZip([['doc.kml',KML]]);break;
  case 'shp':{
   name='gis-example.zip';mimeType='application/zip';
   const {shp,shx}=pointShapefile();
   bytes=await makeZip([
    ['example.shp',shp],['example.shx',shx],
    ['example.dbf',pointDbf()],['example.prj',PRJ],['example.cpg','UTF-8']
   ]);break;
  }
  default:throw Error('Unsupported sample source format');
 }
 const file=new File([bytes],name,{type:mimeType});
 if(file.size<=0||file.size>16384)
  throw Error('Synthetic GIS sample unexpectedly exceeds its 16 KiB bound');
 return file;
}
