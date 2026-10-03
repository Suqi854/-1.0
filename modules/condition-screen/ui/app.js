import { createScreenLedger, validateRule, swingPreset, LIMITS, recognizeResultContract } from '../src/index.js';
import { createSyntheticBatchDemo } from '../src/mock-batches.js';
const $ = s => document.querySelector(s);
const labels = { D: '日线', W: '周线', M: '月线', match: '命中', no_match: '不符', failure: '数据失败', insufficient: '不足 / 未知', unprocessed: '未处理' };
const kinds = [['field','字段'],['ma','价格均线 MA'],['volume_ma','量均线'],['change_pct','涨跌幅 %'],['prior_high','前高（排除当前）'],['volume_ratio','量比（前N根）']];
const fieldLabels = [['close','收盘价'],['open','开盘价'],['high','最高价'],['low','最低价'],['volume_shares','成交量（股）']];
const opLabels = [['gt','>'],['gte','≥'],['lt','<'],['lte','≤'],['eq','=（精确值）'],['neq','≠'],['cross_above','上穿'],['cross_below','下穿']];
const demo = createSyntheticBatchDemo();
const mock = {frames:demo.frames};
let rule = structuredClone(swingPreset), id = 10, lastReport = null;
function element(tag, text, className) { const e = document.createElement(tag); if(text !== undefined) e.textContent = text; if(className) e.className = className; return e; }
function select(options, value, label, change) {
  const e = element('select'); e.setAttribute('aria-label',label);
  for(const [v,t] of options){ const o=element('option',t);o.value=v;e.append(o); }
  e.value=value; e.addEventListener('change',()=>{change(e.value);dirty();});return e;
}
function button(text, action, cls) {const e=element('button',text,cls);e.type='button';e.addEventListener('click',action);return e;}
function dirty(){ $('#validation').textContent='规则或限制已修改，可重新运行'; $('#report-state').textContent=lastReport?'已有结果对应上一次规则':''; $('#report-state').className='stale-result'; }
function operand(expr, replace, right=false){
  const box=element('div',undefined,'operand');
  box.append(select(right?[...kinds,['constant','数值阈值']]:kinds,expr.kind,right?'右操作数类型':'左操作数类型',kind=>{
    replace(kind==='constant'?{kind,value:10}:kind==='field'?{kind,field:'close'}:kind==='ma'?{kind,field:'close',window:20}:{kind,window:5}); renderEditor();
  }));
  if(expr.kind==='constant'){
    const input=element('input');input.type='number';input.step='any';input.value=expr.value;input.className='kind-only';input.setAttribute('aria-label','阈值');input.addEventListener('input',()=>{expr.value=input.value===''?null:Number(input.value);dirty();});box.append(input);return box;
  }
  if(['field','ma'].includes(expr.kind))box.append(select(expr.kind==='ma'?fieldLabels.slice(0,4):fieldLabels,expr.field,'数据字段',v=>{expr.field=v;}));
  else box.append(element('span',expr.kind==='volume_ma'||expr.kind==='volume_ratio'?'成交量（股）':expr.kind==='change_pct'?'收盘价':'最高价','muted'));
  if(expr.kind!=='field'){
    const wrapper=element('div');const input=element('input');input.type='number';input.min=1;input.max=LIMITS.maxWindow;input.value=expr.window;input.setAttribute('aria-label','样本窗口');input.addEventListener('input',()=>{expr.window=input.value===''?null:Number(input.value);dirty();});wrapper.append(element('label','窗口'),input);box.append(wrapper);
  }else box.append(element('span','单根','muted'));
  const wrapper=element('div');const offset=element('input');offset.type='number';offset.min=0;offset.max=LIMITS.maxOffset;offset.value=expr.offset??0;offset.setAttribute('aria-label','K线偏移');offset.addEventListener('input',()=>{expr.offset=offset.value===''?null:Number(offset.value);dirty();});wrapper.append(element('label','偏移'),offset);box.append(wrapper);
  return box;
}
function newCondition(){return {type:'condition',id:`c${id++}`,timeframe:'D',left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:10}};}
function node(n, remove, depth=1){
  if(n.type==='condition'){
    const box=element('div',undefined,'condition');box.dataset.condition=n.id;
    const tf=select([['D','日线'],['W','周线'],['M','月线']],n.timeframe,'条件周期',v=>{n.timeframe=v;});tf.className='frame-select';box.append(tf,operand(n.left,e=>n.left=e));
    const op=select(opLabels,n.op,'比较符',v=>{n.op=v;});op.className='compare';box.append(op,operand(n.right,e=>n.right=e,true));if(remove)box.append(button('删除',remove,'remove'));return box;
  }
  const box=element('div',undefined,'group'),head=element('div',undefined,'group-head');head.append(element('strong','条件分组'),select([['AND','全部满足 AND'],['OR','任一满足 OR']],n.op,'分组逻辑',v=>{n.op=v;}),button('+ 条件',()=>{n.children.push(newCondition());renderEditor();dirty();}));
  if(depth < LIMITS.maxDepth - 1)head.append(button('+ 分组',()=>{n.children.push({type:'group',op:'OR',children:[newCondition()]});renderEditor();dirty();}));
  if(remove)head.append(button('删除分组',remove,'remove'));box.append(head);
  n.children.forEach((child,i)=>box.append(node(child,()=>{n.children.splice(i,1);renderEditor();dirty();},depth+1)));return box;
}
function renderEditor(){ $('#editor').replaceChildren(node(rule.root)); }
function renderFrames(){
  $('#frames').replaceChildren();
  for(const [tf,f] of Object.entries(mock.frames)){
    const box=element('div',undefined,`frame-card ${f.mode==='include_partial'?'partial':''}`);box.append(element('strong',`${labels[tf]} · 独立截止`));
    box.append(select([['completed','只用完成周期（默认）'],['include_partial','包含未完成当前周期']],f.mode,`${labels[tf]}周期模式`,v=>{
      f.mode=v; f.expectedLastDate=v==='include_partial'?'2026-09-28':tf==='D'?'2026-09-28':tf==='W'?'2026-09-25':'2026-08-31';renderFrames();
    }));
    box.append(element('p',`冻结截止 ${f.cutoffDate} · 预期末根 ${f.expectedLastDate}`));
    if(f.mode==='include_partial'&&tf!=='D')box.append(element('p','⚑ 含未完成周期：值仍会变化','partial'));$('#frames').append(box);
  }
}
function valueText(o){return o?.value!==undefined?`${Number(o.value.toFixed(6))} ${o.unit}`:'未知';}
function sampleText(s){return s?`${s.from} → ${s.to} · ${s.bars}根 · 窗口${s.window} / 偏移${s.offset} · ${s.sourceKey} / ${s.adjustment}${s.containsPartial?' · 含未完成周期':''}${s.baseline?` · 量比基线${s.baseline.from}→${s.baseline.to}（${s.baseline.bars}根，排除当前）`:''}${s.coverage?` · 观察窗口；缺日 ${s.coverage.missingScheduledSessionDates.join(',')||'未报告'} / 缺口验证未知 ${s.coverage.calendarGapsUnverified}`:''}`:'数值阈值';}
function tree(t){
  const box=element('div',undefined,'tree');
  if(t.type==='group'){box.append(element('p',`${t.op} · ${labels[t.state]}`));for(const c of t.children)box.append(tree(c));return box;}
  const row=element('div',undefined,'reason');row.append(element('strong',`${t.id} · ${labels[t.timeframe]} · ${labels[t.state]}`));
  row.append(element('p',`截止 ${t.cutoffDate??'未知'} / 预期 ${t.expectedLastDate??'未知'} / 实际 ${t.actualLastDate??'未知'} · ${t.adjustment??'口径未知'} · 来源最终性 ${t.sourceFinality}`,'evidence'));
  row.append(element('p',`冻结代 ${t.datasetId??'未知'} · 目标 ${t.targetSession??'未知'} · 日历 ${t.calendarVersion??'未知'} · 策略完成政策 ${t.policyVersion??'未知'}`,'evidence'));
  if(t.partialUsed)row.append(element('p','⚑ 使用未完成周期','partial'));
  if(t.left){row.append(element('p',`${valueText(t.left)} ${opLabels.find(x=>x[0]===t.op)?.[1]} ${valueText(t.right)}`));row.append(element('p',`左样本：${sampleText(t.left.sample)}`,'evidence'),element('p',`右样本：${sampleText(t.right.sample)}`,'evidence'));}
  if(t.previous)row.append(element('p',`前一根：${valueText(t.previous.left)} / ${valueText(t.previous.right)}；样本 ${sampleText(t.previous.left.sample)} / ${sampleText(t.previous.right.sample)}`,'evidence'));
  for(const r of t.reasons??[])row.append(element('p',`${r.code} · ${r.message}${r.date?` · ${r.date}`:''}`,'evidence'));box.append(row);return box;
}
function run(){
  const budget=$('#budget').value, symbols=$('#symbols').value.trim();
  const research=$('#evaluation-mode').value==='research_only',directory=structuredClone(demo.config.directory);
  if(research){directory.researchIdentity={schema_version:'research-identity-v1',basis:'public_company_research_and_name_observation',research_universe_hash:'a'.repeat(64),pool_hash:'b'.repeat(64),version:'synthetic-research-v1',evidence_revision:'synthetic-evidence-v1',evidence_sha256:'c'.repeat(64),name_observation_session:demo.config.targetSession,official_directory_verified:false,directory_identity_hash:null};for(const e of directory.entries){if(e.stStatus==='non_st')e.stStatus='unknown';e.nameObservation={asOf:demo.config.targetSession,provider:'tencent',stPrefixObserved:false};}}
  const limits={maxProcessed:budget===''?null:Number(budget),...(research?{evaluation_mode:'research_only'}:{})};if(symbols)limits.symbols=symbols.split(/[,，]/).map(s=>s.trim().toUpperCase()).filter(Boolean);
  if($('#exchange').value!=='ALL')limits.exchanges=[$('#exchange').value];
  const ledger=createScreenLedger(JSON.stringify({...demo.config,directory,frames:mock.frames,rule,limits}));
  if(!ledger.valid){renderReport(JSON.stringify(ledger.report??{version:1,status:'invalid',errors:ledger.errors}));return;}
  let request;while((request=ledger.nextBatch())!==null){const batch=demo.readBatch(request);if(research)for(const symbol of Object.keys(batch.suspensionBySymbol))batch.suspensionBySymbol[symbol]={state:'unknown'};ledger.consume(JSON.stringify(batch));}
  renderReport(JSON.stringify(ledger.finish()));
}
// The host binds a locally computed engine report. No data upload or remote screening endpoint.
export function renderReport(input){try{return renderTypedReport(input);}catch{lastReport=null;$('#summary').replaceChildren();$('#results').replaceChildren();$('#validation').textContent='结果合同拒绝：RESULT_RENDER_INVALID';$('#validation').className='error';$('#report-state').textContent='结果已清除：格式无效';}}
function renderTypedReport(input){
  const gate=recognizeResultContract(input);if(!gate.valid){lastReport=null;$('#validation').textContent='结果合同拒绝：'+gate.code;$('#validation').className='error';$('#summary').replaceChildren();$('#results').replaceChildren();$('#report-state').textContent='结果已清除：合同不受支持';return;}
  const original=gate.report,report=gate.mode==='research_only'?{...original,rows:original.research_rows,counts:original.research_counts}:original;
  lastReport=original;$('#summary').replaceChildren();$('#results').replaceChildren();$('#report-state').textContent=gate.mode==='research_only'?'仅量价研究 · 交易资格未知/不可执行 · 合成数据':'仅合成数据结果';$('#report-state').className='';
  if(!['completed','pending','budget_exhausted'].includes(report.status)){$('#validation').textContent=report.errors.map(e=>`${e.code}: ${e.message}`).join('；');$('#validation').className='error';return;}
  $('#validation').textContent='声明式规则验证通过；执行在浏览器内存';$('#validation').className='';
  for(const [k,name] of [['total','范围总数'],['successful','可判定'],['match',gate.mode==='research_only'?'研究匹配':'命中'],['no_match',gate.mode==='research_only'?'研究不符':'不符'],['failure','数据失败'],['insufficient','不足 / 未知'],['unprocessed','未处理']]){const e=element('div',name,'metric');e.append(element('b',String(report.counts[k])));$('#summary').append(e);}
  const d=report.directory;
  $('#results').append(element('p',`冻结池 ${d.universeVersion??'未提供'} · ${d.sourceNotes??'来源说明未提供'}`,'coverage'));
  if(report.batchLedger)$('#results').append(element('p',`本地分批 ${report.batchLedger.length}批 / 每批≤${report.batchSize}股 · manifest ${report.freezeTuple.manifestHash} · 状态 ${report.status}`,'coverage'));$('#results').append(element('p',`目录 ${d.asOf} / ${d.source} · ${d.catalogTotal} = 范围外 ${d.excludedTotal} + 用户限制排除 ${d.restrictionExcludedTotal} + 本次 ${report.counts.total}；本次 ${report.counts.total} = 可判定 ${report.counts.successful} + 数据失败 ${report.counts.failure} + 不足 ${report.counts.insufficient} + 未处理 ${report.counts.unprocessed}`,'coverage'));
  if(report.requestedOutsideCatalog.length)$('#results').append(element('p',`限制中不在目录的代码：${report.requestedOutsideCatalog.join(', ')}`,'coverage'));
  for(const r of report.rows){const box=element('details',undefined,'stock');box.dataset.state=r.state;const head=element('summary');if(gate.mode==='research_only')box.append(element('p','研究判断 '+r.research_decision+' · 交易资格 '+r.trading_eligibility.state+' · actionable=false','coverage'));head.append(element('b',r.symbol,'symbol'),element('span',r.name),element('span',labels[r.state],`badge ${r.state}`));box.append(head);box.append(element('p',`目录身份截止 ${r.directoryAsOf} · 请求 ${Object.entries(r.requestedFrames).map(([tf,f])=>`${labels[tf]} ${f?.cutoffDate??'未知'}（预期末根 ${f?.expectedLastDate??'未知'}）`).join(' / ')}`,'evidence'));if(r.tree)box.append(tree(r.tree));for(const e of r.reasons??[])box.append(element('p',`${e.code} · ${e.message}`));$('#results').append(box);}
  if(!report.rows.length)$('#results').append(element('p','限制范围无目录内股票','result-empty'));
}
$('#preset').addEventListener('click',()=>{rule=structuredClone(swingPreset);renderEditor();dirty();});
$('#reset').addEventListener('click',()=>{rule={version:1,root:{type:'group',op:'AND',children:[newCondition()]}};renderEditor();dirty();});
$('#export').addEventListener('click',()=>{
  const result=validateRule(JSON.stringify(rule));if(!result.valid){$('#validation').textContent=result.errors.map(x=>x.message).join('；');$('#validation').className='error';return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(rule,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='local-private-rule.json';a.click();URL.revokeObjectURL(url);
});
$('#run').addEventListener('click',run);$('#symbols').addEventListener('input',dirty);$('#budget').addEventListener('input',dirty);
$('#exchange').addEventListener('change',dirty);$('#evaluation-mode').addEventListener('change',dirty);
renderEditor();renderFrames();run();
