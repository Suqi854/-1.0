import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import{mainboardScreenPanel,mainboardScreenScript}from'../src/mainboard-screening-page.mjs';
import{SWING_DEFAULTS}from'../src/swing-screening.mjs';
const stamp='2026-09-30T06:00:00.000Z';
const names=Array.from({length:41},(_,i)=>({symbol:'sh'+(600000+i),name:'fixture'+i}));
const manifest=(items=names)=>({available:true,scope:'sh_sz_mainboard_excluding_st_names',items,manifest_hash:'a'.repeat(64),snapshot_timestamp:Date.parse(stamp),source:'sse_szse_public',credential_required:false,credential_reads:false,source_timestamp:null,snapshot_timestamp_semantics:'local_combined_directory_receipt_identifier_not_membership_effective_time',fetched_at:stamp,universe_version:'mainboard-public-directory-v1',sources:[{id:'sse_public_mainboard',source_effective_date:null},{id:'szse_public_mainboard',source_effective_date:'2026-09-30'}],expected_session_date:'2026-09-30',rules:{version:'swing-daily-v1',thresholds:{...SWING_DEFAULTS}},coverage:{provider_rows:items.length+3,eligible_mainboard_non_st:items.length,excluded_st_name:1,excluded_other_boards:1,unclassified:0,unsupported:1,complete_exchange_universe:false}});
const row=(symbol,status='match')=>({symbol,status,phase:'continuation',risk_flags:['OVEREXTENDED_MA20'],reason_codes:[],sample:{last_date:'2026-09-30',used_count:65},freshness:{expected_session_date:'2026-09-30'},provenance:{source:'tencent',adjustment:'qfq',source_timestamp:stamp,fetched_at:stamp},metrics:{close:30,ma20:20,ma60:18,prior_high20:29,volume_shares:1000,prior_mean_volume20:900,volume_ratio20:1.1,return_5d_pct:5,extension_ma20_pct:15},checks:{emerging:{matched:false,conditions:{above_ma20:true,ma20_rising:true,breakout_prior20:false,breakout_volume:true}},continuation:{matched:true,conditions:{above_ma20:true,ma20_rising:true,ma_alignment:true,ma60_rising:true,near_prior20_high:true,continuation_volume:true}}}});
function batch(args,results=args.symbols.map(s=>row(s))){return{universe:{kind:'explicit',returned:results.length},results,rules:{version:'swing-daily-v1',thresholds:{...SWING_DEFAULTS}}};}
function browser(handler,{confirm=true}={}){
 const els={},events={},documentEvents={},calls=[];let confirmation=0;
 for(const match of mainboardScreenPanel.matchAll(/id="([^"]+)"/g))els[match[1]]={value:'',hidden:false,disabled:false,innerHTML:'',textContent:'',className:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this[k]=fn;}};
 const el=id=>els['mainboard-screen-'+id];el('filter').value='match';
 const sandbox={document:{hidden:false,getElementById:id=>els[id],addEventListener(k,fn){documentEvents[k]=fn;}},window:{confirm(){confirmation++;return confirm;},addEventListener(k,fn){events[k]=fn;}},api:async(name,args)=>{calls.push({name,args});return{d:await handler(name,args,calls.length)};},esc:v=>String(v??'').replaceAll('<','&lt;'),fmt:v=>typeof v==='number'?String(v):'—',Map,Set};
 vm.runInNewContext(mainboardScreenScript,sandbox);
 return{el,calls,events,documentEvents,sandbox,get confirmation(){return confirmation;},start:()=>el('start').click(),ready:()=>new Promise(r=>setImmediate(r)),eval:s=>vm.runInNewContext(s,sandbox)};
}
test('mainboard UI requests only on explicit start, then sequential max20 fixed defaults; every code accounted once',async()=>{
 const ui=browser((name,args)=>name==='get_mainboard_universe'?manifest():batch(args));assert.equal(ui.calls.length,0);await ui.start();
 assert.equal(ui.calls.length,4);assert.deepEqual(ui.calls.slice(1).map(c=>c.args.symbols.length),[20,20,1]);assert.equal(new Set(ui.calls.slice(1).flatMap(c=>c.args.symbols)).size,41);
 assert.match(ui.el('evidence').textContent,/名单 41.*匹配 41.*失败 0.*待执行 0/);assert.match(ui.el('status').textContent,/全部处理/);assert.match(ui.el('manifest').textContent,/来源记录 44.*ST 名称排除 1.*历史成员与原子快照未认证/);assert.match(ui.el('results').innerHTML,/过热提示/);
});
test('pause waits for active batch, view-independent state stays, resume processes pending without duplicates',async()=>{
 let release;const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():ui.calls.length===2?new Promise(r=>release=()=>r(batch(a))):batch(a));const p=ui.start();await ui.ready();ui.el('pause').click();assert.equal(ui.calls.length,2);release();await p;
 assert.match(ui.el('evidence').textContent,/匹配 20.*待执行 21/);assert.equal(ui.el('resume').disabled,false);await ui.el('resume').click();assert.match(ui.el('evidence').textContent,/匹配 41.*待执行 0/);assert.equal(ui.calls.length,4);
});
test('one full batch failure is not zero matches or per-symbol not-match; resume and retry are separate manual actions',async()=>{
 let fail=true;const ui=browser((n,a)=>{if(n==='get_mainboard_universe')return manifest();if(fail)throw Error('fixture');return batch(a);});await ui.start();assert.equal(ui.calls.length,2);assert.match(ui.el('evidence').textContent,/匹配 0.*失败 20.*待执行 21/);assert.match(ui.el('status').textContent,/已暂停/);fail=false;await ui.el('resume').click();assert.match(ui.el('evidence').textContent,/匹配 21.*失败 20.*待执行 0/);await ui.el('retry').click();assert.match(ui.el('evidence').textContent,/匹配 41.*失败 0.*待执行 0/);
});
test('malformed duplicate/missing/out-of-pool batch rows reject whole batch and keep coverage partition',async()=>{
 for(const mutate of [d=>({...d,results:d.results.slice(1)}),d=>({...d,results:d.results.map(()=>d.results[0])}),d=>({...d,results:d.results.map((r,i)=>i? r:{...r,symbol:'sz000001'})})]){
  const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():mutate(batch(a)));await ui.start();assert.match(ui.el('evidence').textContent,/失败 20.*待执行 21/);assert.equal(ui.calls.length,2);
 }
});
test('cutoff or parameter version changes lock old generation from retry/continue; new run is explicit and confirmed',async()=>{
 for(const mutate of [d=>({...d,results:d.results.map(r=>({...r,freshness:{expected_session_date:'2026-10-08'}}))}),d=>({...d,rules:{...d.rules,thresholds:{...SWING_DEFAULTS,breakout_volume_ratio:2}}})]){
  const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():mutate(batch(a)));await ui.start();assert.match(ui.el('status').textContent,/截止日或参数版本/);assert.equal(ui.el('resume').disabled,true);assert.equal(ui.el('retry').disabled,true);await ui.el('resume').click();await ui.el('retry').click();assert.equal(ui.calls.length,2);
 }
});
test('unknown rules.version is a generation change, not a recoverable malformed batch',async()=>{
 const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():{...batch(a),rules:{...batch(a).rules,version:'new-rules'}});await ui.start();assert.equal(ui.el('resume').disabled,true);assert.equal(ui.el('retry').disabled,true);
});
test('per-symbol source insufficiency including null cutoff counts as insufficiency while valid risk-flag match remains match',async()=>{
 const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest(names.slice(0,2)):batch(a,[{symbol:a.symbols[0],status:'insufficient_data',phase:null,metrics:null,checks:null,sample:null,provenance:null,risk_flags:[],reason_codes:['SOURCE_UNAVAILABLE'],freshness:{expected_session_date:null}},row(a.symbols[1])]));await ui.start();assert.match(ui.el('evidence').textContent,/匹配 1.*不足 1.*失败 0.*待执行 0/);ui.el('filter').value='risk';ui.el('filter').change();assert.match(ui.el('result-count').textContent,/1 只/);assert.match(ui.el('results').innerHTML,/过热提示/);
});
test('unavailable/malformed directory does not screen or manufacture 0 eligible; impossible scope/CDR/ST entries rejected',async()=>{
 const invalids=[{available:false,data_status:'not_configured'},{...manifest(),coverage:{...manifest().coverage,provider_rows:1}},manifest([{symbol:'sz001099',name:'CDR'}]),manifest([{symbol:'sh600000',name:'＊ＳＴ证券'}]),{...manifest(),expected_session_date:null}];
 for(const value of invalids){const ui=browser(()=>value);await ui.start();assert.equal(ui.calls.length,1);assert.equal(ui.el('ledger').innerHTML,'');assert.equal(ui.el('resume').disabled,true);assert.match(ui.el('status').textContent,/未|尚未/);}
});
test('hidden page pauses after active response; pageshow and page-view navigation never restart automatically',async()=>{
 let release;const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():new Promise(r=>release=()=>r(batch(a))));const p=ui.start();await ui.ready();ui.sandbox.document.hidden=true;ui.documentEvents.visibilitychange();release();await p;assert.equal(ui.calls.length,2);assert.match(ui.el('evidence').textContent,/待执行 21/);ui.events.pageshow();assert.equal(ui.calls.length,2);
});
test('busy start/resume/retry single flight and pagehide prevents late old batch insertion',async()=>{
 let release;const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest():new Promise(r=>release=()=>r(batch(a))));const p=ui.start();await ui.ready();await ui.start();await ui.el('resume').click();await ui.el('retry').click();assert.equal(ui.calls.length,2);ui.events.pagehide();release();await p;assert.match(ui.el('evidence').textContent,/匹配 0.*待执行 41/);assert.equal(ui.el('start').disabled,true);ui.events.pageshow();assert.equal(ui.el('resume').disabled,false);
});
test('new run cancellation preserves old results, rows escape source names and UI declares page/scope/research limits',async()=>{
 const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest([{symbol:'sh600000',name:'<img onerror=bad>'}]):batch(a),{confirm:false});await ui.start();const evidence=ui.el('evidence').textContent;await ui.start();assert.equal(ui.confirmation,1);assert.equal(ui.calls.length,2);assert.equal(ui.el('evidence').textContent,evidence);assert.ok(!ui.el('results').innerHTML.includes('<img'));
 for(const pattern of [/关闭网页不会继续/,/网页隐藏时暂停/,/切换工作视图会继续本次运行并保留进度/,/官方风险警示状态/,/不取消规则匹配/,/前复权价不是可直接下单/,/未匹配不等于没有机会/])assert.match(mainboardScreenPanel,pattern);
 assert.doesNotMatch(mainboardScreenScript,/get_diagnostics|cloud-bridge|setInterval|fetch\(|localStorage|sessionStorage|eval\(/);
});

test('malformed row shape never enters ledger or throws during render, allowing manual failure recovery',async()=>{
 const mutate=[r=>({symbol:r.symbol,status:'match'}),r=>({...r,risk_flags:'OVEREXTENDED_MA20'}),r=>({...r,reason_codes:'SOURCE_UNAVAILABLE'}),r=>({...r,provenance:null}),r=>({...r,freshness:{expected_session_date:null}}),r=>({...r,sample:{...r.sample,used_count:64}}),r=>({...r,metrics:{...r.metrics,ma20:null}}),r=>({...r,checks:{...r.checks,continuation:{matched:true,conditions:{}}}})];
 for(const fn of mutate){const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest(names.slice(0,1)):batch(a,[fn(row(a.symbols[0]))]));await ui.start();assert.match(ui.el('evidence').textContent,/匹配 0.*失败 1/);assert.equal(ui.el('start').disabled,false);assert.equal(ui.el('retry').disabled,false);assert.match(ui.el('status').textContent,/已暂停/);}
});

