/**
 * P37 local-only antimeridian display frame.
 *
 * The original converted coordinates are NEVER altered. For a small sample
 * that straddles +/-180 longitude, choose the shortest circular longitude
 * interval and generate a separate, schematic display-only coordinate set.
 *
 * Caution: geographic edges do not encode an unambiguous long-way/short-way
 * preference. Global / >180 degree footprints fail closed rather than
 * drawing a persuasive but potentially false polygon or route.
 */
const mod360=lon=>((lon%360)+360)%360;

function visitPositions(value,visitor){
 if(!Array.isArray(value))throw Error('Invalid GIS preview geometry tree');
 if(typeof value[0]==='number'){
  if(value.length!==2||!Number.isFinite(value[0])||!Number.isFinite(value[1]))
   throw Error('Invalid GIS preview XY position');
  visitor(value);
  return;
 }
 for(const child of value)visitPositions(child,visitor);
}
function mapPositions(value,mapLongitude){
 if(typeof value[0]==='number')return [mapLongitude(value[0]),value[1]];
 return value.map(child=>mapPositions(child,mapLongitude));
}
export function makeAntimeridianDisplayFrame(features,bbox){
 const width=bbox[2]-bbox[0];
 if(width<=180)return {status:'unchanged'};
 const all=[];
 for(const feature of features)visitPositions(feature.coordinates,p=>all.push(mod360(p[0])));
 if(!all.length)return {status:'unavailable',reason:'No safe sample points for longitude display.'};
 all.sort((a,b)=>a-b);
 let largestGap=-1,start=all[0];
 for(let i=0;i<all.length;i++){
  const gap=i+1<all.length?all[i+1]-all[i]:all[0]+360-all[i];
  if(gap>largestGap){
   largestGap=gap;
   start=all[(i+1)%all.length];
  }
 }
 const arcWidth=360-largestGap;
 if(arcWidth>180+1e-9)
  return {status:'unavailable',
   reason:'Preview spans a geographically ambiguous (>180°) longitude interval across the antimeridian. Download and examine with desktop GIS software.'};
 const toDisplay=longitude=>{
  const normalized=mod360(longitude);
  return normalized+ (normalized<start-1e-9?360:0);
 };
 const displayCoordinates=features.map(f=>mapPositions(f.coordinates,toDisplay));
 let min=Infinity,max=-Infinity;
 for(const coords of displayCoordinates)visitPositions(coords,p=>{
  min=Math.min(min,p[0]);max=Math.max(max,p[0]);
 });
 if(!Number.isFinite(min)||!Number.isFinite(max)||max-min>180+1e-8)
  return {status:'unavailable',reason:'Antimeridian display longitude frame is ambiguous.'};
 return {
  status:'wrapped',
  displayCoordinates,
  displayBbox:[min,bbox[1],max,bbox[3]],
  warnings:[
   'Antimeridian view: longitudes are shifted into a continuous local drawing frame. The converted file retains its original WGS84 coordinates.',
   'Connections are drawn using a shortest-longitude-arc assumption; this schematic does not establish route direction, geodesic distance, polygon topology or GIS accuracy.'
  ]
 };
}
