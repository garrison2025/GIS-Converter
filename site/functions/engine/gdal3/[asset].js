// Unreleased Pages Functions experiment. Route only the oversized WASM file.
// This response must be verified with Wrangler / Cloudflare before production.
export async function onRequest({request,env,params}){
 if(params.asset!=='gdal3WebAssembly.wasm'||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
 const url=new URL(request.url);url.pathname='/engine/gdal3/gdal3WebAssembly.wasm.gz';
 const res=await env.ASSETS.fetch(new Request(url,{headers:{'Accept-Encoding':'identity'}}));
 if(!res.ok)return new Response('GDAL binary unavailable',{status:503});
 if(res.headers.has('Content-Encoding'))return new Response('Unexpected pre-encoded asset response; gate failed',{status:502});
 return new Response(request.method==='HEAD'?null:res.body,{status:200,headers:{'Content-Type':'application/wasm','Content-Encoding':'gzip','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'}});
}
