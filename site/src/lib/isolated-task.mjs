// A single, isolated GDAL worker per conversion. Hard stop is intentionally used:
// gdal3.js does not expose a documented per-operation cancellation API.
export function runIsolatedConversion({file,source,target,timeoutMs=90000,workerFactory}){
 if(!file||!source||!target)throw new Error('Missing conversion request');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('Invalid timeout');
 const worker=workerFactory?workerFactory():new Worker(new URL('../workers/isolated-convert.worker.js',import.meta.url),{type:'classic'});
 const id='conversion'; // at most one task per dedicated worker
 let state='running';
 let timer, resolvePromise, rejectPromise;
 const promise=new Promise((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject});
 function cleanup(){
  clearTimeout(timer);
  worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;
  worker.terminate();
 }
 function finish(type,value){
  if(state!=='running')return false;
  state=type;
  cleanup();
  if(type==='success')resolvePromise(value);
  else {
    const err=new Error(type==='cancelled'?'Conversion cancelled.':type==='timeout'?'Conversion timed out; the isolated worker was terminated.':String(value||'Conversion failed.'));
    err.code=type.toUpperCase();
    rejectPromise(err);
  }
  return true;
 }
 worker.onmessage=({data})=>{
  if(!data||data.id!==id||state!=='running')return;
  if(data.type==='success'){
   if(!(data.bytes instanceof Uint8Array)||data.bytes.byteLength===0){finish('error','Invalid worker output');return}
   finish('success',data);
  }else if(data.type==='error')finish('error',data.error);
 };
 worker.onerror=(event)=>{event.preventDefault?.();finish('error',event.message||'Worker runtime error')};
 worker.onmessageerror=()=>finish('error','Unreadable worker message');
 timer=setTimeout(()=>finish('timeout'),timeoutMs);
 try{worker.postMessage({type:'convert',id,file,source,target})}
 catch(e){finish('error',e instanceof Error?e.message:String(e))}
 return {promise,cancel:()=>finish('cancelled'),get state(){return state}};
}
