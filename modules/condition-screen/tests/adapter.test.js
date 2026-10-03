import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptPortableDatasets, screen } from '../src/index.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/local-ohlcv-synthetic.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x);
const condition=(tf='D',left={kind:'field',field:'close'},id='c')=>({type:'condition',id,timeframe:tf,left,op:'gt',right:{kind:'constant',value:100}});
const rule=root=>({version:1,root});
function input(){return {
  runId:fixture.run_id,synthetic:true,
  directory:{status:'ready',universe:'CN_MAINBOARD_NON_ST',asOf:'2026-09-29',source:'SYNTHETIC_TEST_ATTESTATION',entries:[{symbol:'SH600000',name:'合成接口样本',exchange:'SH',board:'mainboard',stStatus:'non_st'}]},
  frames:{D:{adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-09-29',mode:'completed'},W:{adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-09-24',mode:'completed'},M:{adjustment:'none',cutoffDate:'2026-09-29',expectedLastDate:'2026-08-31',mode:'completed'}},
  suspensionBySymbol:{SH600000:{state:'active',verifiedThrough:'2026-09-29'}},
  records:Object.entries(fixture.series).map(([key,d])=>({symbol:'sh600000',key,result:{available:true,state:'ready',source_finality:'unknown',dataset:clone(d)}}))
};}
function result(i,r=rule(condition())){const a=adaptPortableDatasets(i);assert.equal(a.valid,true);return {adapter:a,row:screen(a.snapshot,r).rows[0]};}
test('父提供四键合成合同可消费；保留 generation/hash/source finality',()=>{
  const {adapter,row}=result(input());assert.equal(adapter.diagnostics.length,0);assert.equal(row.decision,'pass');assert.equal(row.passed,true);assert.equal(row.tree.datasetId,fixture.run_id);assert.equal(row.tree.contentHash,fixture.series['1d:none'].content_hash);assert.equal(row.tree.sourceFinality,'unknown');assert.equal(row.tree.left.value,104);assert.equal(row.tree.left.sample.volumeBasis,'provider_unadjusted_reported_volume');assert.equal(row.tree.left.sample.pointInTime,false);
});
test('完成D/W/M截止不同仍同代消费，未完成可单独启用',()=>{
  const i=input(),r=rule({type:'group',op:'AND',children:['D','W','M'].map(tf=>condition(tf,undefined,tf))});
  let x=result(i,r).row;assert.equal(x.decision,'pass');assert.deepEqual(x.tree.children.map(c=>c.actualLastDate),['2026-09-29','2026-09-24','2026-08-31']);
  i.frames.W.mode='include_partial';i.frames.W.expectedLastDate='2026-09-29';x=result(i,r).row;assert.equal(x.tree.children[1].partialUsed,true);assert.equal(x.tree.children[2].partialUsed,false);
});
test('200请求只有3返回，MA20必须unknown不能伪造历史',()=>{
  const {row}=result(input(),rule(condition('D',{kind:'ma',field:'close',window:20})));assert.equal(row.decision,'unknown');assert.equal(row.passed,null);assert.equal(row.tree.reasons[0].code,'INSUFFICIENT_HISTORY');
});
test('非符条件是fail/false，缺OHLCV是unknown/null',()=>{
  let r=rule(condition());r.root.right.value=200;assert.equal(result(input(),r).row.passed,false);
  const i=input();i.records[0].result.dataset.bars.at(-1).volume_shares=null;assert.equal(result(i).row.passed,null);
});
test('qfq日可用但不冒充qfq周月，实际registry反映所选数据',()=>{
  let i=input();i.frames.D.adjustment='qfq';let a=adaptPortableDatasets(i);assert.ok(a.availableSeries.some(s=>s.key==='1d:qfq'));assert.equal(screen(a.snapshot,rule(condition())).rows[0].decision,'pass');
  i.frames.W.adjustment='qfq';a=adaptPortableDatasets(i);assert.ok(a.diagnostics.some(d=>d.code==='SERIES_NOT_IN_REGISTRY'));assert.equal(screen(a.snapshot,rule(condition('W'))).rows[0].decision,'unknown');assert.ok(!a.availableSeries.some(s=>s.key==='1w:qfq'));
});
test('ready不代表停牌/非ST已验证，name过滤不被提升',()=>{
  const i=input();delete i.suspensionBySymbol;assert.equal(result(i).row.decision,'unknown');i.suspensionBySymbol={SH600000:{state:'active',verifiedThrough:'2026-09-29'}};delete i.directory.entries[0].stStatus;const row=result(i).row;assert.equal(row.decision,'unknown');assert.equal(row.reasons[0].code,'ST_STATUS_UNKNOWN');
});
test('尚未available的partial/pending/failed分别保留',()=>{
  for(const state of ['partial','pending_source','pending','failed_without_data']){const i=input();i.records[0].result={available:false,state,source_finality:'unknown'};const row=result(i).row;assert.equal(row.decision,'unknown');assert.equal(row.state,state==='failed_without_data'?'failure':'insufficient');}
});
test('冻结代/身份/单位/目标/内容hash缺失均failclosed',()=>{
  for(const [k,v] of [['dataset_id','other-generation'],['symbol','sz000001'],['source','other'],['adjustment','hfq'],['target_session','2026-09-28'],['content_hash',''],['units',{price:'CNY',volume:'lots'}]]){const i=input();i.records[0].result.dataset[k]=v;const row=result(i).row;assert.equal(row.decision,'unknown');assert.equal(row.state,'failure');}
});
test('旧complete=true但calendar_completion=null仍unknown',()=>{
  const i=input();const b=i.records[0].result.dataset.bars.at(-1);b.calendar_completion=null;b.completion_basis='elapsed_natural_period';assert.equal(result(i).row.tree.reasons[0].code,'COMPLETION_UNKNOWN');
});
test('缺完成字段/截止字段/成交额非法都阻断',()=>{
  for(const field of ['calendar_completion','period_end_session','completion_basis','observed_latest']){const i=input();delete i.records[0].result.dataset.bars.at(-1)[field];assert.equal(result(i).row.state,'failure');}
  const i=input();i.records[0].result.dataset.bars.at(-1).amount_cny=100;assert.equal(result(i).row.state,'failure');
});
test('重复键拒绝；适配器不修改调用方与不抓数据',()=>{
  const i=input(),before=JSON.stringify(i);adaptPortableDatasets(i);assert.equal(JSON.stringify(i),before);i.records.push(clone(i.records[0]));assert.equal(adaptPortableDatasets(i).valid,false);
});
test('窗口内缺计划交易日返回unknown，窗口外不污染当前字段',()=>{
  const i=input();i.records[0].result.dataset.coverage.missing_scheduled_session_dates=['2026-09-25'];
  assert.equal(result(i).row.decision,'pass');
  const row=result(i,rule(condition('D',{kind:'ma',field:'close',window:3}))).row;assert.equal(row.decision,'unknown');assert.equal(row.state,'insufficient');assert.equal(row.tree.reasons[0].code,'MISSING_SCHEDULED_SESSIONS');assert.deepEqual(row.tree.left.sample.coverage.missingScheduledSessionDates,['2026-09-25']);
});
test('calendar gaps未知保留unknown且不推断停牌/失败',()=>{
  const i=input();i.records[0].result.dataset.coverage.calendar_gaps_unverified=true;const row=result(i).row;assert.equal(row.state,'insufficient');assert.equal(row.tree.reasons[0].code,'CALENDAR_GAPS_UNVERIFIED');assert.equal(row.passed,null);
});
test('coverage最终必填缺日/unknown字段缺失时failclosed',()=>{
  for(const field of ['missing_scheduled_session_dates','calendar_gaps_unverified','missing_session_note']){const i=input();delete i.records[0].result.dataset.coverage[field];assert.equal(result(i).row.state,'failure');}
});
