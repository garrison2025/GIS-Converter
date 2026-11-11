import fs from 'node:fs';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const origin='https://gis-converter.pages.dev';
const report={origin,checkedAt:new Date().toISOString(),status:'RUNNING',http:[],tests:[],errors:[],browserErrors:[]};
function record(label,r){report.http.push({label,status:r.status,url:r.url,headers:{'content-type':r.headers.get('content-type'),'content-encoding':r.headers.get('content-encoding'),'cache-control':r.headers.get('cache-control'),'x-robots-tag':r.headers.get('x-robots-tag'),'cf-cache-status':r.headers.get('cf-cache-status')}})}
function assert(x,msg){if(!x)throw Error(msg)}
let browser;
async function httpCheck(label,path,{readBinary=false}={}){
 const r=await fetch(origin+path,{signal:AbortSignal.timeout(120000),headers:{'User-Agent':'GIS-Converter-Official-Live-QA/1.0'}});
 record(label,r);
 if(!r.ok)throw Error(label+' HTTP '+r.status+' '+r.url);
 if(readBinary)return {r,body:new Uint8Array(await r.arrayBuffer())};
 return {r,body:await r.text()};
}
async function uploadAndDownload(page,slug,{name,bytes,mime},ext){
 const started=Date.now();
 await page.goto(origin+'/converter/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
 assert((await page.locator('meta[name="robots"]').getAttribute('content'))?.includes('noindex'),slug+' missing noindex');
 await page.locator('#file').setInputFiles({name,mimeType:mime,buffer:bytes});
 await page.locator('#submit').click();
 try{await page.locator('#result').waitFor({state:'visible',timeout:120000})}
 catch(e){throw Error(slug+' conversion did not complete: '+await page.locator('#error').textContent()+'; status='+await page.locator('#status').textContent())}
 const p=page.waitForEvent('download');
 await page.locator('#download').click();
 const dl=await p;
 assert(dl.suggestedFilename().endsWith(ext),slug+' wrong download suffix '+dl.suggestedFilename());
 const downloaded=fs.readFileSync(await dl.path());
 assert(downloaded.length>10,slug+' output empty');

 const qualityView=page.locator('#quality');
 await qualityView.waitFor({state:'visible',timeout:10000});
 const status=await qualityView.getAttribute('data-status');
 assert(['partial','review','checked'].includes(status),'Quality status missing '+slug);
 const jsonDownloadWait=page.waitForEvent('download');
 await page.locator('#quality-download').click();
 const qdl=await jsonDownloadWait;
 const q=JSON.parse(fs.readFileSync(await qdl.path(),'utf8'));
 assert(q.kind==='local-structural-quality-report','Wrong quality report kind '+slug);
 assert(q.input?.features===1&&q.output?.features===1,'Quality report feature counts not 1/1 '+slug);
 assert(q.checks.some(c=>c.id==='feature-count'&&c.status==='pass'),'Feature count check should pass '+slug);
 assert(q.checks.some(c=>c.id==='attribute-fidelity'&&c.status==='unavailable'),'Attribute check incorrectly certified '+slug);
 report.tests.push({route:slug,quality:{status,featuresIn:q.input.features,featuresOut:q.output.features,checks:q.checks.map(x=>({id:x.id,status:x.status}))}});

 Object.assign(report.tests.at(-1),{download:dl.suggestedFilename(),bytes:downloaded.length,elapsedMs:Date.now()-started});
 return downloaded;
}
try{
 const root=await httpCheck('homepage','/');
 const paths=[...root.body.matchAll(/href="(\/converter\/[a-z-]+\/)"/g)].map(m=>m[1]);
 assert(new Set(paths).size===19,'Homepage route count is '+new Set(paths).size+', expected 19');
 report.homepageLinks=paths.length;
 assert(root.body.includes('Convert GIS files in your browser.'),'New homepage has not deployed');
 const robots=await httpCheck('robots','/robots.txt');
 assert(/Disallow:\s*\//i.test(robots.body),'robots.txt does not disallow indexing');
 const page1=await httpCheck('kml-to-geojson','/converter/kml-to-geojson/');
 assert(page1.body.includes('noindex,nofollow'),'tool page meta robots not found');
 const raw=await httpCheck('wasm','/engine/gdal3/gdal3WebAssembly.wasm',{readBinary:true});
 report.wasm={decodedBytes:raw.body.length,magic:Buffer.from(raw.body.subarray(0,4)).toString('hex')};
 assert(report.wasm.magic==='0061736d','Actual live Pages WASM content does not decode to WebAssembly magic. '+JSON.stringify(report.wasm));
 assert(raw.body.length>20*1024*1024,'WASM decoded size unexpectedly small');
 const data=await httpCheck('gdalData','/engine/gdal3/gdal3WebAssembly.data',{readBinary:true});
 report.dataBytes=data.body.length;
 assert(data.body.length>1024*1024,'GDAL .data resource missing or too small');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:800}});
 const page=await ctx.newPage();
 page.on('pageerror',e=>report.browserErrors.push(String(e)));
 page.on('response',resp=>{if(resp.status()>=400&&resp.url().startsWith(origin))report.errors.push('HTTP '+resp.status()+' '+resp.url())});
 await page.goto(origin+'/');
 await page.locator('#filter').fill('kmz-to-shp');
 assert(await page.locator('a.tool:visible').count()===1,'Live search does not filter to KMZ→SHP');
 await page.locator('#filter').fill('');
 assert(await page.locator('a.tool:visible').count()===19,'Live search clear did not restore all tools');
 report.searchFilter='PASSED';
 const kml='<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Live Test</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
 const geoBytes=await uploadAndDownload(page,'kml-to-geojson',{name:'test.kml',bytes:Buffer.from(kml),mime:'application/vnd.google-earth.kml+xml'},'.geojson');
 const obj=JSON.parse(geoBytes.toString('utf8'));
 assert(obj.type==='FeatureCollection' && obj.features?.length===1,'GeoJSON feature count/type error');
 const coords=obj.features[0].geometry?.coordinates;
 assert(Math.abs(coords[0]-116.4)<.0001&&Math.abs(coords[1]-39.9)<.0001,'GeoJSON coordinates changed');
 report.tests.at(-1).coordinates=coords;
 const csv='longitude,latitude,Name\n116.4,39.9,Live Test\n';
 const kmlBytes=await uploadAndDownload(page,'csv-to-kml',{name:'test.csv',bytes:Buffer.from(csv),mime:'text/csv'},'.kml');
 assert(kmlBytes.toString('utf8').includes('<kml'),'CSV to KML output invalid');
 const z=new JSZip();z.file('doc.kml',kml);
 const kmz=Buffer.from(await z.generateAsync({type:'uint8array'}));
 const shpBytes=await uploadAndDownload(page,'kmz-to-shp',{name:'test.kmz',bytes:kmz,mime:'application/vnd.google-earth.kmz'},'.zip');
 const shp=await JSZip.loadAsync(shpBytes);
 for(const ext of ['.shp','.shx','.dbf','.prj'])assert(Object.keys(shp.files).some(n=>n.toLowerCase().endsWith(ext)),'SHP output missing '+ext);
 report.tests.at(-1).files=Object.keys(shp.files);
 // Basic mobile responsiveness (navigation and file upload UI)
 await page.setViewportSize({width:390,height:844});
 await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded'});
 report.mobile={viewportWidth:390,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)};
 assert(report.mobile.scrollWidth<=392,'Mobile horizontal overflow');
 assert(report.browserErrors.length===0,'Uncaught browser errors: '+report.browserErrors.join('; '));
 assert(report.errors.length===0,'Failed live asset requests: '+report.errors.join('; '));
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e);console.error(report.error)}
finally{
 fs.writeFileSync('live-pages-qa.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 await browser?.close();
}
if(report.status!=='PASSED')process.exitCode=1;
