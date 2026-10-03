// One user-started run over a frozen source manifest. No timers, credentials or cloud bridge.
export const mainboardScreenPanel=String.raw`<section class="card mainboard-screen" id="mainboard-screen-panel" aria-labelledby="mainboard-screen-title">
<style>.mainboard-screen{border-top:2px solid var(--green);margin-bottom:16px}.mainboard-screen .run-actions{display:flex;gap:9px;flex-wrap:wrap;margin:16px 0}.mainboard-screen button{min-height:44px}.mainboard-ledger{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;margin:14px 0}.mainboard-ledger div{background:#243540;border:1px solid #334b58;border-radius:9px;padding:10px;min-width:0}.mainboard-ledger dt{color:var(--muted);font-size:12px}.mainboard-ledger dd{margin:4px 0 0;font-size:23px;font-weight:650}.mainboard-screen .mainboard-results{display:grid;gap:10px}.mainboard-screen .mainboard-row{border:1px solid var(--line);border-left:3px solid var(--green);border-radius:9px;padding:14px;min-width:0}.mainboard-screen .mainboard-row.risk{border-left-color:var(--gold)}.mainboard-screen .mainboard-row summary{min-height:40px;padding:7px 0}.mainboard-screen .mainboard-row p{overflow-wrap:anywhere}.mainboard-screen .run-progress{width:100%;height:7px;accent-color:var(--green)}.mainboard-screen .mainboard-filter{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}.mainboard-screen pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:var(--muted)}@media(max-width:760px){.mainboard-ledger{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.mainboard-ledger div{padding:8px}.mainboard-ledger dd{font-size:20px}.mainboard-screen .run-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.mainboard-screen .run-actions button{font-size:13px;padding:8px}.mainboard-screen .mainboard-row{padding:11px}}</style>
<div class="row"><h2 id="mainboard-screen-title">沪深主板 · 排除 ST 名称</h2><span class="badge">固定名单 · 每批最多 20 只</span></div>
<p class="data-note">按本次沪深交易所公开目录识别普通沪深主板，并排除规范化后带 ST / *ST 前缀的名称。无需个人 key；官方风险警示状态、上市交易资格及历史成员覆盖仍未认证。</p>
<div class="run-actions"><button id="mainboard-screen-start" type="button" class="primary">一键分批筛选</button><button id="mainboard-screen-pause" type="button" disabled>暂停后续批次</button><button id="mainboard-screen-resume" type="button" disabled>继续未处理</button><button id="mainboard-screen-retry" type="button" disabled>重试失败批次</button></div>
<p id="mainboard-screen-status" class="panel-status" role="status" aria-live="polite" aria-atomic="true">尚未运行 · 点击后读取本次固定名单，再逐批筛选</p>
<p class="data-note">本次筛选只在此网页运行；切换工作视图会继续本次运行并保留进度。需点击暂停停止后续批次；关闭网页不会继续。网页隐藏时暂停后续批次，正在请求的一批会完成。暂停不会改变已有结果，也不会开启后台采集。</p>
<div id="mainboard-screen-ledger" class="mainboard-ledger"></div><progress id="mainboard-screen-progress" class="run-progress" value="0" max="1" hidden aria-label="已处理股票进度"></progress>
<div id="mainboard-screen-evidence" class="data-note"></div>
<div class="mainboard-filter"><label for="mainboard-screen-filter">查看结果</label><select id="mainboard-screen-filter"><option value="match">规则匹配</option><option value="risk">匹配且有过热提示</option><option value="not_match">未满足条件</option><option value="insufficient_data">数据不足 / 不可判定</option><option value="failed_without_result">批次失败，无逐项结果</option><option value="pending">尚未处理</option></select><span id="mainboard-screen-result-count" class="muted">尚无本次结果</span></div>
<div id="mainboard-screen-results" class="mainboard-results"></div><button id="mainboard-screen-more-results" type="button" hidden>显示更多结果（每次 40 只）</button>
<details class="mainboard-audit"><summary>固定参数、股票池覆盖与解释边界</summary><div id="mainboard-screen-manifest" class="data-note">名单尚未读取</div><p class="data-note">规则版本 swing-daily-v1。突破量比 ≥ 1.5；延续量比 ≥ 0.8；前高容差 5%；偏离 MA20 &gt; 12% 或近 5 日涨幅 &gt; 20% 仅提示过热，不取消规则匹配。参数为预先固定、未经收益验证的研究假设。</p><p class="data-note">腾讯前复权日 K；至少 65 根已完成、无预期交易日缺口的日线。北京时间当日 K 保守排除，前 20 日最高价和均量不含信号日。未匹配不等于没有机会，无过热标记不等于低风险；前复权价不是可直接下单的原价。</p><p class="data-note">下方仍可手动筛选指定代码或原站自选，规则与原有结果语义一致。</p></details>
</section>`;

