import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { screen, validateRule, validateSnapshot, adaptPortableDatasets } from '../src/index.js';
import { createMockSnapshot } from '../src/mock.js';
const c = (timeframe='D',id=timeframe) => ({type:'condition',id,timeframe,left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}});
const rule = root => ({version:1,root});
const group = () => rule({type:'group',op:'AND',children:['D','W','M'].map(tf=>c(tf))});
const fixture = JSON.parse(readFileSync(new URL('./fixtures/local-ohlcv-synthetic.json',import.meta.url),'utf8'));
function adapterInput() { return {
  runId:fixture.run_id,synthetic:true,
  directory:{status:'ready',universe:'CN_MAINBOARD_NON_ST',asOf:'2026-09-29',source:'SYNTHETIC_ATTESTATION',entries:[{symbol:'SH600000',name:'合成审查样例',exchange:'SH',board:'mainboard',stStatus:'non_st'}]},
  frames:{D:{adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-09-29',mode:'completed'}},
  suspensionBySymbol:{SH600000:{state:'active',verifiedThrough:'2026-09-29'}},
  records:[{symbol:'sh600000',key:'1d:none',result:{available:true,state:'ready',source_finality:'unknown',dataset:structuredClone(fixture.series['1d:none'])}}]
}; }
function allFramesInput() {
  const i=adapterInput();i.frames.W={adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-09-24',mode:'completed'};i.frames.M={adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-08-31',mode:'completed'};
  i.records=Object.entries(fixture.series).map(([key,dataset])=>({symbol:'sh600000',key,result:{available:true,state:'ready',source_finality:'unknown',dataset:structuredClone(dataset)}}));return i;
}
test('审查：getter条件在校验/执行时拒绝，调用数始终0',()=>{
  let calls=0;const r=rule(c());Object.defineProperty(r.root.right,'value',{enumerable:true,get(){calls++;return 0;}});
  assert.equal(validateRule(r).valid,false);assert.equal(screen(createMockSnapshot(),r).status,'invalid');assert.equal(calls,0);
});
test('审查：class实例与继承规则字段都拒绝，无原型getter执行',()=>{
  let calls=0;class Rule {constructor(){this.version=1;this.root=c();}}
  assert.equal(validateRule(new Rule()).valid,false);
  assert.equal(validateRule(Object.create({version:1,root:c()})).valid,false);
  const proto={};Object.defineProperty(proto,'version',{get(){calls++;return 1;}});
  assert.equal(validateRule(Object.create(proto)).valid,false);assert.equal(calls,0);
});
test('访问器在snapshot/limits/adapter/数组索引同样不被调用',()=>{
  let calls=0;const getter={enumerable:true,get(){calls++;return true;}};
  const s=createMockSnapshot();Object.defineProperty(s,'synthetic',getter);
  assert.equal(validateSnapshot(s).valid,false);assert.equal(screen(s,rule(c())).status,'invalid');
  const limits={};Object.defineProperty(limits,'symbols',getter);assert.equal(screen(createMockSnapshot(),rule(c()),limits).status,'invalid');
  const i=adapterInput();Object.defineProperty(i.records[0].result.dataset,'calendar_version',getter);assert.equal(adaptPortableDatasets(i).valid,false);
  const r=group();Object.defineProperty(r.root.children,'0',getter);assert.equal(validateRule(r).valid,false);assert.equal(calls,0);
});
test('Node拒绝Proxy，不调用get/getPrototypeOf/ownKeys/descriptor traps',()=>{
  let calls=0;const traps={get(){calls++;throw Error('must not run');},getPrototypeOf(){calls++;throw Error('must not run');},ownKeys(){calls++;throw Error('must not run');},getOwnPropertyDescriptor(){calls++;throw Error('must not run');}};
  assert.equal(validateRule(new Proxy(rule(c()),traps)).valid,false);
  const s=createMockSnapshot();s.stocks[0].series.D=new Proxy(s.stocks[0].series.D,traps);assert.equal(screen(s,rule(c())).status,'invalid');
  assert.equal(adaptPortableDatasets(new Proxy(adapterInput(),traps)).valid,false);assert.equal(calls,0);
});
test('JSON树拒绝函数/循环/Symbol/稀疏数组/隐藏属性，支持纯JSON文本',()=>{
  const r=rule(c());r.root.left.fn=()=>{};assert.equal(validateRule(r).valid,false);
  const cyclic={version:1};cyclic.root=cyclic;assert.equal(validateRule(cyclic).valid,false);
  const sym=rule(c());sym[Symbol('x')]=1;assert.equal(validateRule(sym).valid,false);
  const sparse=group();delete sparse.root.children[1];assert.equal(validateRule(sparse).valid,false);
  const hidden=rule(c());Object.defineProperty(hidden,'hidden',{value:1});assert.equal(validateRule(hidden).valid,false);
  assert.equal(validateRule(JSON.stringify(rule(c()))).valid,true);
  assert.equal(screen(JSON.stringify(createMockSnapshot()),JSON.stringify(rule(c()))).rows[0].decision,'pass');
  assert.equal(validateRule('{bad json').valid,false);
});
test('纯JSON畸形kind/field对象不发生隐式toString或抛错',()=>{
  const a=rule(c());a.root.left.kind={};assert.equal(validateRule(a).valid,false);
  const b=rule(c());b.root.left.field={};assert.equal(validateRule(b).valid,false);
});
test('审查：RUN_A/RUN_B/RUN_C直接入口failclosed',()=>{
  const s=createMockSnapshot();s.generation='RUN_A';s.stocks[0].series.D.datasetId='RUN_A';s.stocks[0].series.W.datasetId='RUN_B';s.stocks[0].series.M.datasetId='RUN_C';
  const r=screen(s,group(),{symbols:['SH600001']});assert.equal(r.status,'invalid');assert.ok(r.errors.some(e=>e.code==='GENERATION_INVALID'));
});
test('合法但混冻结代时逐股unknown/failure；同代不同contentHash合法',()=>{
  const s=createMockSnapshot();s.generation='synthetic-RUN_A';for(const frame of Object.values(s.stocks[0].series))frame.datasetId=s.generation;
  s.stocks[0].series.W.datasetId='synthetic-RUN_B';s.stocks[0].series.M.datasetId='synthetic-RUN_C';
  let r=screen(s,group(),{symbols:['SH600001']}).rows[0];assert.equal(r.state,'failure');assert.equal(r.decision,'unknown');assert.ok(r.tree.children.slice(1).every(x=>x.reasons[0].code==='DATASET_GENERATION_MISMATCH'));
  for(const [tf,frame] of Object.entries(s.stocks[0].series)){frame.datasetId=s.generation;frame.contentHash=({D:'a',W:'b',M:'c'})[tf].repeat(64);}
  r=screen(s,group(),{symbols:['SH600001']}).rows[0];assert.equal(r.decision,'pass');assert.equal(new Set(r.tree.children.map(x=>x.contentHash)).size,3);
});
test('所用序列缺datasetId关闭，未使用周期不扩大所需范围',()=>{
  const s=createMockSnapshot();delete s.stocks[0].series.W.datasetId;
  assert.equal(screen(s,rule(c()),{symbols:['SH600001']}).rows[0].decision,'pass');
  assert.equal(screen(s,rule(c('W')),{symbols:['SH600001']}).rows[0].decision,'unknown');
  delete s.generation;assert.equal(validateSnapshot(s).valid,false);
});
test('审查：未知calendar version不得制造2026proof，即使synthetic=true',()=>{
  const i=adapterInput();i.records[0].result.dataset.calendar_version='UNVERIFIED_CALENDAR_1900';
  const a=adaptPortableDatasets(i);assert.equal(a.valid,true);assert.ok(a.diagnostics.some(e=>e.code==='CALENDAR_VERSION_UNSUPPORTED'));
  assert.equal(a.snapshot.stocks[0].series.D.completionEvidence.kind,'unknown');
  assert.equal(screen(a.snapshot,rule(c())).rows[0].decision,'unknown');
});
test('直接入口同样不接受未知calendar version或扩张已知calendar范围',()=>{
  const s=createMockSnapshot();s.stocks[0].series.D.completionEvidence={kind:'calendar',verifiedFrom:'1900-01-01',verifiedThrough:'2099-12-31'};
  s.calendarVersion=s.stocks[0].series.D.calendarVersion='UNVERIFIED_CALENDAR_1900';assert.equal(screen(s,rule(c()),{symbols:['SH600001']}).rows[0].decision,'unknown');
  s.calendarVersion=s.stocks[0].series.D.calendarVersion='exchange-announced-2026-v1';for(const b of s.stocks[0].series.D.bars)b.completionBasis='verified_calendar_schedule_with_conservative_buffer';assert.equal(screen(s,rule(c()),{symbols:['SH600001']}).rows[0].decision,'pass');
  const m=s.stocks[0].series.M;m.calendarVersion=s.calendarVersion;m.completionEvidence={kind:'calendar',verifiedFrom:'1900-01-01',verifiedThrough:'2099-12-31'};for(const b of m.bars)b.completionBasis='verified_calendar_schedule_with_conservative_buffer';
  assert.equal(screen(s,rule(c('M','old-month')),{symbols:['SH600001']}).rows[0].decision,'pass'); // latest complete Aug2026 is inside recognized range
  const old=rule(c('M','old-window'));old.root.left={kind:'ma',field:'close',window:20};assert.equal(screen(s,old,{symbols:['SH600001']}).rows[0].decision,'unknown');
});
test('审查：adapter拒绝同run跨calendar/policy/目标tuple',()=>{
  for(const change of [i=>i.records[1].result.dataset.calendar_version='DIFFERENT_CALENDAR',i=>i.records[1].result.dataset.policy_version='DIFFERENT_POLICY',i=>{i.frames.W.cutoffDate='2026-09-28';i.records[1].result.dataset.target_session='2026-09-28';}]){
    const i=allFramesInput();change(i);const a=adaptPortableDatasets(i);const r=screen(a.snapshot,group()).rows[0];assert.equal(r.state,'failure');assert.equal(r.decision,'unknown');assert.ok(a.diagnostics.some(e=>e.code==='DATASET_FREEZE_TUPLE_MISMATCH'));
  }
});
test('直接screen同样核验共同target/calendar/policy tuple与周期cutoff',()=>{
  for(const field of ['targetSession','calendarVersion','policyVersion']){const s=createMockSnapshot();s.stocks[0].series.W[field]=field==='targetSession'?'2026-09-27':'DIFFERENT';const r=screen(s,group(),{symbols:['SH600001']});assert.ok(r.status==='invalid'||r.rows[0]?.decision==='unknown');if(r.rows[0])assert.equal(r.rows[0].tree.children[1].reasons[0].code,'DATASET_FREEZE_TUPLE_MISMATCH');}
  const s=createMockSnapshot();s.frames.W.cutoffDate='2026-09-25';s.stocks[0].series.W.targetSession='2026-09-25';assert.equal(screen(s,group(),{symbols:['SH600001']}).rows[0].decision,'unknown');
});
test('不同合法收据时钟允许同代，expectedLastDate也可不同',()=>{
  const i=allFramesInput();Object.assign(i.records[1].result.dataset,{request_started_at:'2026-09-29T10:01:00Z',completion_cutoff:'2026-09-29T10:01:00Z',fetched_at:'2026-09-29T10:01:02Z'});
  const a=adaptPortableDatasets(i),r=screen(a.snapshot,group()).rows[0];assert.equal(r.decision,'pass');assert.equal(r.tree.children[1].fetchedAt,'2026-09-29T10:01:02Z');assert.notEqual(r.tree.children[0].fetchedAt,r.tree.children[1].fetchedAt);
});
test('严格ISO时间：0、无timezone、溢出日/时/分/秒都关闭',()=>{
  for(const clock of ['0','2026-09-29 10:00:00','2026-09-29T10:00:00','2026-02-31T10:00:00Z','2026-09-29T25:00:00Z','2026-09-29T10:60:00Z','2026-09-29T10:00:60Z']){
    const i=adapterInput();for(const k of ['request_started_at','completion_cutoff','fetched_at'])i.records[0].result.dataset[k]=clock;
    const a=adaptPortableDatasets(i);assert.equal(screen(a.snapshot,rule(c())).rows[0].decision,'unknown');assert.ok(a.diagnostics.some(e=>e.code==='RECEIPT_CLOCK_INVALID'||e.code==='QUALITY_INVALID_FIELD'));
  }
});
test('收据倒置、未来cutoff、早于target观察都关闭，偏移ISO可用',()=>{
  for(const change of [d=>d.fetched_at='2026-01-01T00:00:00Z',d=>d.completion_cutoff='2026-09-30T10:00:00Z',d=>d.completion_cutoff='2026-09-28T10:00:00Z']){
    const i=adapterInput();change(i.records[0].result.dataset);assert.equal(screen(adaptPortableDatasets(i).snapshot,rule(c())).rows[0].decision,'unknown');
  }
  const i=adapterInput();for(const k of ['request_started_at','completion_cutoff','fetched_at'])i.records[0].result.dataset[k]='2026-09-29T18:00:00+08:00';assert.equal(screen(adaptPortableDatasets(i).snapshot,rule(c())).rows[0].decision,'pass');
});
test('直接screen也拒绝无效/倒置收据',()=>{
  for(const change of [s=>s.requestStartedAt='0',s=>s.fetchedAt='2026-01-01T00:00:00Z']){const s=createMockSnapshot();change(s.stocks[0].series.D);const r=screen(s,rule(c()),{symbols:['SH600001']});assert.ok(r.status==='invalid'||r.rows[0]?.decision==='unknown');if(r.rows[0])assert.equal(r.rows[0].tree.reasons[0].code,'RECEIPT_CLOCK_INVALID');}
});
test('available=true配失败/缺state不得pass',()=>{
  for(const state of ['failed_without_data','partial','pending_source',undefined]){const i=adapterInput();if(state===undefined)delete i.records[0].result.state;else i.records[0].result.state=state;const a=adaptPortableDatasets(i);assert.ok(a.diagnostics.some(e=>['AVAILABLE_STATE_CONTRADICTION','ADAPTER_RESULT_INVALID'].includes(e.code)));if(a.valid)assert.equal(screen(a.snapshot,rule(c())).rows[0].decision,'unknown');else assert.equal(a.valid,false);}
});
test('bundle末观察标签必须达到冻结target，不用旧月线伪造ready',()=>{
  const i=allFramesInput();const d=i.records[2].result.dataset;d.bars.pop();d.coverage.returned=d.bars.length;d.coverage.last_date=d.bars.at(-1).date;
  const a=adaptPortableDatasets(i);assert.ok(a.diagnostics.some(e=>e.code==='OBSERVATION_TARGET_MISMATCH'));assert.equal(screen(a.snapshot,group()).rows[0].decision,'unknown');
});
test('畸形JSON空/非对象K线安全失败，不抛错或升级ready',()=>{
  for(const bar of [null,0,false,[]]){const i=adapterInput();i.records[0].result.dataset.bars[2]=bar;const a=adaptPortableDatasets(i);assert.equal(a.valid,true);assert.ok(a.diagnostics.some(e=>e.code==='BAR_CONTRACT_MISSING'||e.code==='QUALITY_OBJECT_REQUIRED'));assert.equal(screen(a.snapshot,rule(c())).rows[0].decision,'unknown');}
});
test('portable v1：adapter拒绝cutoff早于或晚于同序列request，即使均早于fetched',()=>{
  for(const cutoff of ['2026-09-29T09:59:59.999Z','2026-09-29T10:00:00.001Z']){
    const i=adapterInput();Object.assign(i.records[0].result.dataset,{completion_cutoff:cutoff,fetched_at:'2026-09-29T10:00:01Z'});
    const a=adaptPortableDatasets(i);assert.ok(a.diagnostics.some(e=>e.code==='RECEIPT_CLOCK_INVALID'));assert.equal(screen(a.snapshot,rule(c())).rows[0].decision,'unknown');
  }
});
test('portable v1：直接screen也拒绝cutoff/request差1毫秒',()=>{
  for(const cutoff of ['2026-09-28T09:59:59.999Z','2026-09-28T10:00:00.001Z']){
    const s=createMockSnapshot();s.stocks[0].series.D.completionCutoff=cutoff;
    const r=screen(s,rule(c()),{symbols:['SH600001']}).rows[0];assert.equal(r.decision,'unknown');assert.equal(r.tree.reasons[0].code,'RECEIPT_CLOCK_INVALID');
  }
});
test('同一绝对时刻允许不同ISO写法，D/W/M各自独立收据仍可通过',()=>{
  const i=allFramesInput();
  for(const [idx,minute] of [[0,'00'],[1,'01'],[2,'02']])Object.assign(i.records[idx].result.dataset,{request_started_at:`2026-09-29T10:${minute}:00.000Z`,completion_cutoff:`2026-09-29T18:${minute}:00+08:00`,fetched_at:`2026-09-29T10:${minute}:01Z`});
  const a=adaptPortableDatasets(i);assert.equal(a.diagnostics.length,0);const r=screen(a.snapshot,group()).rows[0];assert.equal(r.decision,'pass');assert.equal(new Set(r.tree.children.map(n=>n.requestStartedAt)).size,3);
});
