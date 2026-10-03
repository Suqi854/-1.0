// Node/SQLite-only manual loopback adapter. It has no cloud route, timer or collector.
import {isTrustedLocalDatabase} from './sqlite.mjs';
import {callData,symbol,parseHistory,serviceMetadata} from '../src/worker.mjs';
import {marketState} from '../src/market-session.mjs';
import {listWatchlist} from './local-watchlist.mjs';
import {runSwingScreen,SWING_LIMITS} from '../src/swing-screening.mjs';
import {contextFetchText} from '../src/context-fetch.mjs';
import {archiveObservations,readArchive,snapshotKey,saveSnapshot,readSnapshot,auctionWithLocalStorage} from './local-observation-store.mjs';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function trusted(env){if(!isTrustedLocalDatabase(env))throw Error('TRUSTED_LOCAL_SQLITE_REQUIRED');}
function archiveArguments(a){if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['symbol','source','interval','adjustment','limit','before'].includes(k)))throw Error('INVALID_ARCHIVE_ARGUMENTS');const r={symbol:symbol(a.symbol),source:a.source,interval:a.interval,adjustment:a.adjustment??'none',limit:a.limit??120,before:a.before};if(!['tencent','sina'].includes(r.source)||!['intraday','1m','5m','1d','1w','1mo'].includes(r.interval)||!['none','qfq','hfq'].includes(r.adjustment)||(['intraday','1m','5m'].includes(r.interval)&&r.adjustment!=='none')||!Number.isInteger(r.limit)||r.limit<1||r.limit>600||r.before!==undefined&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(r.before)||!Number.isFinite(Date.parse(r.before))))throw Error('INVALID_ARCHIVE_ARGUMENTS');return r;}
export async function localCallData(p,env,owner='local-single-user'){
 trusted(env);
 if(p?.name==='get_archive'){const a=archiveArguments(p.arguments);return {...await readArchive(env,a),service:serviceMetadata(),market_state:marketState(Date.now(),a.symbol),execution:'trusted_local_sqlite'};}
 if(p?.name==='get_swing_screen'&&(p.arguments?.universe==='original_watchlist'||p.arguments?.thresholds!==undefined))return {...await runSwingScreen(p.arguments??{},{normalize:symbol,listOriginal:after=>listWatchlist(env,owner,after),loadHistory:async(s,{now,timeout_ms})=>parseHistory(await contextFetchText('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+s+',day,,,'+SWING_LIMITS.requested_bars+',qfq',{timeoutMs:timeout_ms}),s,'1d',SWING_LIMITS.requested_bars,'qfq',true,Date.now(),now)}),service:serviceMetadata(),execution:'trusted_local_sqlite'};
 if(p?.name==='get_auction'){const s=symbol(p.arguments?.symbol);if(!p.arguments||Object.keys(p.arguments).some(k=>k!=='symbol'))throw Error('INVALID_ARGUMENTS');return auctionWithLocalStorage(env,s,()=>callData(p,undefined,owner));}
 const persist=['get_bars','get_intraday'].includes(p?.name),key=persist?snapshotKey(p.name,{...(p.arguments??{}),symbol:p.arguments?.symbol?symbol(p.arguments.symbol):null}):null;
 try{const data=await callData(p,undefined,owner);if(!persist||data.cache?.used)return {...data,execution:'trusted_local_sqlite'};return {...data,storage:await saveSnapshot(env,key,data),archive:await archiveObservations(env,data),execution:'trusted_local_sqlite'};}
 catch(error){if(persist&&!/^(INVALID_|SYMBOL|MINUTE_ADJUSTMENT|UNKNOWN_TOOL)/.test(String(error.message))){const cached=await readSnapshot(env,key);if(cached)return {...cached,service:serviceMetadata(),execution:'trusted_local_sqlite'};}throw error;}
}
export async function localAccountMarket(req,env,owner='local-single-user'){
 trusted(env);
 const url=new URL(req.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')return json({error:{message:'LOCAL_LOOPBACK_REQUIRED'}},403);
 if(req.method!=='POST')return json({error:{message:'Method not allowed'}},405);
 if(req.headers.get('origin')!==url.origin||['cross-site','none'].includes(req.headers.get('sec-fetch-site')))return json({error:{message:'Cross-site request rejected'}},403);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:{message:'Expected application/json'}},415);
 let p;try{const body=await req.text();if(body.length>20000)throw Error();p=JSON.parse(body);if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['name','arguments'].includes(k)))throw Error();}catch{return json({error:{message:'INVALID_LOCAL_REQUEST'}},400);}
 try{return json({data:await localCallData(p,env,owner)});}catch{return json({error:{code:'LOCAL_DATA_REQUEST_FAILED',message:'Local market request unavailable'}},502);}
}