export const mainboardScreenScript=String.raw`(()=>{
'use strict';
const el=id=>document.getElementById('mainboard-screen-'+id);if(!el('panel'))return;
const states=['match','not_match','insufficient_data','failed_without_result','pending'];
const names={match:'规则匹配',not_match:'未满足条件',insufficient_data:'数据不足 / 不可判定',failed_without_result:'批次失败，无逐项结果',pending:'尚未处理'};
const defaults={breakout_volume_ratio:1.5,continuation_volume_ratio:0.8,continuation_near_high_pct:5,max_extension_ma20_pct:12,max_return_5d_pct:20};
let generation=0,manifest=null,records=new Map(),running=false,inflight=false,pauseRequested=false,suspended=false,staleGeneration=false,visibleCount=40;
const text=v=>typeof v==='string'&&v?v:'—';
function say(message,error=false){el('status').textContent=message;el('status').className='panel-status'+(error?' error':'');}
function counts(){return Object.fromEntries(states.map(k=>[k,[...records.values()].filter(r=>r.status===k).length]));}
function controls(){const c=counts();el('start').disabled=running||inflight||suspended;el('pause').disabled=!running||pauseRequested;el('resume').disabled=!manifest||running||inflight||suspended||staleGeneration||!c.pending;el('retry').disabled=!manifest||running||inflight||suspended||staleGeneration||!c.failed_without_result;el('panel').setAttribute('aria-busy',inflight?'true':'false');}
function renderLedger(){
 if(!manifest){el('ledger').innerHTML='';el('progress').hidden=true;return;}
 const c=counts(),total=records.size,done=total-c.pending;
 if(states.reduce((sum,k)=>sum+c[k],0)!==total){running=false;pauseRequested=true;say('覆盖账本不一致，已停止；请重新开始',true);return;}
 el('ledger').innerHTML=[['已处理',done],['规则匹配',c.match],['未满足',c.not_match],['数据不足',c.insufficient_data],['批次失败',c.failed_without_result],['待执行',c.pending]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('');
 el('progress').hidden=false;el('progress').max=Math.max(1,total);el('progress').value=done;
 el('evidence').textContent='本次名单 '+total+' 只 · 完成 K 截止 '+text(manifest.expected_session_date)+' · 腾讯 / 前复权 · 规则 '+text(manifest.rules?.version)+'。名单 = 匹配 '+c.match+' + 未满足 '+c.not_match+' + 不足 '+c.insufficient_data+' + 失败 '+c.failed_without_result+' + 待执行 '+c.pending;
}
const conditions={above_ma20:'收盘高于 MA20',ma20_rising:'MA20 上升',ma60_rising:'MA60 上升',breakout_prior20:'突破前 20 日高点',breakout_volume:'突破量比达标',ma_alignment:'MA20 高于 MA60',near_prior20_high:'前高容差内',continuation_volume:'延续量比达标'};
function detail(r){
 const d=r.data,m=d?.metrics||{},checks=d?.checks||{};
 if(!d)return '<p class="data-note">'+(r.status==='pending'?'尚未请求此代码的日线；不预判结果':'本批没有有效逐项结果，尚不能判定是否匹配；可手动重试失败批次')+'</p>';
 const reasons={SOURCE_UNAVAILABLE:'来源不可用',SOURCE_TIMEOUT:'来源超时',INSUFFICIENT_COMPLETED_BARS:'完成日线不足 65 根',STALE_DAILY_HISTORY:'日线过旧',MISSING_SCHEDULED_SESSIONS:'预期交易日日线缺失',UNKNOWN_CALENDAR:'交易日历未核验',NO_RULE_MATCH:'未满足突破或延续条件',NONPOSITIVE_VOLUME_BASELINE:'成交量基数非正',BATCH_DEADLINE_EXCEEDED:'本批取数预算已用尽'};
 const checkText=c=>c?.conditions?Object.entries(c.conditions).map(([k,v])=>(conditions[k]||k)+' '+(v===true?'通过':v===false?'未通过':'未知')).join(' · '):'不可判定';
 return '<p class="data-note">完成 K：'+esc(text(d.sample?.last_date))+' · 来源 '+esc(text(d.provenance?.source))+' / '+esc(text(d.provenance?.adjustment))+' · 已用日线 '+esc(d.sample?.used_count??'—')+' 根</p><p class="data-note">前复权收盘 '+fmt(m.close)+' · MA20 '+fmt(m.ma20)+' · MA60 '+fmt(m.ma60)+' · 量比 '+fmt(m.volume_ratio20)+' · 近 5 日 '+fmt(m.return_5d_pct)+'% · 偏离 MA20 '+fmt(m.extension_ma20_pct)+'%</p><details><summary>条件、风险与来源依据</summary><p class="data-note">突破初现：'+esc(checkText(checks.emerging))+'</p><p class="data-note">趋势延续：'+esc(checkText(checks.continuation))+'</p><p class="data-note">原因：'+esc((d.reason_codes||[]).map(v=>reasons[v]||v).join('；')||'满足规则条件')+'</p><p class="data-note">风险：'+esc((d.risk_flags||[]).map(v=>v==='OVEREXTENDED_MA20'?'偏离 MA20 较大':v==='RAPID_5_BAR_ADVANCE'?'近 5 日涨幅较大':v).join('；')||'未报告过热标记，仍需核对风险')+'</p><p class="data-note">前 20 日最高价 '+fmt(m.prior_high20)+' · 前 20 日均量 '+fmt(m.prior_mean_volume20,0)+' 股 · 本日量 '+fmt(m.volume_shares,0)+' 股；比较基数不含信号日</p><p class="data-note">来源日线标签 '+esc(text(d.provenance?.source_timestamp))+' · 本次抓取 '+esc(text(d.provenance?.fetched_at))+' · 前复权历史可修订，真实停复牌和可成交性未知</p></details>';
}
function renderResults(){
 const filter=el('filter').value,rows=[...records.values()].filter(r=>filter==='risk'?r.status==='match'&&r.data?.risk_flags?.length:r.status===filter);
 // Risk flags preserve matches; show flagged matches together rather than imply a low-risk group.
 if(filter==='match')rows.sort((a,b)=>Number(Boolean(a.data?.risk_flags?.length))-Number(Boolean(b.data?.risk_flags?.length))||a.symbol.localeCompare(b.symbol));
 el('result-count').textContent=manifest?'本次 '+rows.length+' 只 · 已显示 '+Math.min(rows.length,visibleCount):'尚无本次结果';
 el('results').innerHTML=rows.slice(0,visibleCount).map(r=>'<article class="mainboard-row'+(r.data?.risk_flags?.length?' risk':'')+'"><div class="row"><h3>'+esc(r.name)+' · '+esc(r.symbol)+'</h3><span class="badge">'+names[r.status]+(r.data?.phase==='emerging'?' · 突破初现':r.data?.phase==='continuation'?' · 趋势延续':'')+(r.data?.risk_flags?.length?' · 过热提示':'')+'</span></div>'+detail(r)+'</article>').join('')||(manifest?'<p class="empty">本次此分类尚无记录；以覆盖账本为准</p>':'');
 el('more-results').hidden=visibleCount>=rows.length;
}
function render(){renderLedger();renderResults();controls();}
function validateManifest(d){
 if(!d||d.available!==true||d.source!=='sse_szse_public'||d.credential_required!==false||d.credential_reads!==false||d.universe_version!=='mainboard-public-directory-v1'||d.source_timestamp!==null||d.snapshot_timestamp_semantics!=='local_combined_directory_receipt_identifier_not_membership_effective_time'||!Array.isArray(d.items)||d.items.length>10000||d.scope!=='sh_sz_mainboard_excluding_st_names'||typeof d.manifest_hash!=='string'||!/^[a-f0-9]{64}$/.test(d.manifest_hash)||!Number.isSafeInteger(d.snapshot_timestamp)||!d.coverage||!d.rules||d.rules.version!=='swing-daily-v1'||!/^\d{4}-\d{2}-\d{2}$/.test(d.expected_session_date||''))throw Error('MANIFEST_INVALID');
 const c=d.coverage,keys=['eligible_mainboard_non_st','excluded_st_name','excluded_other_boards','unclassified','unsupported'];
 if(keys.some(k=>!Number.isSafeInteger(c[k])||c[k]<0)||keys.reduce((n,k)=>n+c[k],0)!==c.provider_rows||c.eligible_mainboard_non_st!==d.items.length||c.complete_exchange_universe!==false)throw Error('MANIFEST_INVALID');
 const seen=new Set();for(const r of d.items){if(!r||typeof r.name!=='string'||!/^(sh(600|601|603|605)\d{3}|sz(000|001|002|003|004)\d{3})$/.test(r.symbol)||(r.symbol.startsWith('sz')&&r.symbol.slice(2)>='001001'&&r.symbol.slice(2)<='001199')||/^\*?ST/i.test(r.name.normalize('NFKC').trim())||seen.has(r.symbol))throw Error('MANIFEST_INVALID');seen.add(r.symbol);}
 for(const [k,v] of Object.entries(defaults))if(d.rules.thresholds?.[k]!==v)throw Error('MANIFEST_INVALID');return d;
}
function validateBatch(d,items){
 if(!d||!Array.isArray(d.results)||d.results.length!==items.length||d.universe?.kind!=='explicit'||d.universe.returned!==items.length)throw Error('BATCH_INVALID');
 if(d.rules?.version!==manifest.rules.version)throw Error('BATCH_GENERATION_CHANGED');
 for(const [k,v] of Object.entries(defaults))if(d.rules.thresholds?.[k]!==v)throw Error('BATCH_GENERATION_CHANGED');
 const expected=new Set(items.map(r=>r.symbol)),seen=new Set();
 const stringArray=v=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length<=200);
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const conditionKeys={emerging:['above_ma20','ma20_rising','breakout_prior20','breakout_volume'],continuation:['above_ma20','ma20_rising','ma_alignment','ma60_rising','near_prior20_high','continuation_volume']};
 for(const r of d.results){
  if(!r||!expected.has(r.symbol)||seen.has(r.symbol)||!['match','not_match','insufficient_data'].includes(r.status)||!stringArray(r.risk_flags)||!stringArray(r.reason_codes))throw Error('BATCH_INVALID');seen.add(r.symbol);
  const cutoff=r.freshness?.expected_session_date;if(cutoff&&cutoff!==manifest.expected_session_date)throw Error('BATCH_GENERATION_CHANGED');
  if(r.status==='insufficient_data'){
   const nullableString=v=>v===null||typeof v==='string';
   if(!r.reason_codes.length||r.phase!==null||r.metrics!==null||r.checks!==null||!r.freshness||!(cutoff===null||cutoff===manifest.expected_session_date))throw Error('BATCH_INVALID');
   if(r.sample!==null){const sample=r.sample;if(!sample||typeof sample!=='object'||Array.isArray(sample)||!Number.isSafeInteger(sample.used_count)||sample.used_count<0||sample.used_count>65||!(sample.last_date===null||typeof sample.last_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(sample.last_date)))throw Error('BATCH_INVALID');}
   if(r.provenance!==null){const p=r.provenance;if(!p||typeof p!=='object'||Array.isArray(p)||['source','adjustment','fetched_at','source_timestamp'].some(k=>!nullableString(p[k])))throw Error('BATCH_INVALID');}
   continue;
  }
  if(cutoff!==manifest.expected_session_date||!r.sample||r.sample.last_date!==manifest.expected_session_date||r.sample.used_count!==65||r.provenance?.source!=='tencent'||r.provenance?.adjustment!=='qfq'||typeof r.provenance.source_timestamp!=='string'||!Number.isFinite(Date.parse(r.provenance.source_timestamp))||typeof r.provenance.fetched_at!=='string'||!Number.isFinite(Date.parse(r.provenance.fetched_at)))throw Error('BATCH_INVALID');
  const m=r.metrics;if(!m||['close','ma20','ma60','prior_high20','volume_shares','prior_mean_volume20','volume_ratio20','return_5d_pct','extension_ma20_pct'].some(k=>!finite(m[k]))||['close','ma20','ma60','prior_high20','prior_mean_volume20'].some(k=>m[k]<=0)||m.volume_shares<0||m.volume_ratio20<0)throw Error('BATCH_INVALID');
  for(const [key,keys] of Object.entries(conditionKeys)){const check=r.checks?.[key];if(!check||typeof check.matched!=='boolean'||!check.conditions||keys.some(k=>typeof check.conditions[k]!=='boolean')||check.matched!==keys.every(k=>check.conditions[k]))throw Error('BATCH_INVALID');}
  const phase=r.checks.continuation.matched?'continuation':r.checks.emerging.matched?'emerging':null;
  if(r.phase!==phase||r.status!==(phase?'match':'not_match'))throw Error('BATCH_INVALID');
 }
 return d.results;
}
async function run(retry=false){
 if(inflight||running||suspended||staleGeneration||!manifest)return;running=true;pauseRequested=false;const token=generation;render();
 while(running&&!pauseRequested&&!suspended&&token===generation){
  const items=[...records.values()].filter(r=>r.status===(retry?'failed_without_result':'pending')).slice(0,20);if(!items.length)break;
  inflight=true;say((retry?'正在重试失败批次':'正在筛选下一批')+' · 本批 '+items.length+' 只 · 每批完成后再启动下一批');controls();
  try{const {d}=await api('get_swing_screen',{universe:'explicit',symbols:items.map(r=>r.symbol)});if(token!==generation)return;const results=validateBatch(d,items);for(const r of results){const previous=records.get(r.symbol);records.set(r.symbol,{...previous,status:r.status,data:r});}}
  catch(error){if(token!==generation)return;const changed=error?.message==='BATCH_GENERATION_CHANGED';if(changed)staleGeneration=true;for(const item of items)records.set(item.symbol,{...item,status:'failed_without_result',data:null});pauseRequested=true;say(changed?'截止日或参数版本已变化，已暂停；本次结果未混入新代次，请重新开始':'本批未取得完整逐项结果，已暂停；失败与待执行分别保留，可手动继续或重试',true);}
  finally{inflight=false;if(token===generation)render();else controls();}
 }
 if(token!==generation)return;running=false;const c=counts();
 if(!pauseRequested&&!suspended)say(c.pending||c.failed_without_result?'本次尚未全部判定 · 失败 '+c.failed_without_result+' 只 / 待执行 '+c.pending+' 只，可手动处理':'本次名单已全部处理 · 规则匹配 '+c.match+' 只；目录覆盖与证券状态仍未认证');
 else if(!el('status').className.includes('error'))say(c.pending?'已暂停后续批次 · 已有结果保留，点击继续未处理':'本次请求已结束 · 以覆盖账本为准');render();
}
el('start').addEventListener('click',async()=>{
 if(running||inflight||suspended)return;if(manifest&&!window.confirm('重新读取股票池并开始新一轮筛选？本页旧结果与进度会被替换。不会修改自选或后台采集。'))return;
 const token=++generation;manifest=null;records=new Map();visibleCount=40;inflight=true;pauseRequested=false;staleGeneration=false;render();say('正在读取一次有界来源目录，生成本次固定股票池…');
 try{const {d}=await api('get_mainboard_universe',{});if(token!==generation)return;if(d?.available===false){say('公开目录本次不可用，未开始筛选；无需个人 key，可稍后手动重试',true);return;}manifest=validateManifest(d);for(const r of manifest.items)records.set(r.symbol,{symbol:r.symbol,name:r.name,status:'pending',data:null});const c=manifest.coverage;el('manifest').textContent='来源 沪深交易所公开目录'+' · 来源有效时间未统一提供 · 本次公开目录接收 '+text(manifest.fetched_at)+' · 股票池版本 '+text(manifest.universe_version)+' · 摘要 '+manifest.manifest_hash+'。来源记录 '+c.provider_rows+' = 主板入围 '+c.eligible_mainboard_non_st+' + ST 名称排除 '+c.excluded_st_name+' + 其他板块 '+c.excluded_other_boards+' + 未分类 '+c.unclassified+' + 暂不支持 '+c.unsupported+'。'+(manifest.sources||[]).map(s=>(s.id==='sse_public_mainboard'?'上交所':'深交所')+'目录日期 '+(s.source_effective_date||'未提供')).join(' / ')+'。当前来源数量已对账，历史成员与原子快照未认证；不可沿用旧 HiThink 股票池数量。'+(manifest.cache?.used?' · 缓存目录：'+(manifest.cache.kind==='stale_fallback'?'刷新失败，非最新':'仍在缓存期')+'，原始接收时间保留':'');}
 catch{if(token===generation)say('股票池响应不完整或边界未通过校验，未运行筛选；不能显示为 0 只入选',true);}
 finally{inflight=false;render();}
 if(manifest&&token===generation){if(document.hidden){pauseRequested=true;say('网页已隐藏，本次名单已保留；返回后点击继续未处理');render();}else await run(false);}
});
el('pause').addEventListener('click',()=>{if(!running)return;pauseRequested=true;say(inflight?'暂停已请求 · 正在读取的一批完成后停止，不启动新批次':'已暂停后续批次');controls();});
el('resume').addEventListener('click',()=>run(false));el('retry').addEventListener('click',()=>run(true));
el('filter').addEventListener('change',()=>{visibleCount=40;renderResults();});el('more-results').addEventListener('click',()=>{visibleCount+=40;renderResults();});
document.addEventListener?.('visibilitychange',()=>{if(document.hidden&&running){pauseRequested=true;say('网页已隐藏，正在请求的一批完成后暂停；返回后请手动继续');controls();}});
window.addEventListener('pagehide',()=>{suspended=true;pauseRequested=true;generation++;running=false;render();});window.addEventListener('pageshow',()=>{suspended=false;controls();});controls();
})();`;
