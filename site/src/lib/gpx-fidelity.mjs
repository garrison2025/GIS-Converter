/**
 * P21: bounded, independent GPX line-geometry comparison against KML.
 * Only aggregate counts/status leave this module; no source point lists or
 * timestamps are included in downloadable quality reports.
 * This is a narrow XML structural check, not a general XML/GIS validator.
 */
const MAX_LINES=2000, MAX_VERTICES=50000;
const stripIgnored=text=>text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
function tagBlocks(text,tag) {
 const re=new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+tag+'\\s*>','gi');
 return [...text.matchAll(re)].map(m=>m[1]);
}
function openTags(text,tag) {
 const re=new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b([^>]*)>','gi');
 return [...text.matchAll(re)].map(m=>m[1]);
}
function parseGpxPoint(attributes) {
 const attr=(key)=>attributes.match(new RegExp('(?:^|\\s)'+key+'\\s*=\\s*["\\x27]([^"\\x27]+)["\\x27]','i'))?.[1];
 const lon=Number(attr('lon')),lat=Number(attr('lat'));
 if(attr('lon')===undefined||attr('lat')===undefined||!Number.isFinite(lon)||!Number.isFinite(lat)||
    Math.abs(lon)>180||Math.abs(lat)>90)return null;
 return [lon,lat];
}
function metadataRisk(xml) {
 const result={time:0,elevation:0,extensions:0};
 for(const tag of ['wpt','rtept','trkpt']){
   for(const block of tagBlocks(xml,tag)){
     if(/<(?:[\w.-]+:)?time\b/i.test(block))result.time++;
     if(/<(?:[\w.-]+:)?ele\b/i.test(block))result.elevation++;
     if(/<(?:[\w.-]+:)?extensions\b/i.test(block))result.extensions++;
   }
 }
 return result;
}
function readSource(text) {
 const xml=stripIgnored(text);
 const routes=tagBlocks(xml,'rte'),tracks=tagBlocks(xml,'trk');
 let valid=true,limit=false,totalVertices=0;
 const lines=[];
 function addLine(body,pointTag){
   const attrs=openTags(body,pointTag);
   if(!attrs.length){valid=false;return;}
   const line=[];
   for(const attr of attrs){
     const point=parseGpxPoint(attr);
     if(!point)valid=false;
     else line.push(point);
   }
   totalVertices+=attrs.length;
   if(totalVertices>MAX_VERTICES||lines.length>=MAX_LINES){limit=true;return;}
   lines.push(line);
 }
 for(const route of routes)addLine(route,'rtept');
 for(const track of tracks){
   const segments=tagBlocks(track,'trkseg');
   if(!segments.length){valid=false;continue;}
   for(const segment of segments)addLine(segment,'trkpt');
 }
 // A malformed or unsupported XML shape must never produce a false pass.
 if(openTags(xml,'rte').length!==routes.length||openTags(xml,'trk').length!==tracks.length)valid=false;
 if(openTags(xml,'trkpt').length!==totalVertices-
    routes.reduce((n,r)=>n+openTags(r,'rtept').length,0))valid=false;
 return {lines,valid,limit,vertices:totalVertices,risk:metadataRisk(xml)};
}
function readOutput(text) {
 const xml=stripIgnored(text),lines=[];
 let valid=true,limit=false,vertices=0;
 for(const block of tagBlocks(xml,'LineString')){
   const coords=tagBlocks(block,'coordinates');
   if(coords.length!==1){valid=false;continue;}
   const tokens=coords[0].trim().split(/\s+/).filter(Boolean);
   vertices+=tokens.length;
   if(lines.length>=MAX_LINES||vertices>MAX_VERTICES){limit=true;break;}
   const line=[];
   for(const token of tokens){
     const parts=token.split(',');
     const lon=Number(parts[0]),lat=Number(parts[1]);
     if(parts.length<2||parts[0]===''||parts[1]===''||!Number.isFinite(lon)||
        !Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)valid=false;
     else line.push([lon,lat]);
   }
   lines.push(line);
 }
 if(openTags(xml,'LineString').length!==lines.length&&!limit)valid=false;
 return {lines,valid,limit,vertices};
}
// Approximate 0.1 m at the equator. No original coordinates are serialized
// in the quality report, and this never claims precise reprojection equality.
const signature=line=>line.map(([lon,lat])=>lon.toFixed(6)+','+lat.toFixed(6)).join(';');
export function inspectGpxLineFidelity(gpxXml,kmlXml) {
 const source=readSource(gpxXml),output=readOutput(kmlXml);
 const risk=source.risk;
 const riskTotal=risk.time+risk.elevation+risk.extensions;
 const metadata={
  status:riskTotal?'review':'unavailable',
  detail:riskTotal?
   'GPX point-level metadata needs manual verification: '+risk.time+' points contain time, '+
   risk.elevation+' elevation and '+risk.extensions+' extension elements. KML/KMZ conversion does not certify preservation of those values.':
   'No per-point time, elevation or extension tags found in the supported GPX sample; metadata preservation is not certified.'
 };
 if(source.limit||output.limit)
  return {status:'unavailable',detail:'GPX line inspection exceeded the bounded 2,000-line / 50,000-vertex limit.',metadata};
 if(!source.valid||!output.valid)
  return {status:'unavailable',detail:'GPX/KML line geometry could not be reliably inspected.',metadata};
 if(!source.lines.length)
  return {status:'unavailable',detail:'No GPX routes or track segments to compare.',metadata};
 const summary=source.lines.length+' GPX route/track segments ('+source.vertices+
   ' vertices) → '+output.lines.length+' KML lines ('+output.vertices+' vertices)';
 if(source.lines.length!==output.lines.length||source.vertices!==output.vertices)
  return {status:'review',detail:'GPX line geometry count mismatch: '+summary,metadata};
 const before=source.lines.map(signature).sort(),after=output.lines.map(signature).sort();
 const match=before.every((value,i)=>value===after[i]);
 return {status:match?'pass':'review',
  detail:(match?'GPX line segmentation and 6-decimal coordinate sample agree: ':
    'GPX route/track coordinate values or ordering differ: ')+summary+
    '. This is a bounded structural comparison, not topology certification.',metadata};
}
