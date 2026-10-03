// Manual single-user loopback host. No credentials, bridge, timer or collector.
import http from 'node:http';import {mkdirSync} from 'node:fs';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {openLocalDatabase,isTrustedLocalDatabase} from './sqlite.mjs';import {page} from '../src/page.mjs';import {symbol,quotes} from '../src/worker.mjs';import {localAccountMarket} from './local-market.mjs';
import {accountWatchlist} from './local-watchlist.mjs';import {accountStockSearch} from '../src/stock-search.mjs';import {conditionScreenResponse} from '../src/condition-screen-page.mjs';
const OWNER='local-single-user';
const removed=()=>new Response(JSON.stringify({available:false,data_status:'unsupported',code:'PUBLIC_PROFILE_CAPABILITY_REMOVED',credential_reads:false,credential_writes:false,source_requests:0,collector_enabled:false}),{status:501,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function createLocalHandler(env,{origin,collectEnabled=false}={}){
 if(collectEnabled)throw Error('PUBLIC_PROFILE_COLLECTOR_UNSUPPORTED');
 return async req=>{
  const u=new URL(req.url);if(u.origin!==origin)return new Response('Invalid host',{status:403});
  if(req.method==='POST'&&(req.headers.get('origin')!==origin||['cross-site','none'].includes(req.headers.get('sec-fetch-site'))))return new Response('Cross-site request rejected',{status:403});
  if(['/api/data-source-settings','/api/cloud-bridge-settings','/api/cloud-bridge','/api/cloud-bridge-test'].includes(u.pathname))return removed();
  const conditionPage=conditionScreenResponse(req);if(conditionPage)return conditionPage;
  if(req.method==='GET'&&u.pathname==='/')return new Response(page.replace('const PAGE_LOCAL_PREFERENCE_ALLOWED=false;','const PAGE_LOCAL_PREFERENCE_ALLOWED=true;').replace('const PAGE_PUBLIC_RETENTION_ALLOWED=false;','const PAGE_PUBLIC_RETENTION_ALLOWED=true;'),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'"}});
  if(u.pathname==='/api/market')return localAccountMarket(req,env,OWNER);
  if(u.pathname==='/api/watchlist'){if(!isTrustedLocalDatabase(env))return removed();return accountWatchlist(req,env,OWNER,{symbol,verify:async s=>(await quotes({symbols:[s],include_book:false})).quotes[0]});}
  if(u.pathname==='/api/stock-search')return accountStockSearch(req,OWNER,{normalize:symbol});
  return new Response('Not found',{status:404});
 };
}
export async function startLocalServer({port=8765,database=resolve('local-data/ashare.sqlite'),collectEnabled=false}={}){
 if(collectEnabled)throw Error('PUBLIC_PROFILE_COLLECTOR_UNSUPPORTED');if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_LOCAL_PORT');
 mkdirSync(dirname(database),{recursive:true,mode:0o700});const env=openLocalDatabase(database),origin='http://127.0.0.1:'+port,handler=createLocalHandler(env,{origin});
 const server=http.createServer(async(req,res)=>{try{if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);res.end('Invalid host');return;}let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'LOCAL_REQUEST_FAILED'}}));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {origin,close:async()=>{await new Promise(resolve=>server.close(resolve));env.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--collect'))throw Error('PUBLIC_PROFILE_COLLECTOR_UNSUPPORTED');const app=await startLocalServer();console.log('Manual credential-free local workspace: '+app.origin);}
