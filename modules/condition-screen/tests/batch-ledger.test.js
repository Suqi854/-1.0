import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScreenLedger,screen,PORTABLE_KEYS,LIMITS} from '../src/index.js';
import {createSyntheticBatchDemo} from '../src/mock-batches.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/local-ohlcv-synthetic.json',import.meta.url),'utf8'));
const rule={version:1,root:{type:'condition',id:'D',timeframe:'D',left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}};
function config(n=5,limits={}){return {version:1,synthetic:true,runId:fixture.run_id,targetSession:fixture.target_session,calendarVersion:'exchange-announced-2026-v1',policyVersion:'local-ohlcv-v1',manifestHash:'b'.repeat(64),directory:{status:'ready',universe:'CN_MAINBOARD_NON_ST_LEADERS',universeVersion:'synthetic-research-v1',source:'SYNTHETIC_TEST',sourceNotes:'Invented explicit symbols; no actual leader research',asOf:fixture.target_session,entries:Array.from({length:n},(_,i)=>({symbol:'SH'+String(600000+i),exchange:'SH',board:'mainboard',stStatus:'non_st',name:`合成${i}`}))},frames:{D:{cutoffDate:fixture.target_session,expectedLastDate:fixture.target_session,mode:'completed',adjustment:'none'},W:{cutoffDate:fixture.target_session,expectedLastDate:'2026-09-25',mode:'completed',adjustment:'none'},M:{cutoffDate:fixture.target_session,expectedLastDate:'2026-08-31',mode:'completed',adjustment:'none'}},rule:structuredClone(rule),limits,batchSize:2};}
function receipt(request,{dense=false}={}){
  const {symbols,seriesKeys,...meta}=request;const records=[],suspensionBySymbol={};
  for(const symbol of symbols){
    suspensionBySymbol[symbol]={state:'active',verifiedThrough:request.targetSession};
    for(const key of PORTABLE_KEYS){const d=structuredClone(fixture.series[key]);d.symbol=symbol.toLowerCase();
      if(dense){const n=key.startsWith('1d')?200:key.startsWith('1w')?104:60,tf=key.startsWith('1d')?'D':key.startsWith('1w')?'W':'M',dates=[];
        if(tf==='M'){for(let i=n-2;i>=0;i--)dates.push(new Date(Date.UTC(2026,8-i,0)).toISOString().slice(0,10));}
        else {const cursor=new Date(tf==='D'?'2026-09-29T00:00:00Z':'2026-09-25T00:00:00Z');while(dates.length<n-(tf==='D'?0:1)){if(tf==='W'||![0,6].includes(cursor.getUTCDay()))dates.unshift(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()-(tf==='W'?7:1));}}
        if(tf!=='D')dates.push(request.targetSession);
        d.bars=dates.map((date,i)=>{const partial=tf!=='D'&&i===dates.length-1,verified=date>='2026-01-01';return {date,source_timestamp:date+'T15:00:00+08:00',open:100,high:102,low:99,close:101,volume_shares:10000,amount_cny:null,complete:!partial,calendar_completion:verified?!partial:null,completion_basis:verified?'verified_calendar_schedule_with_conservative_buffer':'elapsed_period_unverified',period_end_session:partial?(tf==='W'?'2026-10-02':'2026-09-30'):date,observed_latest:null,source_finality:'unknown'};});
        d.coverage={...d.coverage,requested:n,returned:n,first_date:dates[0],last_date:dates.at(-1),calendar_unverified_rows:d.bars.filter(b=>b.calendar_completion===null).length};
      }
      records.push({symbol,key,result:{available:true,state:'ready',source_finality:'unknown',dataset:d}});
    }
  }
  return {...meta,records,suspensionBySymbol};
}
const sum=c=>c.successful+c.failure+c.insufficient+c.unprocessed;
test('一次冻结子池分母，分批恰一symbol状态，不叠加各批total；reader请求无私有规则',()=>{
  const c=config(),l=createScreenLedger(c);assert.equal(l.valid,true);let req,seen=[];
  while(req=l.nextBatch()){assert.ok(req.symbols.length<=2);assert.deepEqual(Object.keys(req).sort(),['batchId','calendarVersion','manifestHash','policyVersion','runId','seriesKeys','symbols','targetSession'].sort());assert.equal(req.rule,undefined);seen.push(...req.symbols);assert.equal(l.consume(receipt(req)).accepted,true);}
  const f=l.finish();assert.equal(new Set(seen).size,5);assert.equal(f.status,'completed');assert.equal(f.counts.total,5);assert.equal(f.counts.match,5);assert.equal(f.counts.total,sum(f.counts));assert.equal(f.batchLedger.length,3);assert.ok(!JSON.stringify(f).includes('volume_shares'));assert.equal(f.directory.universeVersion,c.directory.universeVersion);
});
test('默认批次20；上下界和null预算配置关闭',()=>{const c=config(25);delete c.batchSize;assert.equal(createScreenLedger(c).nextBatch().symbols.length,20);for(const mutation of [c=>c.batchSize=21,c=>c.batchSize=0,c=>c.batchSize=null,c=>c.limits=null,c=>c.manifestHash=null,c=>c.extra=true]){const c=config();mutation(c);assert.equal(createScreenLedger(c).valid,false);}});
test('全局限制跨批累计，remaining明确unprocessed，不重置maxProcessed',()=>{const l=createScreenLedger(config(7,{maxProcessed:3}));let r;while(r=l.nextBatch())assert.equal(l.consume(receipt(r)).accepted,true);const f=l.finish();assert.equal(f.status,'budget_exhausted');assert.deepEqual([f.counts.total,f.counts.processed,f.counts.unprocessed],[7,3,4]);assert.equal(sum(f.counts),7);});
test('节点预算跨批累计，无需构造全行情；1999个合成身份只处理1010股',()=>{
  const c=config(1999);c.rule={version:1,root:{type:'group',op:'AND',children:Array.from({length:98},(_,i)=>({...rule.root,id:`c${i}`}))}};c.batchSize=20;const l=createScreenLedger(c);assert.equal(l.valid,true);let r;while(r=l.nextBatch()){const {symbols,seriesKeys,...m}=r;l.consume({...m,records:[]});}const f=l.finish();assert.equal(f.counts.processed,Math.floor(LIMITS.maxEvaluations/99));assert.ok(f.counts.processed*99<=LIMITS.maxEvaluations);assert.equal(f.counts.total,sum(f.counts));assert.equal(f.counts.unprocessed,1999-f.counts.processed);
});
for(const field of ['runId','targetSession','calendarVersion','policyVersion','manifestHash','batchId'])test(`跨批${field}拒合且单计失败`,()=>{const l=createScreenLedger(config());const r=l.nextBatch(),b=receipt(r);b[field]='different';const a=l.consume(b);assert.equal(a.accepted,false);assert.equal(a.errors[0].code,'BATCH_FREEZE_MISMATCH');assert.equal(l.finish().counts.failure,2);assert.equal(l.consume(b).errors[0].code,'NO_PENDING_BATCH');assert.equal(l.finish().counts.failure,2);});
test('dataset tuple在同批及后续批拒合；不依据空payload隐式重造tuple',()=>{for(const field of ['dataset_id','target_session','calendar_version','policy_version']){const l=createScreenLedger(config());let r=l.nextBatch();l.consume(receipt(r));r=l.nextBatch();const b=receipt(r);b.records[0].result.dataset[field]='different';assert.equal(l.consume(b).errors[0].code,'BATCH_FREEZE_MISMATCH');assert.deepEqual([l.finish().counts.match,l.finish().counts.failure],[2,2]);}});
test('重复大小写symbol/key、池外symbol和未知key全部拒合',()=>{for(const mutate of [b=>b.records.push({...b.records[0],symbol:b.records[0].symbol.toLowerCase()}),b=>b.records[0].symbol='SH600999',b=>b.records[0].key='1w:qfq']){const l=createScreenLedger(config());const r=l.nextBatch(),b=receipt(r);mutate(b);assert.equal(l.consume(b).accepted,false);assert.equal(l.finish().counts.failure,2);assert.equal(l.finish().counts.processed,2);}});
test('批次请求/结果为拷贝；调用方改请求不能改冻结token或池',()=>{const l=createScreenLedger(config());const r=l.nextBatch();r.symbols[0]='SH600999';r.manifestHash='f'.repeat(64);const actual=l.nextBatch();assert.equal(actual.symbols[0],'SH600000');assert.equal(actual.manifestHash,'b'.repeat(64));const f=l.finish();f.rows.length=0;assert.equal(l.finish().rows.length,5);});
test('缺记录、未知停牌、失败数据、合法规则不符均独立对账',()=>{const c=config(4);c.batchSize=4;c.rule.root.right.value=200;const l=createScreenLedger(c),r=l.nextBatch(),b=receipt(r);b.records=b.records.filter(x=>x.symbol!=='SH600002');delete b.suspensionBySymbol.SH600003;b.records.find(x=>x.symbol==='SH600001'&&x.key==='1d:none').result={available:false,state:'failed_without_data',source_finality:'unknown'};assert.equal(l.consume(b).accepted,true);const f=l.finish();assert.deepEqual([f.counts.no_match,f.counts.failure,f.counts.insufficient],[1,1,2]);assert.equal(sum(f.counts),4);});
test('目录403未知分母不变成零龙头候选；缺版本/来源说明不可启动',()=>{const c=config();c.directory={status:'unavailable',universe:'CN_MAINBOARD_NON_ST_LEADERS',errorCode:'PUBLIC_DIRECTORY_HTTP_403'};const l=createScreenLedger(c);assert.equal(l.status,'blocked');assert.equal(l.report.counts,null);for(const k of ['universeVersion','sourceNotes']){const c=config();delete c.directory[k];assert.equal(createScreenLedger(c).valid,false);}});
test('合成UI三批8股，真实池未接入；早期月线长窗口未知',()=>{const d=createSyntheticBatchDemo();const l=createScreenLedger({...d.config,rule});let r;while(r=l.nextBatch())l.consume(d.readBatch(r));const f=l.finish();assert.equal(f.counts.total,8);assert.equal(f.batchLedger.length,3);assert.equal(f.synthetic,true);assert.equal(f.directory.catalogTotal,10);assert.ok(f.directory.sourceNotes.includes('尚未接入'));});
test('独立缩比40股，每批最多20股×四key564bar；不共享窗口、不一次加载全池',()=>{
  const c=config(40);c.batchSize=20;const l=createScreenLedger(c);let r,reads=0,peakBars=0;while(r=l.nextBatch()){const b=receipt(r,{dense:true});reads++;const bars=b.records.map(x=>x.result.dataset.bars);assert.equal(new Set(bars).size,b.records.length);assert.equal(new Set(bars.flat()).size,bars.flat().length);peakBars=Math.max(peakBars,bars.flat().length);assert.equal(l.consume(b).accepted,true);}const f=l.finish();assert.equal(reads,2);assert.equal(peakBars,20*564);assert.equal(f.counts.match,40);assert.equal(f.counts.total,sum(f.counts));assert.equal(f.batchLedger.length,2);
});
function tamperEveryNestedValue(value){
  if(value===null||typeof value!=='object')return;
  for(const key of Object.keys(value)){
    if(value[key]!==null&&typeof value[key]==='object')tamperEveryNestedValue(value[key]);
    else value[key]=typeof value[key]==='number'?999:typeof value[key]==='boolean'?!value[key]:'TAMPERED';
  }
  if(Array.isArray(value))value.push({tampered:true});else value.tampered=true;
}
function assertNoSharedNestedObjects(a,b,path='report'){
  if(a===null||typeof a!=='object')return;
  assert.notEqual(a,b,`${path} must be detached`);
  for(const key of Object.keys(a))assertNoSharedNestedObjects(a[key],b[key],`${path}.${key}`);
}
function assertReportIsolated(ledger){
  const pristine=ledger.finish(),returned=ledger.finish();assertNoSharedNestedObjects(pristine,returned);
  tamperEveryNestedValue(returned);assert.deepEqual(ledger.finish(),pristine);
}
test('finish所有嵌套返回值隔离：初始/运行元数据篡改不污染后续finish或consume',()=>{
  const c=config(5,{symbols:['SH600000','SH600001','SH600002','SH699999']});
  c.directory.entries.push({symbol:'SZ300001',exchange:'SZ',board:'chinext',stStatus:'non_st',name:'合成范围外'});
  const l=createScreenLedger(c);assert.equal(l.valid,true);
  const first=l.finish();first.directory.catalogTotal=999;first.excluded.push({symbol:'TAMPERED'});first.frozenFrames.D.cutoffDate='2099-01-01';assert.equal(l.finish().directory.catalogTotal,6);assert.equal(l.finish().excluded.length,1);assert.equal(l.finish().frozenFrames.D.cutoffDate,c.targetSession);
  assertReportIsolated(l);const request=l.nextBatch();assert.equal(l.consume(receipt(request)).accepted,true);
  assertReportIsolated(l);const second=l.nextBatch();assert.equal(l.consume(receipt(second)).accepted,true);
  assertReportIsolated(l);const f=l.finish();assert.equal(f.status,'completed');assert.deepEqual([f.counts.total,f.counts.match,f.directory.catalogTotal,f.directory.restrictionExcludedTotal],[3,3,6,2]);
});
test('构造配置快照隔离：输入嵌套修改不改池/规则/截止/预算或批次tuple',()=>{
  const c=config(5,{maxProcessed:3}),frozen=structuredClone(c),l=createScreenLedger(c);const baseline=l.finish();tamperEveryNestedValue(c);assert.deepEqual(l.finish(),baseline);
  let r;while(r=l.nextBatch()){assert.equal(r.runId,frozen.runId);assert.equal(r.targetSession,frozen.targetSession);assert.equal(r.manifestHash,frozen.manifestHash);assert.ok(r.symbols.every(s=>frozen.directory.entries.some(e=>e.symbol===s)));assert.equal(l.consume(receipt(r)).accepted,true);}
  const f=l.finish();assert.equal(f.status,'budget_exhausted');assert.deepEqual([f.counts.total,f.counts.match,f.counts.unprocessed],[5,3,2]);assert.equal(f.frozenFrames.D.cutoffDate,frozen.frames.D.cutoffDate);
});
test('消费输入/receipt/完成快照双向隔离，后续批次仍用原冻结证据',()=>{
  const l=createScreenLedger(config(4));const r=l.nextBatch(),input=receipt(r),saved=structuredClone(input);const returned=l.consume(input);assert.equal(returned.accepted,true);const baseline=l.finish();tamperEveryNestedValue(input);tamperEveryNestedValue(returned);assert.deepEqual(l.finish(),baseline);assertReportIsolated(l);
  const next=l.nextBatch();assert.equal(next.targetSession,saved.targetSession);assert.equal(l.consume(receipt(next)).accepted,true);assertReportIsolated(l);assert.deepEqual([l.finish().counts.total,l.finish().counts.match],[4,4]);
});
