/** Local consumption controller. No I/O/callbacks: a trusted host reads only nextBatch().symbols. */
import {readJSONInput} from './json-input.js';
import {screen,validateRule,LIMITS} from './engine.js';
import {adaptPortableDatasets,PORTABLE_KEYS} from './portable-adapter.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sameTuple=(a,b)=>['runId','targetSession','calendarVersion','policyVersion','manifestHash'].every(k=>a[k]===b[k]);
const count=rows=>{const c={total:rows.length,processed:0,successful:0,match:0,no_match:0,failure:0,insufficient:0,unprocessed:0};for(const r of rows){c[r.state]++;if(r.state!=='unprocessed')c.processed++;if(['match','no_match'].includes(r.state))c.successful++;}return c;};
const problem=(code,message)=>({code,message});
export function createScreenLedger(config){
  const safe=readJSONInput(config);if(!safe.valid)return {valid:false,errors:[safe.error]};config=safe.value;
  if(!object(config))return {valid:false,errors:[problem('BATCH_CONFIG_INVALID','配置必须为JSON对象')]};
  const allowed=['version','runId','targetSession','calendarVersion','policyVersion','manifestHash','synthetic','directory','frames','rule','limits','batchSize'];
  if(Object.keys(config).some(k=>!allowed.includes(k))||config.version!==1||(config.limits!==undefined&&!object(config.limits))||(config.synthetic!==undefined&&typeof config.synthetic!=='boolean')||typeof config.manifestHash!=='string'||!/^[0-9a-f]{64}$/.test(config.manifestHash)||!(config.batchSize===undefined||Number.isInteger(config.batchSize)&&config.batchSize>=1&&config.batchSize<=20))return {valid:false,errors:[problem('BATCH_CONFIG_INVALID','缺合法manifestHash/版本，或批次超20股/存在未知属性')]};
  const base={version:1,synthetic:config.synthetic===true,generation:config.runId,targetSession:config.targetSession,calendarVersion:config.calendarVersion,policyVersion:config.policyVersion,directory:config.directory,frames:config.frames,stocks:[]};
  const limits=config.limits??{};
  const ruleCheck=validateRule(JSON.stringify(config.rule));
  const initial=screen(JSON.stringify(base),JSON.stringify(config.rule),JSON.stringify({...limits,maxProcessed:0}));
  if(!ruleCheck.valid||!['completed','blocked'].includes(initial.status))return {valid:false,errors:[...ruleCheck.errors,...initial.errors]};
  if(initial.status==='blocked')return {valid:false,status:'blocked',errors:initial.errors,report:initial};
  // Validate original budget too; zero-budget skeleton must not hide a malformed caller limit.
  const budgetCheck=screen(JSON.stringify(base),JSON.stringify(config.rule),JSON.stringify(limits));
  if(budgetCheck.status!=='completed')return {valid:false,errors:budgetCheck.errors};
  const tuple={runId:config.runId,targetSession:config.targetSession,calendarVersion:config.calendarVersion,policyVersion:config.policyVersion,manifestHash:config.manifestHash};
  const batchSize=config.batchSize??20,maximum=Math.min(limits.maxProcessed??LIMITS.maxSymbols,Math.floor(LIMITS.maxEvaluations/ruleCheck.nodes));
  const order=initial.rows.map(r=>r.symbol),directory=new Map(config.directory.entries.map(e=>[e.symbol,e]));
  const rows=new Map(initial.rows.map(r=>[r.symbol,{...r,reasons:[problem('PENDING_LOCAL_BATCH','本地批次尚未消费')]}]));
  const committed=new Set(),batchLog=[];let cursor=0,active=null,sequence=0;
  function nextBatch(){
    if(active)return structuredClone(active);
    if(cursor>=order.length||cursor>=maximum)return null;
    const symbols=order.slice(cursor,Math.min(order.length,maximum,cursor+batchSize));
    active={batchId:`batch-${++sequence}`,...tuple,symbols,seriesKeys:[...PORTABLE_KEYS]};
    return structuredClone(active);
  }
  function reject(code,message){
    if(!active)return {accepted:false,errors:[problem(code,message)]};
    for(const symbol of active.symbols){const old=rows.get(symbol);rows.set(symbol,{...old,state:'failure',decision:'unknown',passed:null,reasons:[problem(code,message)]});committed.add(symbol);}
    batchLog.push({batchId:active.batchId,symbols:[...active.symbols],accepted:false,code});cursor+=active.symbols.length;active=null;
    return {accepted:false,errors:[problem(code,message)]};
  }
  function consume(batch){
    const parsed=readJSONInput(batch);if(!parsed.valid)return reject('BATCH_JSON_INVALID',parsed.error.message);
    batch=parsed.value;
    if(!active)return {accepted:false,errors:[problem('NO_PENDING_BATCH','无待消费批次；已完成批次不能重复计数')]};
    const keys=['batchId','runId','targetSession','calendarVersion','policyVersion','manifestHash','records','suspensionBySymbol'];
    if(!object(batch)||Object.keys(batch).some(k=>!keys.includes(k))||batch.batchId!==active.batchId||!sameTuple(batch,tuple))return reject('BATCH_FREEZE_MISMATCH','批次token或run/manifest/target/calendar/policy不一致，拒合');
    if(!Array.isArray(batch.records)||batch.records.length>active.symbols.length*4)return reject('BATCH_RECORD_BOUNDS','批次记录须≤所请求股数×4个实际key');
    const seen=new Set();
    for(const rec of batch.records){
      if(!object(rec)||typeof rec.symbol!=='string'||!active.symbols.includes(rec.symbol.toUpperCase())||!PORTABLE_KEYS.includes(rec.key))return reject('BATCH_SYMBOL_SCOPE','返回了批次之外的symbol或未知key，拒合');
      const id=rec.symbol.toUpperCase()+'/'+rec.key;if(seen.has(id))return reject('BATCH_DUPLICATE_SYMBOL_KEY','同批symbol/key重复，拒合');seen.add(id);
    }
    if(batch.suspensionBySymbol!==undefined&&!object(batch.suspensionBySymbol))return reject('BATCH_EVIDENCE_INVALID','停牌证据须为对象');
    if(object(batch.suspensionBySymbol)&&Object.keys(batch.suspensionBySymbol).some(s=>!active.symbols.includes(s)))return reject('BATCH_SYMBOL_SCOPE','停牌证据包含批次之外symbol，拒合');
    for(const rec of batch.records){const d=rec.result?.dataset;if(rec.result?.available===true&&object(d)&&['dataset_id','target_session','calendar_version','policy_version'].some((k,i)=>d[k]!==[tuple.runId,tuple.targetSession,tuple.calendarVersion,tuple.policyVersion][i]))return reject('BATCH_FREEZE_MISMATCH','实际dataset冻结tuple跨批不一致，拒合');}
    const adapted=adaptPortableDatasets(JSON.stringify({runId:tuple.runId,targetSession:tuple.targetSession,calendarVersion:tuple.calendarVersion,policyVersion:tuple.policyVersion,synthetic:base.synthetic,directory:{...config.directory,entries:active.symbols.map(s=>directory.get(s))},frames:config.frames,records:batch.records,suspensionBySymbol:batch.suspensionBySymbol??{}}));
    if(!adapted.valid)return reject('BATCH_ADAPTER_INVALID','本地批次适配输入无效，拒合');
    const evaluated=screen(JSON.stringify(adapted.snapshot),JSON.stringify(config.rule),JSON.stringify({maxProcessed:active.symbols.length}));
    if(evaluated.status!=='completed'||evaluated.rows.length!==active.symbols.length||new Set(evaluated.rows.map(r=>r.symbol)).size!==active.symbols.length||evaluated.rows.some(r=>!active.symbols.includes(r.symbol)||committed.has(r.symbol)))return reject('BATCH_EVALUATION_INVALID','批次结果无效、缺symbol或重复提交，拒合');
    for(const row of evaluated.rows){rows.set(row.symbol,row);committed.add(row.symbol);}
    const receipt={batchId:active.batchId,symbols:[...active.symbols],accepted:true,counts:evaluated.counts,diagnosticCodes:[...new Set(adapted.diagnostics.map(d=>d.code))]};batchLog.push(receipt);cursor+=active.symbols.length;active=null;
    return structuredClone(receipt);
  }
  function finish(){
    const result=order.map(symbol=>{
      const row=rows.get(symbol);return row.state==='unprocessed'?{...row,reasons:[problem(cursor>=maximum?'PROCESS_BUDGET':'PENDING_LOCAL_BATCH',cursor>=maximum?'累计预算已达，未处理':'本地批次尚未消费')]}:row;
    });
    // Detach the entire report, including nested metadata inherited from initial.
    return structuredClone({...initial,status:cursor>=order.length?'completed':cursor>=maximum?'budget_exhausted':'pending',rows:result,counts:count(result),freezeTuple:tuple,batchLedger:batchLog,batchSize,maxProcessed:maximum,ruleNodes:ruleCheck.nodes,cumulativeEvaluationBudget:result.filter(r=>r.state!=='unprocessed').length*ruleCheck.nodes,processingComplete:result.every(r=>r.state!=='unprocessed'),dataExecution:'local_batch_consumer',note:'总数来自一次冻结目录；每symbol恰一状态。仅保留结果/元数据，不在ledger保留OHLCV；不证明真实全池完成'});
  }
  return {valid:true,nextBatch,consume,finish};
}
