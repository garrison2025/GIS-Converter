/**
 * P34 free browser-only mini batch. Three files maximum, no server upload,
 * no account, and no claim that conversion is lossless.
 */
import JSZip from 'jszip';

export const MAX_BATCH_FILES=3;
export const MAX_FILE_BYTES=15*1024*1024;
export const MAX_BATCH_INPUT_BYTES=30*1024*1024;
export const MAX_BATCH_OUTPUT_BYTES=96*1024*1024;

export function validateMiniBatchSelection(fileList){
 const files=Array.from(fileList||[]);
 if(!files.length)throw Error('Choose at least one input file.');
 if(files.length>MAX_BATCH_FILES)
  throw Error('Select at most '+MAX_BATCH_FILES+' files in one free mini-batch.');
 let bytes=0;
 for(const [i,file] of files.entries()){
  if(!file||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||
     file.size<=0)throw Error('File '+(i+1)+' is empty or invalid.');
  if(file.size>MAX_FILE_BYTES)
   throw Error('File '+(i+1)+' ('+file.name+') exceeds the 15 MiB limit.');
  bytes+=file.size;
 }
 if(bytes>MAX_BATCH_INPUT_BYTES)
  throw Error('These files total over 30 MiB. Choose a smaller group.');
 return Object.freeze({files,count:files.length,totalBytes:bytes,isBatch:files.length>1});
}

export function safeBatchEntryName(value){
 let name=String(value||'').replace(/[/\\]/g,'-')
  .replace(/[\x00-\x1f\x7f<>:"|?*]/g,'-')
  .replace(/^[.\- ]+/,'').replace(/[. ]+$/g,'').trim();
 if(!name||name==='-'||name==='..')name='converted-file';
 return name.slice(0,112);
}

/**
 * Results must be exactly aligned with the selected source files.
 * Each worker's output is retained in memory only until the user downloads
 * this archive; no URLs or raw input bytes are stored in the manifest.
 */
export async function makeMiniBatchArchive({source,target,files,results,isCancelled=()=>false}){
 const selection=validateMiniBatchSelection(files);
 if(selection.count<2)throw Error('Use ordinary single-file download for one input.');
 if(selection.count!==results?.length)throw Error('Batch results do not match selected files.');
 if(!/^[a-z0-9]+$/.test(source)||!/^[a-z0-9]+$/.test(target))
  throw Error('Unsupported batch format identifiers.');
 const zip=new JSZip(),manifest={schemaVersion:1,kind:'gis-converter-local-mini-batch',
  sourceFormat:source,targetFormat:target,convertedCount:selection.count,
  inspection:'Automated structural checks only. Independently verify professional GIS data.',
  files:[]};
 let totalOutput=0;
 for(let i=0;i<results.length;i++){
  if(isCancelled())throw Object.assign(new Error('Batch cancelled.'),{code:'CANCELLED'});
  const result=results[i],bytes=result?.bytes;
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength)
   throw Error('Batch output '+(i+1)+' is empty or invalid.');
  totalOutput+=bytes.byteLength;
  if(totalOutput>MAX_BATCH_OUTPUT_BYTES)
   throw Error('Converted output exceeds the 96 MiB mini-batch packaging limit.');
  const prefix=String(i+1).padStart(2,'0')+'-';
  const savedName=prefix+safeBatchEntryName(result.name||'converted');
  const safeSource=safeBatchEntryName(selection.files[i].name);
  const reportPath='reports/'+prefix+'inspection.json';
  const convertedPath='converted/'+savedName;
  const quality=result.quality&&typeof result.quality==='object'?result.quality:
   {status:'review',checks:[],disclaimer:'Inspection unavailable; validate with GIS software.'};
  zip.file(convertedPath,bytes);
  zip.file(reportPath,JSON.stringify(quality,null,2));
  manifest.files.push({
   sequence:i+1,sourceName:safeSource,outputPath:convertedPath,reportPath,
   outputBytes:bytes.byteLength,
   inspectionStatus:quality.status||'review',
   warning:String(result.warning||'').slice(0,1200)
  });
 }
 zip.file('manifest.json',JSON.stringify(manifest,null,2));
 const archive=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',
  compressionOptions:{level:3}});
 if(isCancelled())throw Object.assign(new Error('Batch cancelled.'),{code:'CANCELLED'});
 return {name:'gis-'+source+'-to-'+target+'-batch-'+selection.count+'.zip',
  mime:'application/zip',bytes:archive,manifest};
}

export function miniBatchSummary(results,sourceNames){
 if(!Array.isArray(results)||results.length<2||results.length>MAX_BATCH_FILES||
    results.length!==sourceNames?.length)
  throw Error('Invalid mini-batch summary.');
 const qualities=results.map(r=>r.quality);
 const countIfComplete=side=>qualities.every(q=>Number.isSafeInteger(q?.[side]?.features))
  ?qualities.reduce((sum,q)=>sum+q[side].features,0):null;
 const allChecked=qualities.every(q=>q?.status==='checked');
 const anyReview=qualities.some(q=>q?.status==='review');
 return {
  kind:'local-mini-batch-summary',
  status:anyReview?'review':allChecked?'checked':'partial',
  input:{features:countIfComplete('input')},
  output:{features:countIfComplete('output')},
  checks:results.map((r,i)=>({
   id:'batch-file-'+(i+1),
   status:r.quality?.status==='checked'?'pass':r.quality?.status==='review'?'review':'unavailable',
   detail:'File '+(i+1)+' ('+safeBatchEntryName(sourceNames[i])+'): '+
    (r.quality?.status==='checked'?'structural checks passed':
     r.quality?.status==='review'?'review warnings in its ZIP report':
     'some checks are unavailable; inspect its ZIP report')
  })),
  disclaimer:'Each converted file has its own full quality report inside the ZIP. '+
   'This is not a guarantee of GIS accuracy.'
 };
}
