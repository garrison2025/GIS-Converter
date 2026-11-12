/**
 * P23: conservative GPX elevation -> KML numeric Z preservation.
 * Runs within the browser-only conversion Worker. Neither times nor private
 * source XML are copied into the generated KML; only valid, unambiguous
 * longitude/latitude/elevation coordinates are mapped to KML coordinates.
 *
 * A Z component does not imply a known vertical datum or visualization mode.
 * Ambiguous duplicate XY with different altitudes are intentionally skipped.
 */
const LIMIT=4*1024*1024, MAX_POINTS=50000;
const numberPattern=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const normalized=(lon,lat)=>lon.toFixed(6)+','+lat.toFixed(6);
function numbers(a,b){
 if(!numberPattern.test(a)||!numberPattern.test(b))return null;
 const lon=Number(a),lat=Number(b);
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)return null;
 return {lon,lat,key:normalized(lon,lat)};
}
function extractElevations(gpx){
 // CDATA and comments may contain apparent GPX point tags that are text only.
 const xml=gpx.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
 const known=new Map(),ambiguous=new Set();
 // Self-closing points have no elevation and must veto the same XY in any
 // other visit. Otherwise a repeated no-elevation waypoint can inherit Z.
 for(const m of xml.matchAll(/<(?:[\w.-]+:)?(?:wpt|trkpt|rtept)\b([^>]*?)\s*\/>/gi)){
  const attrs=m[1];
  const lon=attrs.match(/(?:^|\s)lon\s*=\s*["']([^"']+)["']/i)?.[1];
  const lat=attrs.match(/(?:^|\s)lat\s*=\s*["']([^"']+)["']/i)?.[1];
  const point=lon!==undefined&&lat!==undefined?numbers(lon,lat):null;
  if(point)ambiguous.add(point.key);
 }
 const tag=/<(?:[\w.-]+:)?(wpt|trkpt|rtept)\b([^>]*)(?<!\/)>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>/gi;
 let count=0;
 for(const m of xml.matchAll(tag)){
  if(++count>MAX_POINTS)return null;
  const attrs=m[2],inner=m[3];
  const lon=attrs.match(/(?:^|\s)lon\s*=\s*["']([^"']+)["']/i)?.[1];
  const lat=attrs.match(/(?:^|\s)lat\s*=\s*["']([^"']+)["']/i)?.[1];
  const point=lon!==undefined&&lat!==undefined?numbers(lon,lat):null;
  if(!point)continue;
  // Do not treat similarly named extension fields as GPX elevation.
  const visible=inner.replace(/<(?:[\w.-]+:)?extensions\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?extensions\s*>/gi,'');
  const ele=visible.match(/<(?:[\w.-]+:)?ele\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w.-]+:)?ele\s*>/i)?.[1]?.trim();
  if(ele===undefined||!numberPattern.test(ele)){
   // A second visit to the same XY may have no elevation. Never fill it
   // with an earlier point's value, even if that other value is valid.
   ambiguous.add(point.key);known.delete(point.key);
   continue;
  }
  const altitude=Number(ele);
  if(!Number.isFinite(altitude)||Math.abs(altitude)>100000){
   ambiguous.add(point.key);known.delete(point.key);
   continue;
  }
  if(ambiguous.has(point.key))continue;
  if(known.has(point.key)&&known.get(point.key)!==altitude){
   known.delete(point.key);ambiguous.add(point.key);
  }else known.set(point.key,altitude);
 }
 return {known,ambiguous};
}
export function applyGpxElevationToKml(gpxBytes,kmlBytes){
 if(!(gpxBytes instanceof Uint8Array)||!(kmlBytes instanceof Uint8Array)||
   gpxBytes.length>LIMIT||kmlBytes.length>LIMIT)
  return {bytes:kmlBytes,applied:0,status:'unavailable'};
 try{
  const decoder=new TextDecoder('utf-8',{fatal:true}),gpx=decoder.decode(gpxBytes),kml=decoder.decode(kmlBytes);
  const source=extractElevations(gpx);
  if(!source||!source.known.size)
   return {bytes:kmlBytes,applied:0,status:'unavailable'};
  let applied=0;
  const changed=kml.replace(/(<(?:[\w.-]+:)?coordinates\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?coordinates\s*>)/gi,
    (whole,opening,body,closing)=>{
     const tokens=body.split(/(\s+)/);
     const newTokens=tokens.map(value=>{
      if(!value||/^\s+$/.test(value))return value;
      const parts=value.split(',');
      if(parts.length<2||parts.length>3)return value;
      const point=numbers(parts[0],parts[1]);
      if(!point||!source.known.has(point.key))return value;
      const elevation=source.known.get(point.key);
      if(parts.length===3&&Number.isFinite(Number(parts[2]))&&Math.abs(Number(parts[2])-elevation)<1e-9)
       return value;
      applied++;
      return parts[0]+','+parts[1]+','+elevation;
     });
     return opening+newTokens.join('')+closing;
    });
  return {bytes:applied?new TextEncoder().encode(changed):kmlBytes,applied,
    status:applied?'preserved':'unavailable'};
 }catch{
  return {bytes:kmlBytes,applied:0,status:'unavailable'};
 }
}
