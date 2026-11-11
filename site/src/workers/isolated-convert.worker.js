import {convertGdal} from '../lib/gdal-matrix.mjs';

// The actual GDAL/WASM runtime is scoped to this dedicated, replaceable worker.
// No file contents leave the browser. Hard termination cancels both parsing and conversion.
self.addEventListener('message',async({data})=>{
 if(data?.type!=='convert'||typeof data?.id!=='string')return;
 const {id,file,source,target}=data;
 try{
  if(!(file instanceof File))throw new Error('No input file');
  if(file.size>15*1024*1024)throw new Error('15 MiB engineering limit exceeded');
  importScripts('/engine/gdal3/gdal3.js');
  if(typeof initGdalJs!=='function')throw new Error('GDAL worker failed to load');
  const gdal=await initGdalJs({path:'/engine/gdal3',useWorker:false});
  const result=await convertGdal(gdal,file,source,target);
  const bytes=result.bytes;
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0)throw new Error('Empty output');
  self.postMessage({type:'success',id,name:result.name,mime:result.mime,warning:result.warning,bytes},[bytes.buffer]);
 }catch(e){
  const message=e instanceof Error?e.message:(typeof e==='string'?e:JSON.stringify(e));
  self.postMessage({type:'error',id,error:message||'Unknown conversion error'});
 }
});
