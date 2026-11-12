import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const server=spawn('python3',['-m','http.server','8775','--directory','dist'],{stdio:'ignore'});
const root='http://127.0.0.1:8775';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
let report={status:'FAILED',error:'Not started'};
try{
 let ready=false;
 for(let i=0;i<45;i++){try{if((await fetch(root+'/')).ok){ready=true;break}}catch{}await sleep(250)}
 if(!ready)throw Error('Quality gate staging server unavailable');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(root+'/internal/quality/');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:150000});
 report=await page.evaluate(()=>window.__qualityResult);
 report.pageErrors=errors;
 if(report.status!=='PASSED'||report.cases.length!==30||errors.length)throw Error('GIS quality gate failed: '+JSON.stringify(report));
 // P26: actual Playwright-triggered browser download, not a Blob fetch
 // pretending to be a user file download. Verify bytes and filename against
 // independent in-page GDAL output SHA-256.
 const declared=report.cases.find(c=>c.downloadName==='p26-public-etrex20x.kmz');
 if(!declared||!/^([a-f0-9]{64})$/.test(declared.sha256))throw Error('P26 download metadata missing');
 const [download]=await Promise.all([
  page.waitForEvent('download',{timeout:15000}),
  page.locator('a[data-p26-download="true"]').click({timeout:15000})
 ]);
 if(download.suggestedFilename()!==declared.downloadName)
  throw Error('P26 browser download filename mismatch');
 const savedPath=await download.path();
 const local=fs.readFileSync(savedPath);
 const digest=createHash('sha256').update(local).digest('hex');
 if(local.length!==declared.downloadSize||digest!==declared.sha256)
  throw Error('P26 downloaded KMZ bytes failed SHA-256 verification');
 report.p26Download={status:'PASSED',name:download.suggestedFilename(),
  bytes:local.length,sha256Matches:true,method:'real Chromium user-click download event'};
}catch(e){report.status='FAILED';report.executionError=String(e?.stack||e)}
finally{fs.writeFileSync('gis-quality-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
