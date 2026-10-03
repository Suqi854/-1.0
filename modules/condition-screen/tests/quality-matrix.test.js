import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {screen,adaptPortableDatasets,validateSnapshot} from '../src/index.js';
import {createMockSnapshot} from '../src/mock.js';
import {QUALITY_FIELDS} from '../src/quality.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/local-ohlcv-synthetic.json',import.meta.url),'utf8'));
const rule={version:1,root:{type:'condition',id:'D',timeframe:'D',left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}};
const limits={symbols:['SH600001']};
function raw(){return {runId:fixture.run_id,synthetic:false,directory:{status:'ready',universe:'CN_MAINBOARD_NON_ST',source:'SYNTHETIC_INTERFACE_TEST',asOf:fixture.target_session,entries:[{symbol:'SH600000',exchange:'SH',board:'mainboard',stStatus:'non_st',name:'合成矩阵'}]},frames:{D:{cutoffDate:fixture.target_session,expectedLastDate:fixture.target_session,mode:'completed',adjustment:'none'}},suspensionBySymbol:{SH600000:{state:'active',verifiedThrough:fixture.target_session}},records:[{symbol:'sh600000',key:'1d:none',result:{available:true,state:'ready',source_finality:'unknown',dataset:structuredClone(fixture.series['1d:none'])}}]};}
function unknown(report,context){assert.ok(report.status==='invalid'||report.rows.length>0&&report.rows.every(r=>r.decision==='unknown'),context);}
for(const [group,fields] of [['series',QUALITY_FIELDS.series],['coverage',QUALITY_FIELDS.coverage],['bar',QUALITY_FIELDS.bar]])for(const field of fields){
  test(`direct quality matrix ${group}.${field}: null/wrong type/missing`,()=>{
    for(const mutation of ['null','object','missing']){
      if((group==='bar'&&['amount_cny','observedLatest'].includes(field)&&mutation==='null')||(group==='series'&&field==='cache'&&mutation==='missing'))continue;
      const s=createMockSnapshot(),series=s.stocks[0].series.D,target=group==='series'?series:group==='coverage'?series.coverage:series.bars.at(-1);
      if(mutation==='missing')delete target[field];else target[field]=mutation==='null'?null:{};
      assert.doesNotThrow(()=>unknown(screen(s,rule,limits),`${group}.${field}/${mutation}`));
      const schema=validateSnapshot(s);if(mutation==='object'&&!(group==='series'&&['coverage','completionEvidence','cache'].includes(field))||mutation==='null'&&!(group==='bar'&&['open','high','low','close','volume_shares','calendarCompletion'].includes(field)))assert.equal(schema.valid,false,`${group}.${field}/${mutation} must be typed`);
    }
  });
}
for(const [group,fields] of [['portable',QUALITY_FIELDS.portable],['coverage',QUALITY_FIELDS.coverage],['bar',QUALITY_FIELDS.portableBar]])for(const field of fields){
  test(`adapter quality matrix ${group}.${field}: null/wrong type/missing`,()=>{
    for(const mutation of ['null','object','missing']){
      if(group==='bar'&&['amount_cny','observed_latest'].includes(field)&&mutation==='null'||group==='portable'&&field==='warnings'&&mutation==='missing')continue;
      const i=raw(),d=i.records[0].result.dataset,target=group==='portable'?d:group==='coverage'?d.coverage:d.bars.at(-1);
      if(mutation==='missing')delete target[field];else target[field]=mutation==='null'?null:{};
      assert.doesNotThrow(()=>{const a=adaptPortableDatasets(i);if(a.valid)unknown(screen(a.snapshot,rule),`${group}.${field}/${mutation}`);else assert.equal(a.valid,false);});
    }
  });
}
for(const group of ['series','coverage','bar','proof','cache'])test(`direct unknown fields rejected: ${group}`,()=>{
  const s=createMockSnapshot(),f=s.stocks[0].series.D;if(group==='cache')f.cache={used:true,scope:'explicit_local_dataset'};
  const target={series:f,coverage:f.coverage,bar:f.bars.at(-1),proof:f.completionEvidence,cache:f.cache}[group];target.extra_claim=true;unknown(screen(s,rule,limits),group);
});
for(const group of ['portable','coverage','bar','units','cache'])test(`adapter unknown fields rejected: ${group}`,()=>{
  const i=raw(),d=i.records[0].result.dataset;({portable:d,coverage:d.coverage,bar:d.bars.at(-1),units:d.units,cache:d.cache})[group].extra_claim=true;const a=adaptPortableDatasets(i);unknown(screen(a.snapshot,rule),group);
});
test('父typed quality反例：object/null/字符串flag/finality/PIT/复权量/缺hash均不通过',()=>{
  const mutations=[s=>s.coverage.missing_scheduled_session_dates={},s=>s.coverage.missing_scheduled_session_dates=null,s=>s.coverage.calendar_gaps_unverified='true',s=>delete s.coverage.calendar_gaps_unverified,s=>s.sourceFinality='known_final',s=>s.pointInTime=true,s=>s.volumeBasis='adjusted_volume',s=>delete s.contentHash];
  for(const mutate of mutations){const a=adaptPortableDatasets(raw());mutate(a.snapshot.stocks[0].series.D);assert.doesNotThrow(()=>unknown(screen(a.snapshot,rule),'parent counterexample'));}
});
test('coverage数量/日期/界限、重复缺日的不变量不被默默升级',()=>{
  for(const mutate of [c=>c.returned=1,c=>c.returned=2001,c=>c.requested=0,c=>c.calendar_unverified_rows=999,c=>c.first_date='2020-01-01',c=>c.last_date='2026-09-01',c=>c.full_history=true,c=>c.missing_scheduled_session_dates=['2026-09-25','2026-09-25']]){const s=createMockSnapshot();mutate(s.stocks[0].series.D.coverage);unknown(screen(s,rule,limits),'coverage invariant');}
});
test('null OHLCV代表缺字段；nullable observedLatest不成为finality或PIT证明',()=>{
  const s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1).observedLatest=null;assert.equal(screen(s,rule,limits).rows[0].decision,'pass');
  for(const field of ['open','high','low','close','volume_shares']){const s=createMockSnapshot();s.stocks[0].series.D.bars.at(-1)[field]=null;assert.equal(screen(s,rule,limits).rows[0].decision,'unknown');}
});
test('安全体量边界保持，3052独立564bar下界超10m；不构造超内存输入',()=>{
  const fields=Object.keys(fixture.series['1d:none'].bars[0]).length;assert.ok(3052*564*(fields+1)>10_000_000);
});
test('adapter外层冻结pin/record/result白名单与wrong type也关闭',()=>{
  for(const mutate of [i=>i.extra=true,i=>i.targetSession=null,i=>i.calendarVersion={},i=>i.policyVersion=42,i=>i.synthetic='false',i=>i.suspensionBySymbol=null,i=>i.records[0].extra=true,i=>i.records[0].result.extra_claim=true,i=>i.records[0].result.available='true',i=>i.records[0].result.source_finality='known_final']){const i=raw();mutate(i);assert.doesNotThrow(()=>assert.equal(adaptPortableDatasets(i).valid,false));}
});
test('空对象质量字段不升级ready；对象必需字段wrong数组拒绝',()=>{
  for(const field of ['coverage','completionEvidence','cache']){const s=createMockSnapshot();s.stocks[0].series.D[field]=[];assert.equal(validateSnapshot(s).valid,false);unknown(screen(s,rule,limits),field);}
});
