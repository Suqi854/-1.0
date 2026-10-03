import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createLocalOHLCVUpdater,createOHLCVManifest,validateOHLCVSeries,OHLCV_POLICY,OHLCVCoverage,hashOHLCVPool} from '../portable/ohlcv-updater.mjs';
import {openLocalOHLCVStore} from '../portable/ohlcv-store.mjs';
import {classifyMainboardItem,hashMainboardManifest,PUBLIC_MAINBOARD_UNIVERSE_VERSION} from '../src/mainboard-universe.mjs';
const NOW=Date.parse('2026-09-29T18:00:00+08:00'),pool=(n=1)=>({manifest_hash:'a'.repeat(64),items:Array.from({length:n},(_,i)=>({symbol:'sh'+(600000+i),name:'合成股票'+i}))});
function sample(symbol,series,now=NOW){const dates=series.interval==='1d'?['2026-09-24','2026-09-28','2026-09-29']:series.interval==='1w'?['2026-09-24','2026-09-29']:['2026-08-31','2026-09-29'];return {symbol,source:'tencent',interval:series.interval,adjustment:series.adjustment,cache:{used:false},fetched_at:new Date(now).toISOString(),bars:dates.map((date,i)=>({date,source_timestamp:date+'T15:00:00+08:00',open:100+i,high:103+i,low:99+i,close:102+i,volume_shares:10000+i*1000,amount_cny:null}))};}
function engine({store=openLocalOHLCVStore(':memory:'),loadSeries=async(s,o)=>sample(s,o),now=()=>NOW}={}){return {store,updater:createLocalOHLCVUpdater({runtime:'local',store,loadSeries,now})};}

test('preparation freezes public identity, target/calendar/series and is idempotent without loader requests',async()=>{
 let calls=0;const {store,updater}=engine({loadSeries:async()=>{calls++;throw Error('NO_REQUEST_EXPECTED');}});try{const first=await updater.prepare(pool(2)),second=await updater.prepare(pool(2));assert.equal(first.run_id,second.run_id);assert.equal(calls,0);assert.equal(first.coverage.pending,2);assert.equal(first.activated_background,false);assert.equal(first.runtime,'local');
 for(const bad of [{...pool(),owner:'private'},{...pool(),target_session:'2026-09-28'},{...pool(),items:[{symbol:'sh600000',name:'ST合成'}]},{...pool(),items:[{symbol:'sh600000',name:'合成',private_strategy:'secret'}]}])await assert.rejects(()=>updater.prepare(bad));
 assert.throws(()=>createLocalOHLCVUpdater({runtime:'cloud',store,loadSeries:async()=>{}}),/LOCAL/);
 }finally{store.close();}
});

test('one local advance publishes all four windows with forming W/M, unknown finality and no private fields',async()=>{
 const {store,updater}=engine();try{const run=await updater.prepare(pool());const result=await updater.advance(run.run_id);assert.equal(result.request_count,4);assert.equal(result.coverage.ready,1);assert.equal(result.coverage.all_ready,true);
 for(const key of ['1d:none','1w:none','1mo:none','1d:qfq']){const d=(await updater.readDataset(run.run_id,'sh600000',key)).dataset;assert.equal(d.dataset_id,run.run_id);assert.equal(d.target_session,'2026-09-29');assert.equal(d.source_finality,'unknown');assert.equal(d.point_in_time,false);assert.equal(d.bars.at(-1).calendar_completion,key.startsWith('1d:'));assert.equal(d.bars.at(-1).amount_cny,null);assert.doesNotMatch(JSON.stringify(d),/owner|api_key|watchlist|strategy|portfolio/);}
 await assert.rejects(()=>updater.readDataset(run.run_id,'sh600000','1w:qfq'),/SERIES/);
 }finally{store.close();}
});

test('limits enforce20 stocks80 source operations3 simultaneous calls and resume only remaining members',async()=>{
 let active=0,max=0,calls=0;const {store,updater}=engine({loadSeries:async(s,o)=>{active++;max=Math.max(max,active);calls++;await new Promise(r=>setTimeout(r,1));active--;return sample(s,o);}});
 try{const run=await updater.prepare(pool(21)),one=await updater.advance(run.run_id);assert.equal(one.request_count,80);assert.equal(one.coverage.ready,20);assert.equal(one.coverage.pending,1);assert.ok(max<=3);const two=await updater.advance(run.run_id);assert.equal(two.request_count,4);assert.equal(two.coverage.ready,21);assert.equal(calls,84);assert.equal((await updater.advance(run.run_id)).request_count,0);}finally{store.close();}
});

