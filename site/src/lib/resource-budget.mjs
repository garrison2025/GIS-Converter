/**
 * P42: conservative, browser-local resource controls.
 *
 * deviceMemory is a rough, optional browser hint, NOT measured free RAM or a
 * guarantee of success. Users can explicitly select the same mode when their
 * browser does not expose the hint (e.g. Firefox or Safari).
 */
export const LOW_MEMORY_HINT_GIB=2;
export const LOW_MEMORY_BATCH_INPUT_BYTES=12*1024*1024;
export const LOW_MEMORY_BATCH_OUTPUT_BYTES=24*1024*1024;
export function suggestedMemorySavingMode(deviceMemoryGiB){
 return typeof deviceMemoryGiB==='number' && Number.isFinite(deviceMemoryGiB) &&
   deviceMemoryGiB>0 && deviceMemoryGiB<=LOW_MEMORY_HINT_GIB;
}
export function checkMemorySavingSelection(files,conserveMemory){
 if(!conserveMemory||!files||files.length<=1)return null;
 const total=Array.from(files).reduce((sum,file)=>sum+Number(file?.size||0),0);
 if(total>LOW_MEMORY_BATCH_INPUT_BYTES)
  return 'Memory-saving mode limits a mini-batch to 12 MiB total. Convert one file at a time, or turn off memory-saving mode on a device with sufficient memory.';
 return null;
}
export function shouldRenderOptionalPreview(conserveMemory){
 // All conversion, independent GIS fidelity and quality reporting still run.
 // The preview is the only entirely optional GDAL round-trip.
 return !conserveMemory;
}
