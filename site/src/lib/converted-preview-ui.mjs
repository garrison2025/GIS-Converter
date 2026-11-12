/**
 * P35 local-only SVG preview. No network, external map tiles, geocoding, or
 * risky innerHTML of user supplied GIS attributes. The scene is schematic:
 * XY means longitude/latitude, not a metric projection or GIS validation.
 */
const SVG='http://www.w3.org/2000/svg';
const el=(tag,cls)=>{const node=document.createElement(tag);if(cls)node.className=cls;return node};
const svgEl=(tag,attrs={})=>{
 const node=document.createElementNS(SVG,tag);
 for(const [key,val] of Object.entries(attrs))node.setAttribute(key,String(val));
 return node;
};
const put=(node,text)=>{node.textContent=String(text);return node};
const fmt=value=>Number(value).toFixed(5).replace(/0+$/,'').replace(/\.$/,'');
const btext=box=>box.map(fmt).join(', ');
function parts(type,coordinates){
 switch(type){
  case 'Point':return {points:[coordinates],lines:[],polygons:[]};
  case 'MultiPoint':return {points:coordinates,lines:[],polygons:[]};
  case 'LineString':return {points:[],lines:[coordinates],polygons:[]};
  case 'MultiLineString':return {points:[],lines:coordinates,polygons:[]};
  case 'Polygon':return {points:[],lines:[],polygons:[coordinates]};
  case 'MultiPolygon':return {points:[],lines:[],polygons:coordinates};
 }
 return {points:[],lines:[],polygons:[]};
}
function drawMap(host,preview,selected,onSelect){
 const width=800,height=420,pad=35,b=preview.bbox;
 const dx=Math.max(b[2]-b[0],0.000001),dy=Math.max(b[3]-b[1],0.000001);
 const scale=Math.min((width-2*pad)/dx,(height-2*pad)/dy);
 const centerX=(b[0]+b[2])/2,centerY=(b[1]+b[3])/2;
 const project=point=>[
   Math.max(-10000,Math.min(10000,width/2+(point[0]-centerX)*scale)),
   Math.max(-10000,Math.min(10000,height/2-(point[1]-centerY)*scale))
 ];
 const coords=point=>{const p=project(point);return p[0].toFixed(2)+','+p[1].toFixed(2)};
 const lineD=coordinates=>coordinates.map((p,i)=>(i?'L':'M')+coords(p)).join(' ');
 const ringsD=coordinates=>coordinates.map(ring=>lineD(ring)+' Z').join(' ');
 const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,
  role:'img','aria-label':'Schematic sample of '+preview.displayed+
   ' converted GIS features. Longitude and latitude, not a geodetically scaled map.',
  preserveAspectRatio:'xMidYMid meet'});
 const title=svgEl('title');title.textContent='Locally drawn converted vector preview';svg.appendChild(title);
 svg.appendChild(svgEl('rect',{x:0,y:0,width,height,fill:'#f4f9fb'}));
 for(let x=0;x<=width;x+=100)
  svg.appendChild(svgEl('line',{x1:x,y1:0,x2:x,y2:height,stroke:'#deebed','stroke-width':1}));
 for(let y=0;y<=height;y+=70)
  svg.appendChild(svgEl('line',{x1:0,y1:y,x2:width,y2:y,stroke:'#deebed','stroke-width':1}));
 preview.features.forEach((feature,i)=>{
  const {points,lines,polygons}=parts(feature.type,feature.coordinates);
  const active=i===selected;
  const group=svgEl('g',{'data-feature':i,
   'aria-label':'Select '+feature.type+' feature '+(i+1),
   role:'button',tabindex:'0'});
  const color=active?'#cf642b':'#08796d';
  for(const polygon of polygons){
   const p=svgEl('path',{d:ringsD(polygon),fill:active?'#f2b88c':'#80cfc2',
    'fill-opacity':'.52',stroke:color,'stroke-width':active?3:2,
    'fill-rule':'evenodd','stroke-linejoin':'round'});
   group.appendChild(p);
  }
  for(const line of lines){
   const p=svgEl('path',{d:lineD(line),fill:'none',stroke:color,
    'stroke-width':active?4:2.5,'stroke-linejoin':'round','stroke-linecap':'round'});
   group.appendChild(p);
  }
  for(const point of points){
   const [x,y]=project(point);
   group.appendChild(svgEl('circle',{cx:x,cy:y,r:active?7:5,
    fill:active?'#cf642b':'#08796d',stroke:'#fff','stroke-width':2}));
  }
  group.addEventListener('click',()=>onSelect(i));
  group.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(i)}
  });
  svg.appendChild(group);
 });
 host.replaceChildren(svg);
}
function showFields(host,feature){
 host.replaceChildren();
 const heading=put(el('h4'),'Selected feature '+feature.index+' · '+feature.type);
 host.appendChild(heading);
 const list=el('dl','preview-fields');
 const props=Object.entries(feature.properties||{});
 if(!props.length){host.appendChild(put(el('p'),'No supported scalar attributes in this preview sample.'));return}
 for(const [key,value] of props){
  list.appendChild(put(el('dt'),key));
  list.appendChild(put(el('dd'),value));
 }
 host.appendChild(list);
}
export function renderConvertedPreview(root,entries){
 root.replaceChildren();
 if(!Array.isArray(entries)||entries.length===0){root.hidden=true;return}
 root.hidden=false;
 const head=put(el('h3'),'Conversion output preview');
 root.appendChild(head);
 const intro=put(el('p','preview-note'),
  'Locally generated schematic geometry sample. No basemap or external requests; this is not a full GIS accuracy check.');
 root.appendChild(intro);
 const controls=el('div','preview-controls');
 const fileLabel=put(el('label'),'Preview file');
 fileLabel.htmlFor='preview-file-select';
 const fileSelect=el('select');fileSelect.id='preview-file-select';
 entries.forEach((entry,i)=>{
  const option=el('option');option.value=String(i);
  option.textContent=(i+1)+'. '+entry.label;
  fileSelect.appendChild(option);
 });
 const previewBody=el('div','preview-body');
 previewBody.id='preview-body';
 root.appendChild(controls);
 if(entries.length>1){controls.appendChild(fileLabel);controls.appendChild(fileSelect)}
 root.appendChild(previewBody);
 function showFile(){
  const entry=entries[Number(fileSelect.value)||0],preview=entry.preview;
  previewBody.replaceChildren();
  if(!preview||preview.status!=='ready'){
   const reason=preview?.reason||'No safe geographic sample could be produced for this format.';
   previewBody.appendChild(put(el('p','preview-unavailable'),
    'Map preview unavailable: '+reason+' The converted file is still downloadable.'));
   previewBody.dataset.status='unavailable';
   return;
  }
  previewBody.dataset.status='ready';
  const coverage=el('p','preview-summary');
  coverage.textContent='Displayed '+preview.displayed+
   (Number.isSafeInteger(preview.totalKnown)?' of '+preview.totalKnown:' sample')+
   ' features · '+preview.vertexCount+' vertices · '+
   preview.geometryCounts.point+' points / '+
   preview.geometryCounts.line+' lines / '+
   preview.geometryCounts.polygon+' polygons';
  const bbox=put(el('p','preview-bounds'),
   'Sample longitude/latitude bounds (WGS84): '+btext(preview.bbox));
  previewBody.appendChild(coverage);previewBody.appendChild(bbox);
  const map=el('div','preview-map'),properties=el('section','preview-properties');
  properties.setAttribute('aria-label','Selected feature attributes');
  previewBody.appendChild(map);
  const featureControl=el('div','preview-controls');
  const featureLabel=put(el('label'),'Inspect feature');
  featureLabel.htmlFor='preview-feature-select';
  const featureSelect=el('select');featureSelect.id='preview-feature-select';
  preview.features.forEach((f,i)=>{
   const opt=el('option');opt.value=String(i);
   opt.textContent=(i+1)+'. '+f.type;
   featureSelect.appendChild(opt);
  });
  featureControl.appendChild(featureLabel);featureControl.appendChild(featureSelect);
  previewBody.appendChild(featureControl);previewBody.appendChild(properties);
  const warning=el('ul','preview-warnings');
  for(const w of preview.warnings||[]){
   const item=put(el('li'),w);warning.appendChild(item);
  }
  previewBody.appendChild(warning);
  function selectFeature(index){
   if(index<0||index>=preview.features.length)return;
   featureSelect.value=String(index);
   drawMap(map,preview,index,selectFeature);
   showFields(properties,preview.features[index]);
  }
  featureSelect.addEventListener('change',()=>selectFeature(Number(featureSelect.value)));
  selectFeature(0);
 }
 fileSelect.addEventListener('change',showFile);
 showFile();
}
export function clearConvertedPreview(root){root.hidden=true;root.replaceChildren()}