test('a failed retry preserves previous good windows and requests only missing series',async()=>{
 let fail=true,calls=0;const {store,updater}=engine({loadSeries:async(s,o)=>{calls++;if(o.interval==='1w'&&fail)throw Error('PRIVATE_UPSTREAM_BODY_MUST_NOT_LEAK');return sample(s,o);}});
 try{const run=await updater.prepare(pool());assert.equal((await updater.advance(run.run_id)).coverage.partial,1);const old=await store.read(run.run_id,{symbols:['sh600000']});assert.equal(Object.keys(old.datasets.sh600000).length,3);assert.equal((await updater.readDataset(run.run_id,'sh600000','1d:qfq')).available,false);
 assert.equal((await updater.advance(run.run_id,{retry_failed:true})).coverage.partial,1);assert.equal(Object.keys((await store.read(run.run_id,{symbols:['sh600000']})).datasets.sh600000).length,3);assert.equal(calls,5);fail=false;const resumed=await updater.advance(run.run_id,{retry_failed:true});assert.equal(resumed.coverage.ready,1);assert.equal(resumed.request_count,1);assert.doesNotMatch(JSON.stringify(await store.read(run.run_id,{symbols:['sh600000']})),/PRIVATE_UPSTREAM_BODY/);
 }finally{store.close();}
});

test('stale source, wrong basis, future/duplicate dates and invented amounts cannot publish ready',async()=>{
 const manifest=await createOHLCVManifest(pool(),{now:NOW}),series=OHLCV_POLICY.series[0],item=manifest.items[0],base=sample(item.symbol,series);
 const check=d=>validateOHLCVSeries(d,item,series,manifest,{started_at:NOW,fetched_at:NOW});
 const stale={...base,bars:base.bars.slice(0,-1)};assert.equal((await check(stale)).status,'pending_source');
 for(const d of [{...base,source:'sina'},{...base,adjustment:'qfq'},{...base,cache:{used:true}},{...base,bars:[...base.bars,base.bars[0]]},{...base,bars:[{...base.bars[0],amount_cny:1}]},{...base,bars:[{...base.bars[0],date:'2026-09-30'}]}])assert.equal((await check(d)).status,'failed_without_data');
 const result=await check({...base,owner:'PRIVATE_OWNER',key:'PRIVATE_KEY',bars:base.bars.map(b=>({...b,private_strategy:'PRIVATE_STRATEGY'}))});assert.equal(result.status,'ready');assert.doesNotMatch(JSON.stringify(result.dataset),/PRIVATE_OWNER|PRIVATE_KEY|PRIVATE_STRATEGY/);
});

test('pause invalidates an in-flight fence; concurrent advance never duplicates pending requests',async()=>{
 let finish,started=false;const gate=new Promise(r=>finish=r);const {store,updater}=engine({loadSeries:async(s,o)=>{started=true;await gate;return sample(s,o);}});
 try{const run=await updater.prepare(pool());const first=updater.advance(run.run_id);while(!started)await new Promise(r=>setTimeout(r,1));const other=await updater.advance(run.run_id);assert.equal(other.reason,'lease_busy');assert.equal(other.request_count,0);await updater.pause(run.run_id);finish();const stopped=await first;assert.equal(stopped.coverage.pending,1);assert.equal(stopped.paused,true);assert.equal((await updater.advance(run.run_id)).reason,'paused');await updater.pause(run.run_id,false);assert.equal((await updater.advance(run.run_id)).coverage.ready,1);}finally{store.close();}
});

test('lost/expired writer cannot overwrite replacement, and same-item commit is atomic',async()=>{
 const store=openLocalOHLCVStore(':memory:');try{const manifest=await createOHLCVManifest(pool(),{now:NOW});await store.prepare(manifest);const a=await store.acquire(manifest.run_id,NOW,NOW+10);assert.equal(await store.acquire(manifest.run_id,NOW,NOW+20),null);const b=await store.acquire(manifest.run_id,NOW+11,NOW+100);const entry={symbol:'sh600000',state:'ready',series:[]};assert.equal(await store.commit(manifest.run_id,a,'sh600000',entry,{old:true},NOW+12),false);assert.equal(await store.commit(manifest.run_id,b,'sh600000',entry,{new:true},NOW+12),true);await store.release(manifest.run_id,a);assert.equal(await store.acquire(manifest.run_id,NOW+13,NOW+200),null);assert.deepEqual((await store.read(manifest.run_id,{symbols:['sh600000']})).datasets.sh600000,{new:true});}finally{store.close();}
});

