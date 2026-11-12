/**
 * P24: bounded GPX timed-track enhancement for KML/KMZ.
 *
 * Only unambiguously matched GPX track segments with a timestamp at every
 * vertex are upgraded from their GDAL LineString to gx:Track. Routes,
 * waypoints, partial-time segments and ambiguous geometry remain untouched.
 * No network calls, persistence, fabricated GPS times or user data in reports.
 *
 * This is a conservative XML-shape matcher for GDAL-produced KML, not a
 * general-purpose XML parser.
 */
const MAX_XML=4*1024*1024,MAX_SEGMENTS=2000,MAX_VERTICES=50000;
const gxNamespace='http://www.google.com/kml/ext/2.2';
const xy=(lon,lat)=>Number(lon).toFixed(6)+','+Number(lat).toFixed(6);
const signature=coords=>coords.map(p=>xy(p[0],p[1])).join(';');
const clearIgnored=x=>x.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
const blocks=(xml,name)=>[...xml.matchAll(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'\\s*>','gi'))].map(m=>m[1]);
const attr=(s,name)=>s.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\\x27]([^"\\x27]+)["\\x27]','i'))?.[1];
function pointXY(attrs){
 const lon=attr(attrs,'lon'),lat=attr(attrs,'lat');
 if(lon===undefined||lat===undefined||!isDecimal(lon)||!isDecimal(lat))return null;
 const a=Number(lon),b=Number(lat);
 return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=180&&Math.abs(b)<=90?[a,b]:null;
}
const isDecimal=s=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(s).trim());
function isoTime(xml){
 const matches=[...xml.matchAll(/<(?:[\w.-]+:)?time\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w.-]+:)?time\s*>/gi)];
 if(matches.length!==1)return null;
 const raw=matches[0][1].trim();
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/i.test(raw))return null;
 // Date.parse can silently normalize an invalid calendar date such as
 // February 31. Reject that before normalizing UTC offsets.
 const day=raw.slice(0,10),dateOnly=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(dateOnly.getTime())||dateOnly.toISOString().slice(0,10)!==day)return null;
 const n=Date.parse(raw);
 return Number.isFinite(n)?new Date(n).toISOString():null;
}
function segmentPoints(body,tag){
 const re=new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b([^>]*?)(?<!\\/)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+tag+'\\s*>','gi');
 const matches=[...body.matchAll(re)];
 const openCount=[...body.matchAll(new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b[^>]*>','gi'))].length;
 if(matches.length!==openCount||!matches.length)return null;
 const out=[];
 for(const match of matches){
  const p=pointXY(match[1]);
  if(!p)return null;
  const inner=match[2].replace(/<(?:[\w.-]+:)?extensions\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?extensions\s*>/gi,'');
  const timestamp=isoTime(inner);
  const es=[...inner.matchAll(/<(?:[\w.-]+:)?ele\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w.-]+:)?ele\s*>/gi)];
  const ele=es.length===1&&isDecimal(es[0][1].trim())?Number(es[0][1].trim()):null;
  out.push({lon:p[0],lat:p[1],time:timestamp,
    elevation:Number.isFinite(ele)&&Math.abs(ele)<=100000?ele:null});
 }
 return out;
}
function sourceSegments(xml){
 const stripped=clearIgnored(xml);
 const all=[],candidates=[];
 let count=0,vertices=0;
 for(const route of blocks(stripped,'rte')){
  const attrs=[...route.matchAll(/<(?:[\w.-]+:)?rtept\b([^>]*)>/gi)];
  const coords=attrs.map(m=>pointXY(m[1]));
  if(coords.length&&coords.every(Boolean))all.push(signature(coords));
 }
 for(const track of blocks(stripped,'trk')){
  const segs=blocks(track,'trkseg');
  for(const seg of segs){
   if(++count>MAX_SEGMENTS)return null;
   const pts=segmentPoints(seg,'trkpt');
   if(!pts)continue;
   vertices+=pts.length;if(vertices>MAX_VERTICES)return null;
   const sig=signature(pts.map(p=>[p.lon,p.lat]));
   all.push(sig);
   const timed=pts.length>=2&&pts.every(p=>p.time!==null);
   const altCount=pts.filter(p=>p.elevation!==null).length;
   if(timed&&(altCount===0||altCount===pts.length))
    candidates.push({sig,pts});
  }
 }
 const frequency=new Map();
 for(const s of all)frequency.set(s,(frequency.get(s)||0)+1);
 const uniquelyEligible=new Map();
 for(const candidate of candidates){
  if(frequency.get(candidate.sig)===1)uniquelyEligible.set(candidate.sig,candidate);
 }
 return {eligible:uniquelyEligible,candidateCount:candidates.length,segments:count};
}
function lineCoords(body){
 const matches=[...body.matchAll(/<(?:[\w.-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?coordinates\s*>/gi)];
 if(matches.length!==1)return null;
 const points=[];
 for(const token of matches[0][1].trim().split(/\s+/)){
  const parts=token.split(',');
  if(parts.length<2||parts.length>3||!isDecimal(parts[0])||!isDecimal(parts[1]))return null;
  const a=Number(parts[0]),b=Number(parts[1]);
  if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>180||Math.abs(b)>90)return null;
  points.push([a,b]);
 }
 return points.length?points:null;
}
const limitOk=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length<=MAX_XML&&b.length<=MAX_XML;
export function enhanceGpxTimedKml(gpxBytes,kmlBytes){
 if(!(gpxBytes instanceof Uint8Array)||!(kmlBytes instanceof Uint8Array)||
    gpxBytes.length>MAX_XML||kmlBytes.length>MAX_XML)
  return {bytes:kmlBytes,converted:0,reason:'size-limit'};
 try{
  const dec=new TextDecoder('utf-8',{fatal:true});
  const gpx=dec.decode(gpxBytes),kml=dec.decode(kmlBytes);
  if(!limitOk(gpx,kml))return {bytes:kmlBytes,converted:0,reason:'size-limit'};
  const root=kml.match(/<kml\b[^>]*>/i);
  if(!root)return {bytes:kmlBytes,converted:0,reason:'no-kml-root'};
  const source=sourceSegments(gpx);
  if(!source||!source.eligible.size)return {bytes:kmlBytes,converted:0,reason:'no-unambiguous-complete-time-segments'};
  if(/xmlns:gx\s*=/i.test(root[0])&&!root[0].includes(gxNamespace))
   return {bytes:kmlBytes,converted:0,reason:'gx-namespace-conflict'};
  const allLines=[...kml.matchAll(/<(?:[\w.-]+:)?LineString\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?LineString\s*>/gi)];
  const frequency=new Map();
  for(const m of allLines){
   const coords=lineCoords(m[0]);if(!coords)continue;
   const sig=signature(coords);frequency.set(sig,(frequency.get(sig)||0)+1);
  }
  let converted=0,vertices=0;
  const updated=kml.replace(/<(?:[\w.-]+:)?LineString\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?LineString\s*>/gi,
   whole=>{
    const coords=lineCoords(whole);
    if(!coords)return whole;
    const sig=signature(coords),sourceTrack=source.eligible.get(sig);
    if(!sourceTrack||frequency.get(sig)!==1||coords.length!==sourceTrack.pts.length)return whole;
    vertices+=coords.length;if(vertices>MAX_VERTICES)return whole;
    const times=sourceTrack.pts.map(p=>'          <when>'+p.time+'</when>').join('\n');
    const positions=sourceTrack.pts.map(p=>
     '          <gx:coord>'+p.lon+' '+p.lat+' '+(p.elevation??0)+'</gx:coord>').join('\n');
    converted++;
    return '<gx:Track>\n'+times+'\n'+positions+'\n</gx:Track>';
   });
  if(!converted)return {bytes:kmlBytes,converted:0,reason:'no-unique-output-line-match'};
  const fixed=updated.replace(/<kml\b[^>]*>/i,match=>
   /xmlns:gx\s*=/i.test(match)?match:match.replace(/>$/,' xmlns:gx="'+gxNamespace+'">'));
  return {bytes:new TextEncoder().encode(fixed),converted,vertices,reason:'converted'};
 }catch{return {bytes:kmlBytes,converted:0,reason:'not-inspectable'};}
}
/**
 * Independent output readback: verifies gx:coord/when pairing and full
 * timestamp and coordinate correspondence for supported source segments.
 * Aggregate diagnostics only; original times/positions never enter reports.
 */
export function inspectGpxTimedKml(gpx,kml){
 if(!limitOk(gpx,kml))return {status:'unavailable',detail:'Timed GPX inspection exceeded 4 Mi-character bound.'};
 const src=sourceSegments(gpx);
 if(!src)return {status:'unavailable',detail:'GPX timed track source exceeds inspection limits.'};
 const tracks=[...kml.matchAll(/<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track\s*>/gi)];
 if(!tracks.length)return {status:'unavailable',detail:'No supported gx:Track output; partial/missing/ambiguous GPX point times remain unverified.'};
 const root=kml.match(/<kml\b[^>]*>/i);
 if(!root||!root[0].includes('xmlns:gx="'+gxNamespace+'"'))
  return {status:'review',detail:'gx:Track output is missing its required extension namespace.'};
 let matched=0,issues=0,points=0;
 const seen=new Set();
 for(const track of tracks){
  const when=[...track[1].matchAll(/<when\b[^>]*>([^<]*)<\/when\s*>/gi)].map(x=>x[1].trim());
  const coords=[...track[1].matchAll(/<gx:coord\b[^>]*>([^<]*)<\/gx:coord\s*>/gi)]
   .map(x=>x[1].trim().split(/\s+/).map(Number));
  points+=coords.length;
  if(when.length!==coords.length||coords.length<2||
     coords.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v)))){issues++;continue}
  const key=signature(coords);
  const expected=src.eligible.get(key);
  if(!expected||seen.has(key)||expected.pts.length!==coords.length){issues++;continue}
  seen.add(key);
  if(expected.pts.some((p,i)=>p.time!==when[i]||
    Math.abs(p.lon-coords[i][0])>1e-6||Math.abs(p.lat-coords[i][1])>1e-6||
    Math.abs((p.elevation??0)-coords[i][2])>1e-6)){issues++;continue}
  matched++;
 }
 const detail=matched+' timestamped GPX track segments ('+points+
  ' gx coordinates) independently compared; '+issues+
  ' invalid or mismatched gx tracks. Untimed/ambiguous segments are not certified.';
 if(issues)return {status:'review',detail:'GPX timed trajectory mismatch: '+detail};
 return {status:matched?'pass':'unavailable',detail};
}
