/**
 * P45 conversion route discovery.
 *
 * Exact registered routes only. Never synthesize unsupported URLs, infer
 * GIS formats from private filenames, upload input, or switch pages until
 * the person activates the real navigation link.
 */
import {routes,FORMAT_CODES} from './converter-routes.mjs';

const routeByPair=new Map(routes.map(([slug,src,dst])=>[src+':'+dst,slug]));
const destinationsBySource=new Map(FORMAT_CODES.map(src=>[
 src,routes.filter(([,s])=>s===src).map(([,s,t])=>t)
]));
export function routeSlugFor(source,target){
 return routeByPair.get(String(source)+':'+String(target))||null;
}
export function availableTargetsFor(source){
 return [...(destinationsBySource.get(String(source))||[])];
}
export function routeHrefFor(source,target){
 const slug=routeSlugFor(source,target);
 return slug?'/converter/'+slug+'/':null;
}
export function bindRoutePicker(container){
 if(!container)return ()=>{};
 const source=container.querySelector('[data-route-source]');
 const target=container.querySelector('[data-route-target]');
 const link=container.querySelector('[data-route-link]');
 const hint=container.querySelector('[data-route-hint]');
 if(!source||!target||!link||!hint)return ()=>{};
 const update=()=>{
  const valid=availableTargetsFor(source.value);
  for(const option of target.options){
   const supported=valid.includes(option.value);
   option.disabled=!supported;
   // Keep visibility accessible across engines. Disabled unsupported routes
   // explain why changing format can adjust the output selection.
  }
  if(!valid.includes(target.value))target.value=valid[0]||'';
  const url=routeHrefFor(source.value,target.value);
  if(url){
   link.href=url;
   link.removeAttribute('aria-disabled');
   link.removeAttribute('tabindex');
   const slug=routeSlugFor(source.value,target.value);
   link.dataset.route=slug;
   hint.textContent=valid.length+' output '+(valid.length===1?'format':'formats')+
    ' available from '+source.selectedOptions[0].textContent+
    '. Open the converter to choose your local file.';
  }else{
   link.removeAttribute('href');
   link.setAttribute('aria-disabled','true');
   link.setAttribute('tabindex','-1');
   delete link.dataset.route;
   hint.textContent='No conversion route is available for this combination.';
  }
 };
 source.addEventListener('change',update);
 target.addEventListener('change',update);
 update();
 return ()=>{
  source.removeEventListener('change',update);
  target.removeEventListener('change',update);
 };
}
