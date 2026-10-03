import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {swingScreenPanel,swingScreenScript} from '../src/swing-screening-page.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp='2026-09-30T08:01:00.000Z';
const row=(symbol='sh600522',overrides={})=>({symbol,name:'测试股票',status:'match',phase:'continuation',reason_codes:[],risk_flags:['OVEREXTENDED_MA20'],warnings:[],metrics:{close:24,ma20:20,ma60:18,ma20_change_5d_pct:2,prior_high20:23,volume_shares:16000,prior_mean_volume20:10000,volume_ratio20:1.6,return_5d_pct:9,extension_ma20_pct:20},checks:{emerging:{matched:true,conditions:{above_ma20:true,ma20_rising:true,breakout_prior20:true,breakout_volume:true}},continuation:{matched:true,conditions:{above_ma20:true,ma_alignment:true,ma20_rising:true,ma60_rising:true,near_prior20_high:true,continuation_volume:true}}},sample:{input_count:66,completed_count:65,used_count:65,first_date:'2026-06-25',last_date:'2026-09-29',excluded_incomplete:1,excluded_current_date:1},provenance:{source:'tencent',adjustment:'qfq',fetched_at:stamp,source_timestamp:'2026-09-29T07:00:00.000Z'},freshness:{status:'recent',expected_session_date:'2026-09-29'},...overrides});
const payload=(rows=[row()],overrides={})=>({universe:{kind:'explicit',total:rows.length,returned:rows.length,has_more:false,next_after:null,requested_count:rows.length,deduplicated_count:rows.length},as_of:stamp,rules:{defaults:{breakout_volume_ratio:1.5},thresholds:{max_extension_ma20_pct:12},formulas:{emerging:'close > MA20'}},results:rows,summary:{match:rows.length,not_match:0,insufficient_data:0},...overrides});
const original=(rows=[row()],overrides={})=>payload(rows,{universe:{kind:'original_watchlist',storage_source:'original',total:rows.length,returned:rows.length,has_more:false,next_after:null,...overrides}});
function browser(respond=async()=>payload()){
 const els={},events={},calls=[];
 for(const match of swingScreenPanel.matchAll(/id="([^"]+)"/g))els[match[1]]={value:match[1]==='swing-screen-mode'?'explicit':'',textContent:'',innerHTML:'',hidden:false,disabled:false,className:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,handler){this[key]=handler;}};
 const sandbox={document:{getElementById:id=>els[id]},window:{addEventListener(key,handler){events[key]=handler;}},esc,fmt:(value,digits=2)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—',friendly:()=> '来源暂不可用',api:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return {d:await respond(name,args,calls.length)};}};
 vm.runInNewContext(swingScreenScript,sandbox);
 const el=id=>els['swing-screen-'+id];
 return {el,events,calls,enter(value){el('symbols').value=value;el('symbols').input();},mode(value){el('mode').value=value;el('mode').change();},submit:()=>el('form').submit({preventDefault(){}}),more:()=>el('more').click()};
}

test('manual panel compiles, leaves codes empty, declares original-only scope and mobile controls',()=>{
 new vm.Script(swingScreenScript);const ui=browser();assert.equal(ui.calls.length,0);assert.equal(ui.el('symbols').value,'');assert.equal(ui.el('more').hidden,true);
 assert.match(swingScreenPanel,/原站自选与云端自选独立/);assert.match(swingScreenPanel,/不扫描全市场/);assert.match(swingScreenPanel,/未经历史回测验证/);assert.match(swingScreenPanel,/停复牌/);assert.match(swingScreenPanel,/15:30:03/);assert.match(swingScreenPanel,/来源最终修订仍未知/);assert.match(swingScreenPanel,/至少需要 65 条/);assert.match(swingScreenPanel,/不会自动剔除/);
 assert.match(swingScreenPanel,/前复权研究价/);assert.match(swingScreenPanel,/幸存者偏差/);
 assert.match(swingScreenPanel,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(swingScreenPanel,/min-height:44px/);assert.match(swingScreenPanel,/aria-live="polite"/);
 assert.doesNotMatch(swingScreenScript,/setInterval|setTimeout|localStorage|sessionStorage|fetch\(|cloud-bridge|watchlist.*action/);
});

test('empty, too-large, names, unsupported codes and mixed invalid input never fetch',async()=>{
 const ui=browser();for(const value of ['',Array(21).fill('600522').join(','),'新华传媒','111111','600522,https://example.com','sh000001']){ui.enter(value);await ui.submit();assert.equal(ui.calls.length,0);assert.match(ui.el('status').className,/error/);assert.equal(ui.el('summary').textContent,'');}
 assert.match(ui.el('status').textContent,/不按名称猜代码/);
});

test('explicit separators and code forms normalize only codes and preserve duplicates for server reporting',async()=>{
 const ui=browser(async()=>payload([row('sh600522'),row('sz000001'),row('bj920002')]));ui.enter('600522，000001\nbj920002 600522.SH');await ui.submit();
 assert.deepEqual(ui.calls,[{name:'get_swing_screen',args:{universe:'explicit',symbols:['sh600522','sz000001','bj920002','sh600522']}}]);assert.match(ui.el('status').textContent,/去重后 3 只/);assert.equal(ui.el('run').disabled,false);
});

test('all outcomes remain separate and display source, completed sample, metrics, phase and risk',async()=>{
 const rows=[row('sh600522',{status:'not_match',phase:null,reason_codes:['NO_RULE_MATCH']}),row('sz000001'),row('bj920002',{status:'insufficient_data',phase:null,reason_codes:['INSUFFICIENT_COMPLETED_BARS'],metrics:{close:null,volume_ratio20:null},checks:{},risk_flags:[]})];
 const ui=browser(async()=>payload(rows));ui.enter('600522 000001 920002');await ui.submit();const html=ui.el('results').innerHTML;
 assert.match(ui.el('summary').textContent,/条件入选 1 · 未满足 1 · 数据不足 \/ 不可判定 1/);assert.ok(html.indexOf('sz000001')<html.indexOf('sh600522'));assert.match(html,/趋势延续/);assert.match(html,/偏离 MA20 较大/);assert.match(html,/来源：腾讯 · 复权：前复权（qfq）/);assert.match(html,/来源 66 条 \/ 已完成 65 条 \/ 使用 65 条/);assert.match(html,/前 20 日均量（股）/);assert.match(html,/MA60 高于 5 个交易日前 通过/);assert.match(html,/已完成日线不足 65 条/);assert.match(html,/相对前 20 日量比<\/dt><dd>—<\/dd>/);assert.doesNotMatch(html,/null|undefined|NaN/);assert.match(ui.el('rules').innerHTML,/close &gt; MA20/);
});

test('untrusted names, reasons, provenance, warnings and server formulas are HTML-escaped',async()=>{
 const attack='<img src=x onerror="alert(1)">';const ui=browser(async()=>payload([row('sh600522',{name:attack,reason_codes:[attack],warnings:[attack],risk_flags:[attack],provenance:{source:attack,adjustment:attack}})],{rules:{formulas:{emerging:attack}}}));ui.enter('600522');await ui.submit();
 for(const id of ['results','rules']){assert.doesNotMatch(ui.el(id).innerHTML,/<img/);assert.match(ui.el(id).innerHTML,/&lt;img/);}assert.doesNotMatch(ui.el('results').innerHTML,/NaN/);
});

test('duplicate submits and next-page clicks cannot duplicate an in-flight request',async()=>{
 let finish;const ui=browser(async()=>new Promise(resolve=>finish=resolve));ui.enter('600522');const first=ui.submit();assert.equal(ui.el('run').disabled,true);assert.equal(ui.el('panel').attributes['aria-busy'],'true');await ui.submit();await ui.more();assert.equal(ui.calls.length,1);finish(payload());await first;assert.equal(ui.el('run').disabled,false);assert.equal(ui.el('panel').attributes['aria-busy'],'false');
});

test('original watchlist pagination is manual, bounded, replaces only the current batch and can restart',async()=>{
 const ui=browser(async(_name,args)=>args.after?original([row('sz000001')],{total:2}):original([row()],{total:2,has_more:true,next_after:'sh600522'}));ui.mode('original_watchlist');assert.equal(ui.calls.length,0);assert.equal(ui.el('input-group').hidden,true);await ui.submit();assert.deepEqual(ui.calls[0].args,{universe:'original_watchlist'});assert.equal(ui.el('more').hidden,false);assert.match(ui.el('status').textContent,/原站自选 · 第 1 批/);
 await ui.more();assert.deepEqual(ui.calls[1].args,{universe:'original_watchlist',after:'sh600522'});assert.match(ui.el('status').textContent,/第 2 批/);assert.match(ui.el('results').innerHTML,/sz000001/);assert.doesNotMatch(ui.el('results').innerHTML,/sh600522/);assert.equal(ui.el('more').hidden,true);await ui.submit();assert.deepEqual(ui.calls[2].args,{universe:'original_watchlist'});assert.match(ui.el('status').textContent,/第 1 批/);
});

test('empty original watchlist is explicit and never falls through to another universe',async()=>{
 const ui=browser(async()=>original([]));ui.mode('original_watchlist');await ui.submit();assert.match(ui.el('status').textContent,/原站自选本批为空/);assert.equal(ui.calls.length,1);assert.equal(ui.el('results').innerHTML,'');assert.equal(ui.el('more').hidden,true);
});

test('malformed results, missing explicit results, mismatched symbols and cloud scope fail closed',async()=>{
 const invalid=[undefined,{},payload([]),payload([row('sz000001')]),payload([row('sh600522',{status:'new_state'})]),payload([row(),row()]),payload([row()],{universe:{kind:'explicit',returned:0,total:1}}),payload([row()],{universe:{kind:'explicit',returned:1,total:1,has_more:true,next_after:'sh600522'}})];
 for(const value of invalid){const ui=browser(async()=>value);ui.enter('600522');await ui.submit();assert.match(ui.el('status').textContent,/无法判定/);assert.equal(ui.el('results').innerHTML,'');assert.equal(ui.el('summary').textContent,'');assert.equal(ui.el('run').disabled,false);}
 const ui=browser(async()=>original([row()],{storage_source:'cloud'}));ui.mode('original_watchlist');await ui.submit();assert.match(ui.el('status').textContent,/无法判定/);assert.equal(ui.el('more').hidden,true);
});

test('upstream rejection shows failure without raw error text or fabricated zero counts',async()=>{
 const ui=browser(async()=>{throw Error('RAW_PRIVATE_ERROR');});ui.enter('600522');await ui.submit();assert.match(ui.el('status').textContent,/筛选失败/);assert.doesNotMatch(ui.el('status').textContent,/RAW_PRIVATE_ERROR|入选 0/);assert.equal(ui.el('summary').textContent,'');assert.equal(ui.el('run').disabled,false);
});

test('missing scheduled sessions show dates without guessing suspension or no opportunity',async()=>{
 const ui=browser(async()=>payload([row('sh600522',{status:'insufficient_data',phase:null,reason_codes:['MISSING_SCHEDULED_SESSIONS'],metrics:null,checks:null,sample:{used_count:65,missing_scheduled_dates:['2026-09-07','2026-09-08']},risk_flags:[]})]));ui.enter('600522');await ui.submit();const html=ui.el('results').innerHTML;assert.match(html,/2026-09-07、2026-09-08/);assert.match(html,/缺失原因未核验，可能是停牌或来源缺口，不推断为无机会/);assert.match(html,/数据不足，无法评估风险标记/);assert.doesNotMatch(html,/undefined|null/);
});

test('known freshness and provider warnings are readable while unknown warnings remain inspectable',async()=>{
 const ui=browser(async()=>payload([row('sh600522',{freshness:{status:'latest_completed_adjusted_session',expected_session_date:'2026-09-29'},warnings:['QFQ_HISTORY_CAN_BE_REVISED; not point-in-time history or a profitability backtest','FUTURE_UNKNOWN_CODE']})]));ui.enter('600522');await ui.submit();const html=ui.el('results').innerHTML;assert.match(html,/最新已完成前复权交易日/);assert.match(html,/前复权历史可修订，不是当时可得历史或收益回测/);assert.match(html,/FUTURE_UNKNOWN_CODE/);assert.match(html,/条件明细见下方/);assert.match(html,/来源日线标签时间/);
});

test('input edits invalidate pending responses and permit a newer manual request',async()=>{
 let finish;const ui=browser(async(_name,args,n)=>n===1?await new Promise(resolve=>finish=resolve):payload([row(args.symbols[0])]));ui.enter('600522');const old=ui.submit();ui.enter('000001');assert.equal(ui.el('run').disabled,false);await ui.submit();finish(payload());await old;assert.match(ui.el('results').innerHTML,/sz000001/);assert.doesNotMatch(ui.el('results').innerHTML,/sh600522/);assert.equal(ui.el('run').disabled,false);
});

test('mode changes invalidate pending results, cursor and old failures',async()=>{
 let reject;const ui=browser(async()=>new Promise((_resolve,fail)=>reject=fail));ui.enter('600522');const old=ui.submit();ui.mode('original_watchlist');reject(Error('old'));await old;assert.equal(ui.el('results').innerHTML,'');assert.match(ui.el('status').textContent,/范围已变更/);assert.doesNotMatch(ui.el('status').className,/error/);assert.equal(ui.el('more').hidden,true);assert.equal(ui.calls.length,1);
});

test('pagehide invalidates pending results and pageshow never refreshes automatically',async()=>{
 let finish;const ui=browser(async()=>new Promise(resolve=>finish=resolve));ui.enter('600522');const old=ui.submit();ui.events.pagehide();assert.equal(ui.el('run').disabled,true);finish(payload());await old;assert.equal(ui.el('results').innerHTML,'');assert.match(ui.el('status').textContent,/页面已离开/);await ui.submit();assert.equal(ui.calls.length,1);ui.events.pageshow();assert.equal(ui.el('run').disabled,false);assert.equal(ui.calls.length,1);
});

test('failed next batch remains retryable and repeated or empty cursors are rejected',async()=>{
 let fail=true;const ui=browser(async(_name,args)=>{if(args.after&&fail){fail=false;throw Error('timeout');}return args.after?original([row('sz000001')],{total:2}):original([row()],{total:2,has_more:true,next_after:'sh600522'});});ui.mode('original_watchlist');await ui.submit();await ui.more();assert.match(ui.el('status').textContent,/筛选失败/);assert.equal(ui.el('more').hidden,false);await ui.more();assert.match(ui.el('status').textContent,/第 2 批/);
 for(const next_after of ['','unknown','sh600522']){const bad=browser(async(_name,args)=>original([row()],{total:2,has_more:true,next_after:args.after?next_after:'sh600522'}));bad.mode('original_watchlist');await bad.submit();await bad.more();assert.match(bad.el('status').textContent,/无法判定/);}
});