test('BFCache-like hide/show retains physical single-flight until old batch/directory settles',async()=>{
 for(const stage of ['directory','batch']){let release,active=0,max=0;const ui=browser(async(n,a)=>{if((stage==='directory'&&n==='get_mainboard_universe')||(stage==='batch'&&n==='get_swing_screen')){active++;max=Math.max(max,active);const d=await new Promise(r=>release=()=>r(n==='get_mainboard_universe'?manifest():batch(a)));active--;return d;}return manifest();});
 const p=ui.start();await ui.ready();const before=ui.calls.length;ui.events.pagehide();ui.events.pageshow();assert.equal(ui.el('start').disabled,true);assert.equal(ui.el('resume').disabled,true);await ui.start();await ui.el('resume').click();assert.equal(ui.calls.length,before);release();await p;assert.equal(max,1);assert.equal(ui.el('start').disabled,false);if(stage==='batch')assert.equal(ui.el('resume').disabled,false);}
});

test('insufficient-data malformed sample/provenance cannot inject HTML or silently count as a result',async()=>{
 for(const extra of [{sample:{used_count:'<img src=x onerror=bad>',last_date:null}},{provenance:{source:{},adjustment:null,fetched_at:null,source_timestamp:null}},{phase:'continuation'},{metrics:{close:1}}]){const ui=browser((n,a)=>n==='get_mainboard_universe'?manifest(names.slice(0,1)):batch(a,[{symbol:a.symbols[0],status:'insufficient_data',phase:null,metrics:null,checks:null,sample:null,provenance:null,risk_flags:[],reason_codes:['SOURCE_UNAVAILABLE'],freshness:{expected_session_date:null},...extra}]));await ui.start();assert.match(ui.el('evidence').textContent,/不足 0.*失败 1/);assert.ok(!ui.el('results').innerHTML.includes('<img'));}
});

test('active UI rejects obsolete credential-bearing HiThink universe and explicitly explains public no-key source/cached fallback',async()=>{
 for(const extra of [{source:'hithink'},{credential_required:true},{credential_reads:true},{source_timestamp:stamp},{snapshot_timestamp_semantics:'upstream_code_table_snapshot_load_time'}]){const ui=browser(()=>({...manifest(),...extra}));await ui.start();assert.equal(ui.calls.length,1);assert.equal(ui.el('ledger').innerHTML,'');}
 const ui=browser((n,a)=>n==='get_mainboard_universe'?{...manifest(names.slice(0,1)),cache:{used:true,kind:'stale_fallback'}}:batch(a));await ui.start();assert.match(ui.el('manifest').textContent,/上交所目录日期 未提供.*深交所目录日期 2026-09-30/);assert.match(ui.el('manifest').textContent,/刷新失败，非最新/);assert.match(mainboardScreenPanel,/无需个人 key/);
});
