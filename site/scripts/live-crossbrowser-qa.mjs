import fs from 'node:fs';
import {chromium,firefox,webkit,devices} from 'playwright';
const origin='https://gis-converter.pages.dev';
const report={checkedAt:new Date().toISOString(),origin,status:'RUNNING',engines:[],errors:[]};
const KML='<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Cross-browser</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark></Document></kml>';
function assert(v,m){if(!v)throw Error(m)}
for(const [name,launcher,ctxOpts] of [
  ['Chromium desktop',chromium,{viewport:{width:1280,height:720},acceptDownloads:true}],
  ['Firefox desktop',firefox,{viewport:{width:1280,height:720},acceptDownloads:true}],
  ['WebKit mobile iPhone 13',webkit,{...devices['iPhone 13'],acceptDownloads:true}]
]){
 const engine={name,status:'RUNNING',browserErrors:[],httpFailures:[],workerStarted:0,workerTerminated:0};
 report.engines.push(engine);
 let browser;
 try{
  browser=await launcher.launch({headless:true});
  const ctx=await browser.newContext(ctxOpts);
  const page=await ctx.newPage();
  page.on('pageerror',err=>engine.browserErrors.push(String(err)));
  page.on('response',res=>{if(res.url().startsWith(origin)&&res.status()>=400)engine.httpFailures.push({status:res.status(),url:res.url()})});
  await page.addInitScript(()=>{
    const Native=window.Worker;
    window.__qaCreated=0;window.__qaEnded=0;
    window.Worker=class extends Native{
      constructor(...args){super(...args);window.__qaCreated++}
      terminate(){window.__qaEnded++;return super.terminate()}
    };
  });
  const response=await page.goto(origin+'/converter/kml-to-geojson/',{waitUntil:'domcontentloaded',timeout:45000});
  assert(response.ok(),'Live page unavailable '+response.status());
  engine.noindex=(await page.locator('meta[name="robots"]').getAttribute('content')).includes('noindex');
  assert(engine.noindex,'Missing noindex');
  engine.viewportWidth=await page.evaluate(()=>window.innerWidth);
  engine.scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
  assert(engine.scrollWidth<=engine.viewportWidth+2,'Horizontal overflow '+engine.viewportWidth+' vs '+engine.scrollWidth);
  await page.locator('#file').setInputFiles({name:'cross.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(KML)});
  const start=Date.now();await page.locator('#submit').click();
  try{await page.locator('#result').waitFor({state:'visible',timeout:90000})}
  catch{throw Error('Conversion failure: '+(await page.locator('#error').textContent())+'; status='+(await page.locator('#status').textContent()))}
  const wait=page.waitForEvent('download',{timeout:15000});
  await page.locator('#download').click();
  const dl=await wait;
  assert(dl.suggestedFilename().endsWith('.geojson'),'Unexpected extension');
  const bytes=fs.readFileSync(await dl.path()),json=JSON.parse(bytes.toString());
  const coords=json.features?.[0]?.geometry?.coordinates;
  assert(json.type==='FeatureCollection'&&json.features.length===1,'Bad GeoJSON features');
  assert(Math.abs(coords[0]-116.4)<.0001 && Math.abs(coords[1]-39.9)<.0001,'Coordinates drift');
  const workers=await page.evaluate(()=>({created:window.__qaCreated,terminated:window.__qaEnded}));
  assert(workers.created===1&&workers.terminated===1,'Worker lifecycle invalid '+JSON.stringify(workers));
  engine.workers=workers;
  engine.outputBytes=bytes.length;
  engine.coordinates=coords;
  engine.conversionElapsedMs=Date.now()-start;
  assert(engine.browserErrors.length===0,'Uncaught errors '+engine.browserErrors.join(';'));
  assert(engine.httpFailures.length===0,'HTTP failures '+JSON.stringify(engine.httpFailures));
  engine.status='PASSED';
 }catch(e){engine.status='FAILED';engine.error=String(e?.stack||e);report.errors.push(name+': '+engine.error)}
 finally{await browser?.close()}
 console.log('BROWSER '+name+' '+engine.status+' '+(engine.error||''));
}
report.passed=report.engines.filter(e=>e.status==='PASSED').length;
report.status=report.passed===report.engines.length?'PASSED':'FAILED';
fs.writeFileSync('live-crossbrowser-qa.json',JSON.stringify(report,null,2));
console.log('CROSS_BROWSER_SUMMARY '+JSON.stringify({status:report.status,passed:report.passed,failures:report.errors}));
if(report.status!=='PASSED')process.exitCode=1;
