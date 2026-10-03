import test from 'node:test';
import assert from 'node:assert/strict';
import { screen, validateRule, validateSnapshot, LIMITS, swingPreset } from '../src/index.js';
import { createMockSnapshot } from '../src/mock.js';
const clone = x => structuredClone(x);
const condition = (left = {kind:'field',field:'close'}, op = 'gt', right = {kind:'constant',value:0}, timeframe = 'D', id='c1') => ({type:'condition',id,timeframe,left,op,right});
const rule = root => ({version:1,root});
const single = (s,r=rule(condition())) => screen(s,r,{symbols:['SH600001']}).rows[0];
const reasons = row => row.reasons ?? row.tree?.reasons ?? [];
function realIdentity(s) { s.synthetic=false; s.generation='local-ohlcv-'+ 'a'.repeat(64); s.calendarVersion='exchange-announced-2026-v1';s.policyVersion='local-ohlcv-v1';for(const st of s.stocks) for(const f of Object.values(st.series??{})) {f.datasetId=s.generation;f.calendarVersion=s.calendarVersion;f.policyVersion=s.policyVersion;for(const b of f.bars)b.completionBasis='verified_calendar_schedule_with_conservative_buffer';} return s; }
function syncCoverage(frame){frame.coverage.returned=frame.bars.length;frame.coverage.first_date=frame.bars[0].date;frame.coverage.last_date=frame.bars.at(-1).date;}
function manual(prices, volumes=prices.map(()=>100)) {
  const s=createMockSnapshot();const frame=s.stocks[0].series.D;
  frame.bars=frame.bars.slice(-prices.length).map((b,i)=>({...b,open:prices[i],high:prices[i]+1,low:prices[i]-1,close:prices[i],volume_shares:volumes[i]}));syncCoverage(frame);return s;
}
test('合成波段样例的五态与目录完整对账',()=>{
  const s=createMockSnapshot(),r=screen(s,swingPreset);
  assert.equal(r.status,'completed');assert.equal(r.synthetic,true);
  assert.deepEqual(r.counts,{total:8,processed:8,successful:2,match:1,no_match:1,failure:1,insufficient:5,unprocessed:0});
  assert.equal(r.directory.catalogTotal,r.excluded.length+r.restrictionExcluded.length+r.counts.total);
  assert.equal(r.counts.total,r.counts.successful+r.counts.failure+r.counts.insufficient+r.counts.unprocessed);
});
test('预算明确列出所有未处理股票',()=>{
  const r=screen(createMockSnapshot(),swingPreset,{maxProcessed:2});assert.equal(r.counts.unprocessed,6);assert.equal(r.counts.processed,2);
  assert.ok(r.rows.slice(2).every(x=>x.state==='unprocessed'));
});
test('目录拒绝不重试不假装全池为0',()=>{
  const s=createMockSnapshot();s.directory={status:'unavailable',universe:'CN_MAINBOARD_NON_ST',errorCode:'PUBLIC_DIRECTORY_HTTP_403'};
  const r=screen(s,swingPreset);assert.equal(r.status,'blocked');assert.equal(r.counts,null);assert.equal(r.coverageKnown,false);assert.equal(r.errors[0].code,'PUBLIC_DIRECTORY_HTTP_403');assert.deepEqual(r.rows,[]);
});
test('限制不能扩大固定池；不存在代码可审计',()=>{
  const r=screen(createMockSnapshot(),swingPreset,{symbols:['SH600001','SH600005','SZ300001','SH601999']});
  assert.deepEqual(r.rows.map(x=>x.symbol),['SH600001']);assert.deepEqual(r.requestedOutsideCatalog,['SH601999']);assert.equal(r.directory.restrictionExcludedTotal,7);
});
test('显式空限制与0预算合法',()=>{
  assert.equal(screen(createMockSnapshot(),swingPreset,{symbols:[]}).counts.total,0);
  assert.equal(screen(createMockSnapshot(),swingPreset,{maxProcessed:0}).counts.unprocessed,8);
});
test('日周月独立冻结，不要求末根日期一致',()=>{
  const s=createMockSnapshot();const r=single(s,rule({type:'group',op:'AND',children:['D','W','M'].map((f,i)=>condition(undefined,undefined,undefined,f,`c${i}`))}));
  assert.equal(r.state,'match');assert.deepEqual(r.tree.children.map(x=>x.actualLastDate),['2026-09-28','2026-09-25','2026-08-31']);
});
test('未完成周月默认排除；显式选用显著标记',()=>{
  const s=createMockSnapshot();let r=single(s,rule(condition(undefined,undefined,undefined,'M')));assert.equal(r.tree.partialUsed,false);assert.equal(r.tree.actualLastDate,'2026-08-31');
  s.frames.M.mode='include_partial';s.frames.M.expectedLastDate='2026-09-28';r=single(s,rule(condition(undefined,undefined,undefined,'M')));assert.equal(r.state,'match');assert.equal(r.tree.partialUsed,true);assert.equal(r.tree.left.sample.containsPartial,true);
});
test('字段/MA/量均线/涨跌幅/前高/量比均用真实窗口',()=>{
  const s=manual([10,12,14],[100,200,600]);
  const value=e=>single(s,rule(condition(e))).tree.left;
  assert.equal(value({kind:'field',field:'close'}).value,14);
  assert.equal(value({kind:'ma',field:'close',window:2}).value,13);
  assert.equal(value({kind:'volume_ma',window:2}).value,400);
  assert.ok(Math.abs(value({kind:'change_pct',window:2}).value-40)<1e-10);
  const high=value({kind:'prior_high',window:2});assert.equal(high.value,13);assert.equal(high.sample.bars,2);assert.equal(high.sample.excludesCurrent,true);
  const ratio=value({kind:'volume_ratio',window:2});assert.equal(ratio.value,4);assert.equal(ratio.sample.bars,3);assert.equal(ratio.sample.baseline.bars,2);assert.equal(ratio.sample.baseline.excludesCurrent,true);
});
test('偏移按所选已完成K索引，非日历天',()=>{
  const s=manual([10,12,14]);assert.equal(single(s,rule(condition({kind:'field',field:'close',offset:1}))).tree.left.value,12);
});
test('同周期指标与所有普通比较符',()=>{
  const s=manual([10,12,14]);
  for(const [op,value,expected] of [['gt',13,true],['gte',14,true],['lt',15,true],['lte',14,true],['eq',14,true],['neq',14,false]])assert.equal(single(s,rule(condition(undefined,op,{kind:'constant',value}))).state,expected?'match':'no_match');
  assert.equal(single(s,rule(condition(undefined,'gt',{kind:'ma',field:'close',window:3}))).state,'match');
});
test('上穿含前一根等于，下穿对称，当前等于不穿',()=>{
  const threshold={kind:'constant',value:10};
  assert.equal(single(manual([9,10,11]),rule(condition(undefined,'cross_above',threshold))).state,'match');
  assert.equal(single(manual([11,10,9]),rule(condition(undefined,'cross_below',threshold))).state,'match');
  assert.equal(single(manual([9,9,10]),rule(condition(undefined,'cross_above',threshold))).state,'no_match');
  assert.equal(single(manual([11]),rule(condition(undefined,'cross_above',threshold))).state,'insufficient');
});
test('指标交叉分别派生相邻两个完整窗口',()=>{
  const s=manual([10,8,14]);const r=single(s,rule(condition(undefined,'cross_above',{kind:'ma',field:'close',window:2})));
  assert.equal(r.state,'match');assert.equal(r.tree.previous.right.value,9);assert.equal(r.tree.right.value,11);assert.equal(r.tree.previous.right.sample.offset,1);
});
test('AND/OR嵌套无短路隐藏不足',()=>{
  const pass=condition(),fail=condition(undefined,'lt',{kind:'constant',value:0},'D','fail'),missing=condition({kind:'ma',field:'close',window:250},'gt',{kind:'constant',value:1},'D','missing');
  assert.equal(single(createMockSnapshot(),rule({type:'group',op:'OR',children:[fail,pass]})).state,'match');
  assert.equal(single(createMockSnapshot(),rule({type:'group',op:'AND',children:[pass,{type:'group',op:'OR',children:[clone(fail),condition(undefined,'gt',{kind:'constant',value:0},'D','pass2')]}]})).state,'match');
  for(const op of ['AND','OR'])assert.equal(single(createMockSnapshot(),rule({type:'group',op,children:[op==='AND'?fail:pass,missing]})).state,'insufficient');
});
test('数据失败不被OR命中掩盖',()=>{
  const s=createMockSnapshot();s.stocks[0].series.W={status:'error',errorCode:'SYNTHETIC_FAILURE'};
  const r=single(s,rule({type:'group',op:'OR',children:[condition(),condition(undefined,undefined,undefined,'W','w')]}));assert.equal(r.state,'failure');assert.equal(r.tree.children.length,2);
});
test('缺股票、缺周期、缺任何OHLCV与窗口不足均区分不符',()=>{
  let s=createMockSnapshot();s.stocks.shift();assert.equal(single(s).state,'insufficient');
  s=createMockSnapshot();delete s.stocks[0].series.D;assert.equal(single(s).tree.reasons[0].code,'MISSING_FRAME');
  for(const field of ['open','high','low','close','volume_shares']){s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1)[field]=null;assert.equal(single(s).state,'insufficient');assert.equal(single(s).tree.reasons[0].code,'MISSING_FIELD');}
  s=manual([10]);assert.equal(single(s,rule(condition({kind:'ma',field:'close',window:2}))).state,'insufficient');
});
test('旧末根、未知停牌、已停牌与旧目录分别有原因',()=>{
  let s=createMockSnapshot();s.stocks[0].series.D.bars.pop();syncCoverage(s.stocks[0].series.D);assert.equal(single(s).tree.reasons[0].code,'STALE_DATA');
  s=createMockSnapshot();s.stocks[0].suspension.state='unknown';assert.equal(reasons(single(s))[0].code,'SUSPENSION_UNKNOWN');
  s.stocks[0].suspension.state='suspended';assert.equal(reasons(single(s))[0].code,'SUSPENDED');
  s=createMockSnapshot();s.directory.asOf='2026-09-25';assert.equal(reasons(single(s))[0].code,'DIRECTORY_STALE');
  s=createMockSnapshot();s.stocks[0].suspension.verifiedThrough='2026-09-25';assert.equal(reasons(single(s))[0].code,'SUSPENSION_UNKNOWN');
});
test('2026之外完成证据不因声明complete自动可信',()=>{
  const s=realIdentity(createMockSnapshot());s.stocks[0].series.M.completionEvidence={kind:'calendar',verifiedFrom:'2020-01-01',verifiedThrough:'2027-12-31'};
  assert.equal(single(s,rule(condition({kind:'ma',field:'close',window:20},'gt',{kind:'constant',value:0},'M'))).state,'insufficient');
  s.stocks[0].series.D.completionEvidence={kind:'calendar',verifiedFrom:'2026-01-01',verifiedThrough:'2026-12-31'};assert.equal(single(s).state,'match');
});
test('synthetic证据不可用于非synthetic快照',()=>{
  const s=realIdentity(createMockSnapshot());assert.equal(single(s).tree.reasons[0].code,'COMPLETION_UNKNOWN');
});
test('完成状态未知、未来完成矛盾、冻结日期冲突',()=>{
  let s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1).completion='unknown';assert.equal(single(s).tree.reasons[0].code,'COMPLETION_UNKNOWN');
  s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1).periodEnd='2026-10-01';assert.equal(single(s).tree.reasons[0].code,'COMPLETION_CONTRADICTION');
  s=createMockSnapshot();s.frames.D.expectedLastDate='2026-09-25';assert.equal(single(s).tree.reasons[0].code,'FROZEN_DATE_MISMATCH');
});
test('单周期或多周期混来源/复权和错单位阻断',()=>{
  for(const key of ['sourceKey','adjustment']){const s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1)[key]='other';assert.equal(single(s).tree.reasons[0].code,'MIXED_PROVENANCE');}
  const s=createMockSnapshot();s.stocks[0].series.W.adjustment='hfq';assert.equal(reasons(single(s,rule({type:'group',op:'AND',children:[condition(),condition(undefined,undefined,undefined,'W','w')]})))[0].code,'CROSS_FRAME_BASIS_MISMATCH');
  const t=createMockSnapshot();t.stocks[0].series.D.volumeUnit='lots';assert.equal(single(t).tree.reasons[0].code,'PROVENANCE_UNITS');
});
test('无效OHLC、负量、乱序分别阻断',()=>{
  let s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1).high=1;assert.equal(single(s).state,'failure');
  s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1).volume_shares=-1;assert.equal(single(s).state,'failure');
  s=createMockSnapshot();s.stocks[0].series.D.bars.reverse();assert.equal(single(s).tree.reasons[0].code,'MALFORMED_BARS');
});
test('零量基线未定义但零量字段合法',()=>{
  const s=manual([10,11,12],[0,0,100]);assert.equal(single(s,rule(condition({kind:'volume_ratio',window:2}))).tree.reasons[0].code,'ZERO_BASELINE');assert.equal(single(s).state,'match');
});
test('禁止跨周期/复权操作数属性、禁用字段、函数和代码字符串',()=>{
  const attempts=[condition({kind:'field',field:'amount_cny'}),condition({kind:'financials'}),condition({kind:'field',field:'close',timeframe:'W'}),condition({kind:'ma',field:'close',window:20,adjustment:'hfq'}),condition({kind:'function',code:'globalThis.pwned=true'}),condition(undefined,'eval',{kind:'constant',value:1}),condition(undefined,'gt',{kind:'constant',value:'(()=>{})()'})];
  for(const c of attempts)assert.equal(validateRule(rule(c)).valid,false);assert.equal(globalThis.pwned,undefined);
  assert.equal(validateRule(rule(condition({kind:'field',field:'close'},'gt',{kind:'volume_ma',window:2}))).errors[0].code,'UNIT_MISMATCH');
});
test('规则节点、深度、窗口、偏移、重复id与阈值有界',()=>{
  for(const window of [0,-1,1.5,251,Infinity])assert.equal(validateRule(rule(condition({kind:'ma',field:'close',window}))).valid,false);
  assert.equal(validateRule(rule(condition({kind:'field',field:'close',offset:251}))).valid,false);
  assert.equal(validateRule(rule(condition(undefined,'gt',{kind:'constant',value:NaN}))).valid,false);
  assert.equal(validateRule(rule({type:'group',op:'AND',children:[condition(),condition()]})).valid,false);
  let n=condition();for(let i=0;i<7;i++)n={type:'group',op:'AND',children:[n]};assert.equal(validateRule(rule(n)).valid,false);
  assert.equal(validateRule(rule({type:'group',op:'AND',children:Array.from({length:101},(_,i)=>condition(undefined,undefined,undefined,'D',`c${i}`))})).valid,false);
});
test('重复目录、超界数据、非法日期与限制安全返回错误',()=>{
  let s=createMockSnapshot();s.directory.entries.push(s.directory.entries[0]);assert.equal(validateSnapshot(s).valid,false);
  s=createMockSnapshot();s.stocks[0].series.D.bars=Array(LIMITS.maxBarsPerFrame+1).fill(s.stocks[0].series.D.bars[0]);assert.equal(screen(s,swingPreset).status,'invalid');
  s=createMockSnapshot();s.directory.asOf='2026-99-99';assert.equal(screen(s,swingPreset).status,'invalid');
  assert.equal(screen(createMockSnapshot(),swingPreset,{maxProcessed:-1}).status,'invalid');assert.equal(screen(createMockSnapshot(),swingPreset,{symbols:['bad']}).status,'invalid');
});
test('输入不被引擎修改，冻结快照可调用',()=>{
  const s=createMockSnapshot(),r=clone(swingPreset);const before=JSON.stringify([s,r]);screen(s,r);assert.equal(JSON.stringify([s,r]),before);
});
test('40股共享合成窗口仅验证逻辑，不代表3052独立窗口容量',()=>{
  const s=createMockSnapshot();const template=s.stocks[0];s.directory.entries=[];s.stocks=[];
  for(let i=0;i<40;i++){const symbol=`SH${600000+i}`;s.directory.entries.push({symbol,exchange:'SH',board:'mainboard',stStatus:'non_st',name:`共享合成${i}`});s.stocks.push({...template,symbol});}
  const r=screen(s,swingPreset);assert.equal(r.counts.total,40);assert.equal(r.counts.match,40);assert.equal(r.counts.insufficient,0);assert.equal(r.synthetic,true);
});
