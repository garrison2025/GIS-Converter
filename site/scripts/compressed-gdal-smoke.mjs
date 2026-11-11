import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('dist');
let gzRequests=0, browser;
const port=8772;
const server=createServer((req,res)=>{
 try{
  const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(requested.includes('\0'))throw Error('NUL path');
  const wasm=requested==='/engine/gdal3/gdal3WebAssembly.wasm';
  let relative=wasm?requested+'.gz':requested;
  if(relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,'.'+relative);
  if(!file.startsWith(root+path.sep) || !existsSync(file)){res.writeHead(404);res.end('Not found');return}
  const type=wasm?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.data')?'application/octet-stream':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream';
  const headers={'Content-Type':type,'Content-Length':statSync(file).size,'X-Content-Type-Options':'nosniff'};
  if(wasm){gzRequests++;headers['Content-Encoding']='gzip';headers['Cache-Control']='public, max-age=3600';}
  res.writeHead(200,headers);createReadStream(file).pipe(res);
 }catch(e){res.writeHead(500);res.end(String(e))}
});
const report={status:'RUNNING',gzRequests:0};
try{
 if(!existsSync(path.resolve(root,'engine/gdal3/gdal3WebAssembly.wasm.gz')))throw Error('No gzip WASM asset');
 await new Promise((ok,fail)=>server.listen(port,'127.0.0.1',e=>e?fail(e):ok()));
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+port+'/internal/matrix/');
 await page.waitForFunction(()=>document.body.dataset.done==='true',{timeout:120000});
 const matrix=await page.evaluate(()=>window.__matrixResult);
 report.matrix=matrix;report.gzRequests=gzRequests;report.pageErrors=errors;
 if(matrix?.status!=='PASSED'||matrix.tested?.length!==6||gzRequests<1||errors.length)throw Error('Compressed GDAL failed real conversion: '+JSON.stringify({status:matrix.status,tests:matrix.tested,gzRequests,errors}));
 report.status='PASSED';
}catch(e){report.status='FAILED';report.error=String(e?.stack||e)}
finally{writeFileSync('compressed-gdal-browser-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await new Promise(ok=>server.close(()=>ok()))}
if(report.status!=='PASSED')process.exitCode=1;
