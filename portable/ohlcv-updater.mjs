// Prepared local-only data engine. Not imported by the Site, scheduled, or
// connected to a source. Hosts must inject both a local store and a loader.
import {types as nodeTypes} from 'node:util';
import {MARKET_CALENDAR,tradingDay,latestCompletedPeriod,barCompletion} from '../src/market-session.mjs';
import {coverage as observedCoverage} from '../src/data-integrity.mjs';
import {classifyMainboardItem,hashMainboardManifest,PUBLIC_MAINBOARD_UNIVERSE_VERSION} from '../src/mainboard-universe.mjs';
export const OHLCV_POLICY=Object.freeze({version:'local-ohlcv-v1',series:Object.freeze([
 Object.freeze({interval:'1d',adjustment:'none',limit:200}),Object.freeze({interval:'1w',adjustment:'none',limit:104}),
 Object.freeze({interval:'1mo',adjustment:'none',limit:60}),Object.freeze({interval:'1d',adjustment:'qfq',limit:200})
]),max_symbols:10000,advance_symbols:20,concurrency:3,max_requests:80,deadline_ms:24000,source_timeout_ms:6500,lease_ms:30000,max_series_bytes:262144});
const STATES=['ready','partial','pending_source','failed_without_data'];
const iso=n=>new Date(n).toISOString(),copy=x=>structuredClone(x),cnDate=n=>new Date(n+28800000).toISOString().slice(0,10);
const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&iso(Date.parse(d+'T00:00:00Z')).slice(0,10)===d;
const seriesKey=s=>s.interval+':'+s.adjustment;
const publicSymbol=s=>typeof s==='string'&&/^(?:sh(?:600|601|603|605)\d{3}|sz(?:000|001|002|003|004)\d{3})$/.test(s)&&s!=='sz000000'&&!(s.startsWith('sz')&&Number(s.slice(2))>=1001&&Number(s.slice(2))<=1199);
async function hash(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function allowedObject(x,keys,error){if(!x||typeof x!=='object'||Array.isArray(x)||![Object.prototype,null].includes(Object.getPrototypeOf(x))||Reflect.ownKeys(x).some(k=>typeof k!=='string'||!keys.includes(k)||!('value' in Object.getOwnPropertyDescriptor(x,k))))throw Error(error);}
function jsonData(value){let nodes=0;const visiting=new Set();function visit(x,depth){if(++nodes>800000||depth>24)throw Error('LOCAL_MANIFEST_JSON_BOUNDS');if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return;if(!x||typeof x!=='object'||nodeTypes.isProxy(x)||visiting.has(x)||!Array.isArray(x)&&![Object.prototype,null].includes(Object.getPrototypeOf(x)))throw Error('LOCAL_MANIFEST_JSON_REQUIRED');const keys=Reflect.ownKeys(x),array=Array.isArray(x);if(array&&(x.length>OHLCV_POLICY.max_symbols||keys.length!==x.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^\d+$/.test(k)||String(Number(k))!==k||Number(k)>=x.length))))throw Error('LOCAL_MANIFEST_JSON_REQUIRED');visiting.add(x);for(const key of keys){if(typeof key!=='string')throw Error('LOCAL_MANIFEST_JSON_REQUIRED');const d=Object.getOwnPropertyDescriptor(x,key);if(!('value' in d))throw Error('LOCAL_MANIFEST_JSON_REQUIRED');if(array&&key==='length')continue;if(!d.enumerable)throw Error('LOCAL_MANIFEST_JSON_REQUIRED');visit(d.value,depth+1);}visiting.delete(x);}visit(value,0);}
function poolItems(value){if(!Array.isArray(value)||value.length<1||value.length>OHLCV_POLICY.max_symbols)throw Error('INVALID_OHLCV_MANIFEST');const seen=new Set();return value.map(item=>{allowedObject(item,['symbol','name'],'PRIVATE_OR_UNSUPPORTED_MANIFEST_FIELD');if(!publicSymbol(item.symbol)||seen.has(item.symbol)||typeof item.name!=='string'||!item.name.trim()||item.name.length>80||/^(?:\*?ST)/i.test(item.name.normalize('NFKC').trim())||/[\x00-\x1f\x7f]/.test(item.name))throw Error('INVALID_PUBLIC_MAINBOARD_ITEM');seen.add(item.symbol);return {symbol:item.symbol,name:item.name};}).sort((a,b)=>a.symbol.localeCompare(b.symbol));}
/** Hashes local selected identities only; never chooses or certifies leaders. */
export async function hashOHLCVPool(items){jsonData(items);return hash(poolItems(items));}
async function curatedIdentity(input,items,directory){
 const curated=input.curated_universe;allowedObject(curated,['kind','version','pool_hash','evidence_revision','status'],'INVALID_CURATED_UNIVERSE');
 const label=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(x);
 if(curated.kind!=='industry_leaders'||!label(curated.version)||!label(curated.evidence_revision)||!['candidate','reviewed'].includes(curated.status)||curated.pool_hash!==await hash(items))throw Error('INVALID_CURATED_UNIVERSE');
 if(input.directory_identity_hash!==input.manifest_hash||!directory)throw Error('LOCAL_DIRECTORY_IDENTITY_REQUIRED');jsonData(directory);
 if(directory.available!==true||directory.data_status!=='ready'||directory.read_only!==true||directory.source!=='sse_szse_public'||directory.manifest?.version!==PUBLIC_MAINBOARD_UNIVERSE_VERSION||directory.manifest.source!=='sse_szse_public'||directory.manifest_hash!==input.directory_identity_hash||!Array.isArray(directory.manifest.items)||directory.manifest.items.length>OHLCV_POLICY.max_symbols||await hashMainboardManifest(directory.manifest)!==input.directory_identity_hash)throw Error('LOCAL_DIRECTORY_IDENTITY_INVALID');
 const rows=new Map();let eligible=0;for(const item of directory.manifest.items){const classified=classifyMainboardItem(item);if(rows.has(item.symbol)||item.classification!==classified.classification)throw Error('LOCAL_DIRECTORY_IDENTITY_INVALID');rows.set(item.symbol,classified);if(classified.classification==='eligible_mainboard_non_st')eligible++;}
 for(const item of items){const row=rows.get(item.symbol);if(!row||row.name!==item.name||row.classification!=='eligible_mainboard_non_st')throw Error('CURATED_MEMBER_IDENTITY_MISMATCH');}
 return {directory_identity_hash:input.directory_identity_hash,curated_universe:{kind:curated.kind,version:curated.version,pool_hash:curated.pool_hash,evidence_revision:curated.evidence_revision,status:curated.status},directory_identity:{manifest_hash:input.directory_identity_hash,version:directory.manifest.version,provider_rows:rows.size,eligible_mainboard_non_st:eligible,selected_identity_matches:items.length,validation:'local_import_hash_and_identity_match',official_st_status:'unknown',historical_membership:'unknown',leader_evidence_verified_by_updater:false}};
}
function runId(value){if(typeof value!=='string'||!/^local-ohlcv-[a-f0-9]{64}$/.test(value))throw Error('INVALID_LOCAL_DATASET_ID');return value;}
export async function createOHLCVManifest(input,{now=Date.now(),directory}={}){
 jsonData(input);allowedObject(input,['items','manifest_hash','target_session','directory_identity_hash','curated_universe'],'INVALID_OHLCV_MANIFEST');
 const target=latestCompletedPeriod(now,'1d');if(!target||input.target_session!==undefined&&input.target_session!==target)throw Error('UNKNOWN_OR_DIFFERENT_TARGET_SESSION');
 if(typeof input.manifest_hash!=='string'||!(/^[a-f0-9]{64}$/).test(input.manifest_hash)||!Array.isArray(input.items)||input.items.length<1||input.items.length>OHLCV_POLICY.max_symbols)throw Error('INVALID_OHLCV_MANIFEST');
 const items=poolItems(input.items),curated=input.curated_universe!==undefined||input.directory_identity_hash!==undefined;
 const identityBasis=curated?await curatedIdentity(input,items,directory):{};
 const manifest={policy_version:OHLCV_POLICY.version,manifest_hash:input.manifest_hash,...identityBasis,items,target_session:target,calendar_version:MARKET_CALENDAR.calendar_version,series:OHLCV_POLICY.series.map(copy),source:'tencent',source_finality:'unknown',historical_membership:'unknown',point_in_time:false,scope:curated?'local_curated_industry_leaders_name_exclusion_observations':'local_public_mainboard_name_exclusion_observations',created_at:iso(now)};
 const identity=await hash({...manifest,created_at:undefined});return {...manifest,run_id:'local-ohlcv-'+identity};
}
export async function validateOHLCVSeries(data,item,series,manifest,{started_at,fetched_at}={}){
 const fail=code=>({status:code==='SOURCE_BEHIND_TARGET_SESSION'?'pending_source':'failed_without_data',error_code:code,key:seriesKey(series),dataset:null});
 if(!data||data.symbol!==item.symbol||data.source!=='tencent'||data.interval!==series.interval||data.adjustment!==series.adjustment||data.cache?.used===true||!Array.isArray(data.bars)||!data.bars.length||data.bars.length>series.limit)return fail('INVALID_SERIES_BASIS');
 if(!Number.isFinite(started_at)||!Number.isFinite(fetched_at)||fetched_at<started_at||Date.parse(data.fetched_at)!==fetched_at||latestCompletedPeriod(started_at,'1d')!==manifest.target_session)return fail('INVALID_OBSERVATION_CUTOFF');
 const seen=new Set(),bars=[];
 for(const b of data.bars){
  if(!b||!date(b.date)||b.date>manifest.target_session||seen.has(b.date)||typeof b.source_timestamp!=='string'||!Number.isFinite(Date.parse(b.source_timestamp))||cnDate(Date.parse(b.source_timestamp))!==b.date)return fail('INVALID_SERIES_DATES');seen.add(b.date);
  if(series.interval==='1d'&&tradingDay(b.date)===false)return fail('BAR_ON_NONTRADING_DATE');
  if(['open','high','low','close'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])||b[k]<=0)||typeof b.volume_shares!=='number'||!Number.isFinite(b.volume_shares)||b.volume_shares<0||b.low>b.high||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high||b.amount_cny!==null&&b.amount_cny!==undefined)return fail('INVALID_OHLCV_VALUES');
  bars.push({date:b.date,source_timestamp:b.date+'T15:00:00+08:00',open:b.open,high:b.high,low:b.low,close:b.close,volume_shares:b.volume_shares,amount_cny:null,...barCompletion(b.date,series.interval,started_at)});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));const last=bars.at(-1);
 // Current weekly/monthly labels must be observed at the target session. Their
 // still-forming period is stored explicitly, never promoted to complete.
 if(last.date!==manifest.target_session)return fail('SOURCE_BEHIND_TARGET_SESSION');
 if(series.interval==='1d'&&last.calendar_completion!==true)return fail('UNVERIFIED_TARGET_COMPLETION');
 const values=bars.map(b=>[b.date,b.open,b.high,b.low,b.close,b.volume_shares,null]);
 const audit=observedCoverage({interval:series.interval,bars});
 const dataset={dataset_id:manifest.run_id,symbol:item.symbol,source:'tencent',interval:series.interval,adjustment:series.adjustment,bars,source_timestamp:last.source_timestamp,fetched_at:iso(fetched_at),request_started_at:iso(started_at),completion_cutoff:iso(started_at),target_session:manifest.target_session,calendar_version:manifest.calendar_version,policy_version:manifest.policy_version,content_hash:await hash(values),source_finality:'unknown',point_in_time:false,cache:{used:true,scope:'explicit_local_dataset'},coverage:{requested:series.limit,returned:bars.length,first_date:bars[0].date,last_date:last.date,full_history:false,calendar_unverified_rows:bars.filter(b=>b.calendar_completion===null).length,missing_scheduled_session_dates:audit.missing_scheduled_session_dates,calendar_gaps_unverified:audit.calendar_gaps_unverified,missing_session_note:audit.missing_session_note},units:{price:'CNY',volume:'shares; provider unadjusted reported volume',amount:'unavailable=null'},warnings:['LOCAL_OBSERVED_WINDOW_ONLY','SOURCE_FINAL_REVISIONS_UNKNOWN','QFQ_HISTORY_NOT_POINT_IN_TIME','MISSING_SESSIONS_DO_NOT_PROVE_SUSPENSION']};
 if(new TextEncoder().encode(JSON.stringify(dataset)).byteLength>OHLCV_POLICY.max_series_bytes)return fail('SERIES_TOO_LARGE');
 return {status:'ready',error_code:null,key:seriesKey(series),dataset};
}
export function OHLCVCoverage(manifest,items){
 const members=new Set(manifest.items.map(x=>x.symbol)),entries=new Map();for(const item of items){if(!members.has(item.symbol)||entries.has(item.symbol)||!STATES.includes(item.state))throw Error('INVALID_OHLCV_LEDGER');entries.set(item.symbol,item);}
 const counts=Object.fromEntries(STATES.map(state=>[state,[...entries.values()].filter(i=>i.state===state).length]));counts.pending=manifest.items.length-entries.size;
 return {eligible:manifest.items.length,...counts,all_processed:counts.pending===0,all_ready:counts.ready===manifest.items.length,exchange_certified:false,source_finality:'unknown'};
}
export function createLocalOHLCVUpdater({runtime,store,loadSeries,now=()=>Date.now()}={}){
 if(runtime!=='local'||!store||['prepare','read','acquire','commit','release','pause'].some(k=>typeof store[k]!=='function')||typeof loadSeries!=='function')throw Error('LOCAL_OHLCV_HOST_REQUIRED');
 async function prepare(input,{directory}={}){const manifest=await createOHLCVManifest(input,{now:now(),directory});await store.prepare(manifest);return status(manifest.run_id);}
 async function status(id){const saved=await store.read(runId(id));if(!saved)throw Error('LOCAL_DATASET_NOT_FOUND');return {run_id:saved.manifest.run_id,target_session:saved.manifest.target_session,manifest_hash:saved.manifest.manifest_hash,calendar_version:saved.manifest.calendar_version,policy_version:saved.manifest.policy_version,paused:saved.paused===true,coverage:OHLCVCoverage(saved.manifest,saved.items),universe:{scope:saved.manifest.scope,curated_universe:saved.manifest.curated_universe??null,directory_identity:saved.manifest.directory_identity??null,directory_identity_hash:saved.manifest.directory_identity_hash??null,identity_validation:saved.manifest.curated_universe?'local_import_hash_and_identity_match':'legacy_identity_not_verified'},source_finality:'unknown',runtime:'local',activated_background:false};}
 async function advance(id,{retry_failed=false}={}){
  runId(id);if(typeof retry_failed!=='boolean')throw Error('INVALID_RETRY_FLAG');const started=now(),saved=await store.read(id);if(!saved)throw Error('LOCAL_DATASET_NOT_FOUND');if(saved.paused)return {...await status(id),reason:'paused',request_count:0};
  if(latestCompletedPeriod(started,'1d')!==saved.manifest.target_session)return {...await status(id),reason:'new_target_session_required',request_count:0};
  const fence=await store.acquire(id,started,started+OHLCV_POLICY.lease_ms);if(fence===null)return {...await status(id),reason:'lease_busy',request_count:0};
  let requests=0,cursor=0,budgetStop=false;const attempted=new Map(saved.items.map(x=>[x.symbol,x]));
  const queue=saved.manifest.items.filter(x=>!attempted.has(x.symbol)||retry_failed&&attempted.get(x.symbol).state!=='ready').slice(0,OHLCV_POLICY.advance_symbols);
  const previousData=(await store.read(id,{symbols:queue.map(x=>x.symbol)})).datasets;
  async function lane(){while(cursor<queue.length){const item=queue[cursor++];if(budgetStop||now()>=started+OHLCV_POLICY.deadline_ms||requests+4>OHLCV_POLICY.max_requests){budgetStop=true;break;}
   const previous=attempted.get(item.symbol),preserved=previousData[item.symbol]??{};
   const outcomes=(previous?.series??[]).filter(x=>x.status==='ready'&&preserved[x.key]).map(x=>({...x,dataset:preserved[x.key]}));
   for(const series of OHLCV_POLICY.series){if(outcomes.some(x=>x.key===seriesKey(series)&&x.status==='ready'))continue;if(budgetStop||now()>=started+OHLCV_POLICY.deadline_ms||requests>=OHLCV_POLICY.max_requests){budgetStop=true;break;}const requestStart=now(),timeout=Math.min(OHLCV_POLICY.source_timeout_ms,started+OHLCV_POLICY.deadline_ms-requestStart),controller=new AbortController();let timer;
    requests++;try{const data=await Promise.race([loadSeries(item.symbol,{...series,include_incomplete:true,source:'tencent',timeout_ms:timeout,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SOURCE_TIMEOUT'));},timeout);})]);outcomes.push(await validateOHLCVSeries(data,item,series,saved.manifest,{started_at:requestStart,fetched_at:Date.parse(data.fetched_at)}));}
    catch(e){if(e?.message==='SOURCE_TIMEOUT')budgetStop=true;outcomes.push({key:seriesKey(series),status:'failed_without_data',error_code:e?.message==='SOURCE_TIMEOUT'?'SOURCE_TIMEOUT':'SOURCE_UNAVAILABLE',dataset:null});}finally{clearTimeout(timer);}
   }
   // Missing requested series is a partial attempted item, not a completed job.
   const datasets=Object.fromEntries(outcomes.filter(o=>o.dataset).map(o=>[o.key,o.dataset]));
   const state=outcomes.length===4&&outcomes.every(o=>o.status==='ready')?'ready':Object.keys(datasets).length?'partial':outcomes.some(o=>o.status==='pending_source')?'pending_source':'failed_without_data';
   const entry={symbol:item.symbol,state,attempted_at:iso(started),observed_at:iso(now()),series:outcomes.map(({key,status,error_code})=>({key,status,error_code})),missing_series:OHLCV_POLICY.series.map(seriesKey).filter(key=>!outcomes.some(o=>o.key===key)),source_finality:'unknown'};
   if(!await store.commit(id,fence,item.symbol,entry,datasets,now())){budgetStop=true;break;}
  }}
  try{await Promise.all(Array.from({length:Math.min(OHLCV_POLICY.concurrency,queue.length)},lane));}
  finally{await store.release(id,fence,now());}
  return {...await status(id),reason:budgetStop?'bounded_advance_stopped':'bounded_advance_finished',request_count:requests,elapsed_ms:Math.max(0,now()-started),limits:OHLCV_POLICY,manual_or_host_invoked:true};
 }
 async function pause(id,paused=true){if(typeof paused!=='boolean')throw Error('INVALID_PAUSE');await store.pause(runId(id),paused,now());return status(id);}
 async function readDataset(id,symbol,key){const saved=await store.read(runId(id),{symbols:[symbol]});if(!saved)throw Error('LOCAL_DATASET_NOT_FOUND');if(!OHLCV_POLICY.series.some(s=>seriesKey(s)===key)||!saved.manifest.items.some(i=>i.symbol===symbol))throw Error('INVALID_DATASET_SERIES');const item=saved.items.find(i=>i.symbol===symbol);if(item?.state!=='ready')return {available:false,state:item?.state??'pending',dataset:null,source_finality:'unknown'};return {available:true,state:'ready',dataset:copy(saved.datasets[symbol]?.[key]),source_finality:'unknown'};}
 return Object.freeze({prepare,advance,status,pause,readDataset});
}
