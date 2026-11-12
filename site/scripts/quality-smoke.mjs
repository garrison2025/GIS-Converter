import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
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
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(root+'/internal/quality/');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:150000});
 report=await page.evaluate(()=>window.__qualityResult);
 report.pageErrors=errors;
 if(report.status!=='PASSED'||report.cases.length!==16||errors.length)throw Error('GIS quality gate failed: '+JSON.stringify(report));
}catch(e){report.status='FAILED';report.executionError=String(e?.stack||e)}
finally{fs.writeFileSync('gis-quality-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server.kill()}
if(report.status!=='PASSED')process.exitCode=1;
