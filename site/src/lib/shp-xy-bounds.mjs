/**
 * P57: bounded, geometry-independent ESRI Shapefile XY extent verification.
 *
 * SHX byte offsets and file lengths are already gated by P56. This checker
 * independently reads actual XY doubles from SHP records and compares both
 * per-record and aggregate bounds to recorded SHP/SHX headers. No geographic
 * range assumption: projected coordinates must also be supported.
 *
 * It does not certify Z/M ordinates, topology, CRS or attribute values.
 * Errors are reported as generic reason classes, never user coordinates.
 */
const MAX_VERTICES = 1_000_000;
const SUPPORTED = new Set([1,3,5,8,11,13,15,18,21,23,25,28]);
const POINT = new Set([1,11,21]);
const MULTIPOINT = new Set([8,18,28]);
const LINE_OR_POLYGON = new Set([3,5,13,15,23,25]);
const review = detail => ({status:'review',detail});
const unavailable = detail => ({status:'unavailable',detail});
const close = (a,b) => Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a-b) <= 1e-9 + 1e-12 * Math.max(Math.abs(a),Math.abs(b));
const sameBox = (v,offset,bounds) =>
  bounds.every((value,i) => close(v.getFloat64(offset+i*8,true),value));
const emptyBox = () => [Infinity,Infinity,-Infinity,-Infinity];
function extend(bounds,x,y){
 if(!Number.isFinite(x)||!Number.isFinite(y))return false;
 bounds[0]=Math.min(bounds[0],x);
 bounds[1]=Math.min(bounds[1],y);
 bounds[2]=Math.max(bounds[2],x);
 bounds[3]=Math.max(bounds[3],y);
 return true;
}
export function inspectShpXYBounds(shp,shx){
 if(!(shp instanceof Uint8Array)||!(shx instanceof Uint8Array)||
    shp.byteLength<100||shx.byteLength<100||(shx.byteLength-100)%8)
  return review('Shapefile XY data or index header is truncated');
 const s=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);
 const x=new DataView(shx.buffer,shx.byteOffset,shx.byteLength);
 const type=s.getInt32(32,true);
 if(!SUPPORTED.has(type))
  return unavailable('Shapefile XY bounds cannot be independently inspected for this geometry type');
 const global=emptyBox();
 let vertices=0;
 const count=(shx.byteLength-100)/8;
 for(let i=0;i<count;i++){
  const index=100+i*8;
  const start=x.getUint32(index,false)*2+8;
  const size=x.getUint32(index+4,false)*2;
  const end=start+size;
  if(start<108||size<4||end>shp.byteLength||end<start)
   return review('Shapefile record coordinates exceed the indexed byte boundary');
  const recordType=s.getInt32(start,true);
  if(recordType===0)continue; // Explicit ESRI Null Shape: no XY extent
  if(recordType!==type)
   return review('Shapefile record XY geometry family does not match the layer');
  const local=emptyBox();
  if(POINT.has(type)){
   if(size<20)return review('Shapefile point record omits its XY ordinates');
   if(++vertices>MAX_VERTICES)
    return unavailable('Shapefile XY vertex limit reached before full verification');
   if(!extend(local,s.getFloat64(start+4,true),s.getFloat64(start+12,true)))
    return review('Shapefile point record contains non-finite XY ordinates');
  }else{
   if(size<40)return review('Shapefile multipart record is missing XY metadata');
   const nParts=LINE_OR_POLYGON.has(type)?s.getInt32(start+36,true):0;
   const nPoints=s.getInt32(start+(MULTIPOINT.has(type)?36:40),true);
   if(nPoints<1||nParts<0||(LINE_OR_POLYGON.has(type)&&nParts<1))
    return review('Shapefile multipart record has inconsistent XY part counts');
   if(vertices+nPoints>MAX_VERTICES)
    return unavailable('Shapefile XY vertex limit reached before full verification');
   const pointStart=start+(MULTIPOINT.has(type)?40:44+4*nParts);
   if(pointStart>end||pointStart+16*nPoints>end)
    return review('Shapefile XY vertex array extends outside its record');
   if(LINE_OR_POLYGON.has(type)){
    let last=-1;
    for(let j=0;j<nParts;j++){
     const offset=s.getInt32(start+44+4*j,true);
     if(offset<0||offset>=nPoints||offset<=last||
        (j===0&&offset!==0))
      return review('Shapefile multipart boundaries do not index valid XY vertices');
     last=offset;
    }
   }
   for(let j=0;j<nPoints;j++){
    const p=pointStart+16*j;
    if(!extend(local,s.getFloat64(p,true),s.getFloat64(p+8,true)))
     return review('Shapefile multipart record contains non-finite XY ordinates');
   }
   vertices+=nPoints;
   if(!sameBox(s,start+4,local))
    return review('Shapefile multipart record XY bounds differ from actual vertices');
  }
  extend(global,local[0],local[1]);
  extend(global,local[2],local[3]);
 }
 if(!vertices)
  return unavailable('Shapefile has no non-null XY geometry to verify');
 if(!sameBox(s,36,global)||!sameBox(x,36,global))
  return review('Shapefile SHP or SHX file-level XY bounds differ from actual vertices');
 return {status:'pass',detail:'Actual SHP XY vertices match all record and file-level SHP/SHX bounds'};
}