test('local SQLite restart preserves checkpoint; changed target requires a new generation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ohlcv-synthetic-')),path=join(dir,'synthetic.sqlite');let store=openLocalOHLCVStore(path),clock=NOW;try{let {updater}=engine({store,now:()=>clock});const run=await updater.prepare(pool());await updater.advance(run.run_id);store.close();store=openLocalOHLCVStore(path);updater=engine({store,now:()=>clock}).updater;assert.equal((await updater.status(run.run_id)).coverage.ready,1);clock=Date.parse('2026-09-30T18:00:00+08:00');assert.equal((await updater.advance(run.run_id)).reason,'new_target_session_required');const next=await updater.prepare(pool());assert.notEqual(next.run_id,run.run_id);assert.equal(next.coverage.pending,1);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('deadline leaves attempted partial and untouched pending; no false full-market success',async()=>{
 let clock=NOW;const {store,updater}=engine({now:()=>clock,loadSeries:async(s,o)=>{clock+=25000;return sample(s,o,clock);}});try{const run=await updater.prepare(pool(5)),result=await updater.advance(run.run_id);assert.equal(result.reason,'bounded_advance_stopped');assert.equal(result.request_count,1);assert.equal(result.coverage.partial,1);assert.equal(result.coverage.pending,4);assert.equal(result.coverage.all_ready,false);assert.equal(result.coverage.eligible,result.coverage.ready+result.coverage.partial+result.coverage.pending_source+result.coverage.failed_without_data+result.coverage.pending);}finally{store.close();}
});

test('ledger rejects forged outcomes and sample fixture is explicitly synthetic',async()=>{
 const manifest=await createOHLCVManifest(pool(),{now:NOW});for(const entries of [[{symbol:'sh600999',state:'ready'}],[{symbol:'sh600000',state:'match'}],[{symbol:'sh600000',state:'ready'},{symbol:'sh600000',state:'ready'}]])assert.throws(()=>OHLCVCoverage(manifest,entries));
 const file=JSON.parse(readFileSync(new URL('./fixtures/local-ohlcv-synthetic.json',import.meta.url),'utf8'));assert.equal(file.synthetic,true);assert.deepEqual(Object.keys(file.series).sort(),['1d:none','1d:qfq','1mo:none','1w:none']);
});

async function curatedPool(){
 const identities=[['600000','合成股票0'],['600001','合成股票1'],['600002','*ST合成排除']].map(([ticker,name])=>classifyMainboardItem({symbol:'sh'+ticker,ticker,thscode:ticker+'.SH',market:'SH',name,asset_type:'a-share',market_data_supported:true,list_date:'2000-01-01',end_date:null,last_trade_date:null,last_delivery_date:null}));
 const manifest={version:PUBLIC_MAINBOARD_UNIVERSE_VERSION,source:'sse_szse_public',items:identities},manifest_hash=await hashMainboardManifest(manifest);
 const directory={available:true,data_status:'ready',read_only:true,source:'sse_szse_public',manifest_hash,manifest};
 const items=pool(2).items,input={items,manifest_hash,directory_identity_hash:manifest_hash,curated_universe:{kind:'industry_leaders',version:'synthetic-pool-v1',pool_hash:await hashOHLCVPool(items),evidence_revision:'synthetic-evidence-v1',status:'reviewed'}};
 return {input,directory};
}

test('curated pool freezes local identity separately from directory size without inferring leader evidence',async()=>{
 let calls=0;const {store,updater}=engine({loadSeries:async()=>{calls++;throw Error('NO_REQUEST_EXPECTED');}});try{const {input,directory}=await curatedPool(),first=await updater.prepare(input,{directory}),second=await updater.prepare({...input,items:[...input.items].reverse()},{directory});assert.equal(first.run_id,second.run_id);assert.equal(first.coverage.eligible,2);assert.equal(first.coverage.pending,2);assert.equal(first.universe.directory_identity.provider_rows,3);assert.equal(first.universe.directory_identity.eligible_mainboard_non_st,2);assert.equal(first.universe.directory_identity.selected_identity_matches,2);assert.equal(first.universe.directory_identity.leader_evidence_verified_by_updater,false);assert.equal(first.universe.curated_universe.status,'reviewed');assert.equal(calls,0);
 const one={...input,items:input.items.slice(0,1),curated_universe:{...input.curated_universe,pool_hash:await hashOHLCVPool(input.items.slice(0,1))}},smaller=await updater.prepare(one,{directory});assert.equal(smaller.coverage.eligible,1);assert.equal(smaller.universe.directory_identity.eligible_mainboard_non_st,2);assert.notEqual(smaller.run_id,first.run_id);
 for(const changes of [{version:'synthetic-pool-v2'},{evidence_revision:'synthetic-evidence-v2'},{status:'candidate'}])assert.notEqual((await updater.prepare({...input,curated_universe:{...input.curated_universe,...changes}},{directory})).run_id,first.run_id);
 }finally{store.close();}
});

test('curated pool fails closed on missing directory, tampered hash, mismatched names and board/ST identities',async()=>{
 const {input,directory}=await curatedPool(),prepare=(i=input,d=directory)=>createOHLCVManifest(i,{now:NOW,directory:d});
 await assert.rejects(()=>createOHLCVManifest(input,{now:NOW}),/DIRECTORY_IDENTITY_REQUIRED/);
 for(const d of [{...directory,available:false},{...directory,read_only:false},{...directory,manifest_hash:'b'.repeat(64)},{...directory,manifest:{...directory.manifest,items:directory.manifest.items.slice(0,1)}}])await assert.rejects(()=>prepare(input,d),/DIRECTORY_IDENTITY_INVALID/);
 const mismatch={...input,items:[{symbol:'sh600000',name:'另一个合成名字'}]};mismatch.curated_universe={...input.curated_universe,pool_hash:await hashOHLCVPool(mismatch.items)};await assert.rejects(()=>prepare(mismatch),/CURATED_MEMBER_IDENTITY_MISMATCH/);
 const outside={...input,items:[{symbol:'sh600099',name:'合成股票99'}]};outside.curated_universe={...input.curated_universe,pool_hash:await hashOHLCVPool(outside.items)};await assert.rejects(()=>prepare(outside),/CURATED_MEMBER_IDENTITY_MISMATCH/);
 for(const items of [[{symbol:'sh600002',name:'*ＳＴ合成排除'}],[{symbol:'sh688000',name:'合成其他板'}],[{symbol:'sz000000',name:'合成无效代码'}],[input.items[0],input.items[0]]])await assert.rejects(()=>prepare({...input,items}),/PUBLIC_MAINBOARD_ITEM/);
 const forged=structuredClone(directory);forged.manifest.items[0].classification='excluded_st_name';forged.manifest_hash=await hashMainboardManifest(forged.manifest);await assert.rejects(()=>prepare({...input,manifest_hash:forged.manifest_hash,directory_identity_hash:forged.manifest_hash},forged),/DIRECTORY_IDENTITY_INVALID/);
});

test('curated metadata is allowlisted and JSON-only; private attributes and getters are rejected without execution',async()=>{
 const {input,directory}=await curatedPool();let reads=0;const getter={...input};Object.defineProperty(getter,'items',{enumerable:true,get(){reads++;throw Error('PRIVATE_GETTER');}});
 const inherited=Object.create(input),array=[...input.items];Object.defineProperty(array,'0',{get(){reads++;throw Error('PRIVATE_ARRAY_GETTER');}});const extra=[...input.items];extra.private_strategy='PRIVATE_ARRAY_PROPERTY';
 for(const bad of [getter,inherited,{...input,items:array},{...input,items:new Array(1)},{...input,items:extra},{...input,curated_universe:{...input.curated_universe,private_strategy:'PRIVATE_VALUE'}},{...input,curated_universe:{...input.curated_universe,status:'waiting_user_approval'}},{...input,curated_universe:{...input.curated_universe,pool_hash:'b'.repeat(64)}},{...input,directory_identity_hash:'b'.repeat(64)}])await assert.rejects(()=>createOHLCVManifest(bad,{now:NOW,directory}));
 assert.equal(reads,0);assert.equal((await createOHLCVManifest(pool(),{now:NOW})).curated_universe,undefined);
});

test('Node portable manifest and pool hashing reject proxies with zero trap calls',async()=>{
 const {input,directory}=await curatedPool();let traps=0;const proxy=x=>new Proxy(x,{get(){traps++;throw Error('PROXY_GET');},getPrototypeOf(){traps++;throw Error('PROXY_PROTO');},ownKeys(){traps++;throw Error('PROXY_KEYS');},getOwnPropertyDescriptor(){traps++;throw Error('PROXY_DESCRIPTOR');}});
 for(const bad of [proxy(input),{...input,items:proxy(input.items)},{...input,items:[proxy(input.items[0])]},{...input,curated_universe:proxy(input.curated_universe)}])await assert.rejects(()=>createOHLCVManifest(bad,{now:NOW,directory}),/JSON_REQUIRED/);
 await assert.rejects(()=>createOHLCVManifest(input,{now:NOW,directory:proxy(directory)}),/JSON_REQUIRED/);await assert.rejects(()=>hashOHLCVPool(proxy(input.items)),/JSON_REQUIRED/);assert.equal(traps,0);
});
