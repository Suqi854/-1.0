// Manual-only, read-only panel. Insert the markup into page.mjs and the script
// after the workbench's api / esc / fmt / friendly helpers have been defined.
export const swingScreenPanel=String.raw`<section class="card sources swing-screen" id="swing-screen-panel" aria-labelledby="swing-screen-title">
<style>
.swing-screen{margin:18px 0;border-top:2px solid var(--green)}.swing-screen .desk-label{margin-bottom:5px}.swing-screen .swing-field{display:grid;gap:6px;margin:14px 0}.swing-screen select{max-width:100%;min-height:44px}.swing-screen textarea{box-sizing:border-box;display:block;width:100%;max-width:680px;min-height:94px;resize:vertical;font:inherit;line-height:1.6;color:var(--ink);background:#20313d;border:1px solid #3b515f;border-radius:7px;padding:10px 12px}.swing-screen textarea:focus-visible{outline:3px solid #70b9e4;outline-offset:2px}.swing-screen button{min-height:44px}.swing-screen .swing-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.swing-screen .swing-status{overflow-wrap:anywhere;min-height:24px}.swing-screen .swing-results{display:grid;gap:12px;margin-top:14px}.swing-screen .swing-result{border:1px solid var(--line);border-radius:11px;padding:15px;min-width:0}.swing-screen .swing-result[data-status="match"]{border-left:3px solid var(--green)}.swing-screen .swing-result[data-status="insufficient_data"]{border-left:3px solid var(--gold)}.swing-screen .swing-result h3{overflow-wrap:anywhere}.swing-screen .swing-result .badge{white-space:normal}.swing-screen .swing-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}.swing-screen .swing-metrics div{min-width:0}.swing-screen dt{font-size:12px;color:var(--muted)}.swing-screen dd{margin:2px 0 0;overflow-wrap:anywhere;font-size:15px}.swing-screen .swing-reasons{margin:9px 0 0;font-size:14px;overflow-wrap:anywhere}.swing-screen .swing-risk{color:var(--gold)}.swing-screen summary{min-height:44px;padding:10px 0}.swing-screen .swing-rule-list{padding-left:22px;color:var(--muted);line-height:1.8}.swing-screen .swing-evidence{border-top:1px solid var(--line);padding-top:7px}.swing-screen .swing-evidence p{overflow-wrap:anywhere}.swing-screen pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:var(--muted)}.swing-screen [hidden]{display:none!important}@media(max-width:760px){.swing-screen .swing-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.swing-screen .swing-actions{display:grid;grid-template-columns:1fr}.swing-screen .swing-actions button{width:100%}.swing-screen .swing-result{padding:12px}}
</style>
<div class="row"><div><div class="desk-label">SWING · 趋势观察</div><h2 id="swing-screen-title">波段趋势筛选</h2></div><span class="badge">手动运行 · 每批最多 20 只</span></div>
<p class="data-note">先看趋势，再区分突破与延续。只在你指定的代码或原站自选中筛选，不扫描全市场；入选仅表示满足本次条件，不保证主升浪或未来收益。</p><p class="data-note">所有价格指标均为前复权研究价，不是可直接下单的未复权价位。</p>
<form id="swing-screen-form">
<div class="swing-field"><label for="swing-screen-mode">筛选范围</label><select id="swing-screen-mode" aria-describedby="swing-screen-scope"><option value="explicit">我输入的股票代码</option><option value="original_watchlist">原站已保存自选</option></select></div>
<p id="swing-screen-scope" class="data-note">只读查询，不修改自选；原站自选与云端自选独立，此面板不读取云端。</p>
<div id="swing-screen-input-group" class="swing-field"><label for="swing-screen-symbols">股票代码</label><textarea id="swing-screen-symbols" rows="3" maxlength="4096" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入六位 A 股代码或带 sh / sz / bj 的代码，用逗号、空格或换行分隔" aria-describedby="swing-screen-input-note swing-screen-status"></textarea><small id="swing-screen-input-note">尚未输入代码 · 每次最多 20 个，不按名称猜代码</small></div>
<div class="swing-actions"><button id="swing-screen-run" type="submit" class="primary">筛选这些代码</button><button id="swing-screen-more" type="button" hidden>筛选下一批（最多 20 只）</button></div>
</form>
<div id="swing-screen-status" class="panel-status swing-status" role="status" aria-live="polite" aria-atomic="true">尚未筛选 · 输入代码或选择原站自选后手动运行</div>
<div id="swing-screen-summary" class="data-note"></div>
<div id="swing-screen-results" class="swing-results" aria-label="本批波段筛选结果"></div>
<details><summary>筛选规则、数据口径与局限</summary><ul class="swing-rule-list"><li>采用腾讯前复权日 K，至少需要 65 条已完成日线；前 20 日高点和均量均不含本次完成日。</li><li>突破初现：收盘 &gt; MA20、MA20 高于 5 个交易日前、收盘突破前 20 日最高价，且量比 ≥ 1.5 倍。</li><li>趋势延续：收盘 &gt; MA20 &gt; MA60、两条均线均高于 5 个交易日前、收盘不低于前 20 日高点的 95%，且量比 ≥ 0.8 倍。两类都通过时展示“趋势延续”，明细保留两类检查。</li><li>默认过热门槛：偏离 MA20 超过 12%，或近 5 日涨幅超过 20%。风险标记单独显示，不会自动剔除入选股；不是价格目标或买卖指令。</li><li>只用已完成日线；核验交易日的北京时间 15:30:03 之后，来源已返回当日日线时可纳入。时间安排推定完成，来源最终修订仍未知；若来源未更新，数据截止日会早于今天。</li><li>前复权历史可能随除权除息修订。当前规则未经历史回测验证，不提供胜率、收益率或未来预测。</li><li>当前选定代码或自选池可能遗漏历史上未在池内或已退市的股票，存在选样与幸存者偏差，不构成无偏历史回测。</li><li>停复牌、涨跌停可成交性及实际交易资格未知；缺失、过旧或不足的数据需单独核对，不能当成未入选或零值。</li></ul><div id="swing-screen-rules"></div></details>
</section>`;

export const swingScreenScript=String.raw`(()=>{
'use strict';
const el=id=>document.getElementById('swing-screen-'+id);
if(!el('panel'))return;
const statusNames={match:'条件入选',not_match:'未满足条件',insufficient_data:'数据不足 / 不可判定'};
const phaseNames={emerging:'突破初现',continuation:'趋势延续'};
const reasonNames={TREND_NOT_MET:'趋势条件未满足',BREAKOUT_NOT_MET:'突破条件未满足',CONTINUATION_NOT_MET:'延续条件未满足',INSUFFICIENT_BARS:'已完成日线不足',INSUFFICIENT_HISTORY:'已完成日线不足',STALE_HISTORY:'日线过旧',SOURCE_FAILED:'行情来源失败',INVALID_HISTORY:'日线数据未通过校验',OVEREXTENDED_MA20:'偏离 MA20 较大',EXTENDED_FROM_MA20:'偏离 MA20 较大',HIGH_5D_RETURN:'近 5 日涨幅较大',OVERHEATED_5D:'近 5 日涨幅较大',RAPID_5_BAR_ADVANCE:'近 5 日涨幅较大',NO_RULE_MATCH:'未满足突破初现或趋势延续条件',SOURCE_UNAVAILABLE:'行情来源不可用',STALE_DAILY_HISTORY:'日线过旧',UNKNOWN_CALENDAR:'交易日历未核验',INSUFFICIENT_COMPLETED_BARS:'已完成日线不足 65 条',MISSING_SCHEDULED_SESSIONS:'应有交易日日线缺失',NONPOSITIVE_VOLUME_BASELINE:'成交量比较基数非正数'};
const warningNames={DESCRIPTIVE_RULES_NOT_VALIDATED_TRADING_EDGE:'规则未经交易优势验证',NOT_FULL_MARKET_SCREEN:'仅本次代码或原站自选批次，不是全市场筛选',NO_MATCH_IS_NOT_NO_OPPORTUNITY:'未入选不代表没有机会',QFQ_HISTORY_CAN_BE_REVISED:'前复权历史可修订，不是当时可得历史或收益回测',QFQ_PRICES_AND_UNADJUSTED_VOLUME:'价格前复权、成交量不复权；除权除息可能影响量比',SCHEDULE_INFERRED_POSTCLOSE_BARS:'按已核验交易日历与盘后边界推定完成；来源最终修订仍未知，不是实时报价',SUSPENSION_TRADABILITY_AND_SECURITY_SPECIFIC_LIMITS_UNVERIFIED:'停复牌、可成交性及个股涨跌停规则未核验',UNOFFICIAL_PUBLIC_FEED:'非官方公开行情，最终性与再分发许可未核验',HISTORY_REORDERED_CHRONOLOGICALLY:'历史数据已按日期重新排序',OLDER_ROWS_OUTSIDE_VERIFIED_CALENDAR_EXCLUDED:'已排除核验交易日历范围外的较早数据'};
const freshnessNames={current:'截止日符合预期',recent:'近期数据',fresh:'截止日符合预期',latest_completed_adjusted_session:'最新已完成前复权交易日',stale:'数据过旧',unknown:'时效未知',unavailable:'时效不可用'};
let busy=false,generation=0,nextAfter=null,batchNumber=0,suspended=false;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=(v,d=2,suffix='')=>finite(v)?fmt(v,d)+suffix:'—';
const text=v=>typeof v==='string'&&v.trim()?v:'—';
const codeText=v=>typeof v==='string'?(Object.hasOwn(reasonNames,v)?reasonNames[v]:Object.hasOwn(warningNames,v.split(';')[0])?warningNames[v.split(';')[0]]:v):'未知标记';
const listText=v=>Array.isArray(v)?v.map(codeText).join('；'):'';
function symbolCode(value){let s=value.trim().toLowerCase().replace(/^(\d{6})\.(sh|sz|bj)$/,'$2$1');if(/^\d{6}$/.test(s))s=(/^6/.test(s)?'sh':/^[489]/.test(s)?'bj':'sz')+s;return /^(sh(600|601|603|605|688|689)\d{3}|sz(000|001|002|003|004|300|301)\d{3}|bj[489]\d{5})$/.test(s)?s:null;}
function tokens(){return el('symbols').value.trim().split(/[,，\s]+/).filter(Boolean);}
function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return '—';const date=new Date(value);return Number.isFinite(+date)?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':'—';}
function dateText(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'—';}
function say(message,error=false){el('status').textContent=message;el('status').className='panel-status swing-status'+(error?' error':'');}
function controls(){el('run').disabled=busy||suspended;el('more').disabled=busy||suspended;el('more').hidden=el('mode').value!=='original_watchlist'||!nextAfter;el('panel').setAttribute('aria-busy',busy?'true':'false');}
function clear(){el('results').innerHTML='';el('summary').textContent='';el('rules').innerHTML='';}
function invalidate(message){generation++;busy=false;nextAfter=null;batchNumber=0;clear();say(message);controls();}
function updateMode(){const original=el('mode').value==='original_watchlist';el('input-group').hidden=original;el('run').textContent=original?'筛选原站自选（从首批开始）':'筛选这些代码';invalidate('范围已变更 · 请手动筛选；不会自动读取或刷新');}
function metric(label,value){return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';}
function checkText(value){if(value===true)return '通过';if(value===false)return '未通过';if(value&&typeof value==='object'){if(value.matched===true)return '通过';if(value.matched===false)return '未通过';if(value.pass===true)return '通过';if(value.pass===false)return '未通过';if(value.passed===true)return '通过';if(value.passed===false)return '未通过';}return '不可判定';}
const conditionNames={above_ma20:'收盘高于 MA20',ma20_rising:'MA20 高于 5 个交易日前',ma60_rising:'MA60 高于 5 个交易日前',breakout_prior20:'收盘突破前 20 日高点',breakout_volume:'突破量比达标',ma_alignment:'MA20 高于 MA60',near_prior20_high:'位于前高容差内',continuation_volume:'延续量比达标'};
function checkDetails(label,check){const conditions=check?.conditions;return '<p class="data-note">'+esc(label)+'：'+esc(checkText(check))+(conditions&&typeof conditions==='object'?'；'+Object.entries(conditions).map(([key,value])=>esc(conditionNames[key]||key)+' '+esc(checkText(value))).join(' · '):'')+'</p>';}
function card(row){
 const m=row.metrics||{},s=row.sample||{},p=row.provenance||{},f=row.freshness||{},c=row.checks||{};
 const badge=statusNames[row.status]+(phaseNames[row.phase]?' · '+phaseNames[row.phase]:'');
 const reasons=listText(row.reason_codes),risks=listText(row.risk_flags),warnings=listText(row.warnings);
 return '<article class="swing-result" data-status="'+esc(row.status)+'"><div class="row"><h3>'+esc(row.symbol)+(row.name?' · '+esc(row.name):'')+'</h3><span class="badge">'+esc(badge)+'</span></div>'+
  '<p class="data-note">完成日：'+esc(dateText(s.last_date))+' · '+esc(p.source==='tencent'?'腾讯':text(p.source))+' / '+esc(p.adjustment==='qfq'?'前复权':text(p.adjustment))+' · 使用 '+number(s.used_count,0)+' 条日线</p>'+
  '<p class="swing-reasons">'+esc(reasons||(row.status==='match'?'条件明细见下方':'本次缺少原因说明，请核对来源'))+'</p>'+
  '<p class="swing-reasons swing-risk">风险标记：'+esc(risks||(row.status==='insufficient_data'?'数据不足，无法评估风险标记':'未报告标记，仍需自行核对'))+'</p>'+
  '<dl class="swing-metrics">'+[
   ['前复权收盘（元）',number(m.close)],['相对前 20 日量比',number(m.volume_ratio20,2,' 倍')],['近 5 日涨跌',number(m.return_5d_pct,2,'%')],['偏离 MA20',number(m.extension_ma20_pct,2,'%')]
  ].map(([k,v])=>metric(k,v)).join('')+'</dl><details class="swing-evidence"><summary>指标、样本与来源明细</summary><dl class="swing-metrics">'+[
   ['前复权 MA20（元）',number(m.ma20)],['前复权 MA60（元）',number(m.ma60)],['MA20 近 5 日变化',number(m.ma20_change_5d_pct,2,'%')],['前复权前 20 日高点（元）',number(m.prior_high20)],['完成日成交量（股）',number(m.volume_shares,0)],['前 20 日均量（股）',number(m.prior_mean_volume20,0)],['突破初现检查',checkText(c.emerging)],['趋势延续检查',checkText(c.continuation)]
  ].map(([k,v])=>metric(k,v)).join('')+'</dl>'+checkDetails('突破初现条件',c.emerging)+checkDetails('趋势延续条件',c.continuation)+
  '<p class="data-note">样本：来源 '+number(s.input_count,0)+' 条 / 已完成 '+number(s.completed_count,0)+' 条 / 使用 '+number(s.used_count,0)+' 条；区间 '+dateText(s.first_date)+' 至 '+dateText(s.last_date)+'；排除未完成 '+number(s.excluded_incomplete,0)+' 条，排除当日 '+number(s.excluded_current_date,0)+' 条</p>'+
  (Array.isArray(s.missing_scheduled_dates)&&s.missing_scheduled_dates.length?'<p class="data-note swing-risk">缺失的预期交易日：'+esc(s.missing_scheduled_dates.map(dateText).join('、'))+'。缺失原因未核验，可能是停牌或来源缺口，不推断为无机会。</p>':'')+
  '<p class="data-note">来源：'+esc(p.source==='tencent'?'腾讯':text(p.source))+' · 复权：'+esc(p.adjustment==='qfq'?'前复权（qfq）':text(p.adjustment))+' · 抓取时间：'+esc(timestamp(p.fetched_at))+' · 来源日线标签时间：'+esc(timestamp(p.source_timestamp))+'</p>'+
  '<p class="data-note">时效：'+esc(freshnessNames[f.status]||text(f.status))+' · 预期交易日：'+esc(dateText(f.expected_session_date))+'</p>'+
  (warnings?'<p class="data-note swing-risk">数据提示：'+esc(warnings)+'</p>':'')+'</details></article>';
}
function validResponse(d,args){
 if(!d||!Array.isArray(d.results)||d.results.length>20||!d.universe||d.universe.kind!==args.universe||d.universe.returned!==d.results.length||!Number.isSafeInteger(d.universe.total)||d.universe.total<d.results.length||typeof d.universe.has_more!=='boolean')throw Error('SWING_RESPONSE_INVALID');
 if(args.universe==='original_watchlist'&&d.universe.storage_source!=='original')throw Error('SWING_RESPONSE_INVALID');
 const seen=new Set(),requested=args.symbols?new Set(args.symbols.map(symbolCode)):null;
 for(const row of d.results){if(!row||typeof row.symbol!=='string'||!symbolCode(row.symbol)||row.symbol!==symbolCode(row.symbol)||!Object.hasOwn(statusNames,row.status)||seen.has(row.symbol)||(requested&&!requested.has(row.symbol)))throw Error('SWING_RESPONSE_INVALID');seen.add(row.symbol);}
 if(requested&&seen.size!==requested.size)throw Error('SWING_RESPONSE_INVALID');
 if(d.universe.has_more&&(args.universe!=='original_watchlist'||typeof d.universe.next_after!=='string'||symbolCode(d.universe.next_after)!==d.universe.next_after||d.universe.next_after===args.after||d.results.length===0))throw Error('SWING_RESPONSE_INVALID');
 return d;
}
function render(d){
 const counts={match:0,not_match:0,insufficient_data:0};for(const row of d.results)counts[row.status]++;
 const order={match:0,not_match:1,insufficient_data:2};
 el('results').innerHTML=d.results.slice().sort((a,b)=>order[a.status]-order[b.status]).map(card).join('');
 el('summary').textContent='本批：条件入选 '+counts.match+' · 未满足 '+counts.not_match+' · 数据不足 / 不可判定 '+counts.insufficient_data+'。结果不会自动刷新。';
 el('rules').innerHTML=d.rules&&typeof d.rules==='object'?'<p class="data-note">本次服务端参数与公式（原值）</p><pre>'+esc(JSON.stringify({defaults:d.rules.defaults,thresholds:d.rules.thresholds,formulas:d.rules.formulas},null,2))+'</pre>':'';
 const universe=d.universe,scope=universe.kind==='original_watchlist'?'原站自选 · 第 '+batchNumber+' 批 · 列表共 '+universe.total+' 只':'指定代码 · 去重后 '+d.results.length+' 只';
 const asOf=/^\d{4}-\d{2}-\d{2}$/.test(d.as_of||'')?dateText(d.as_of):timestamp(d.as_of);
 say(d.results.length?scope+' · 本批 '+d.results.length+' 只 · 计算截至 '+asOf+(universe.has_more?' · 还有下一批，请手动继续':' · 本次范围已处理完'):universe.kind==='original_watchlist'?'原站自选本批为空；原站与云端自选独立，不会改用云端列表':'本次未返回股票结果',false);
}
async function run(more=false){
 if(busy||suspended)return;
 const kind=el('mode').value;let args;
 if(kind==='explicit'){
  const input=tokens();if(!input.length){say('请先输入股票代码；不会默认代选股票',true);return;}if(input.length>20){say('每次最多输入 20 个代码；请分批筛选（当前 '+input.length+' 个）',true);return;}
  if(input.some(value=>!symbolCode(value))){say('含有不支持的代码。请只输入六位 A 股代码或 sh / sz / bj 前缀，不按名称猜代码',true);return;}
  args={universe:'explicit',symbols:input.map(symbolCode)};
 }else if(kind==='original_watchlist'){args={universe:'original_watchlist'};if(more){if(!nextAfter)return;args.after=nextAfter;}}else{say('请选择有效的筛选范围',true);return;}
 const token=++generation,oldBatch=batchNumber;busy=true;clear();say('正在读取已完成日线并筛选；只在本次范围内查询…');controls();
 try{const {d}=await api('get_swing_screen',args);if(token!==generation||suspended)return;validResponse(d,args);batchNumber=more?oldBatch+1:1;nextAfter=d.universe.has_more?d.universe.next_after:null;render(d);}
 catch(error){if(token!==generation||suspended)return;say(error?.message==='SWING_RESPONSE_INVALID'?'本次响应不完整或范围不一致，无法判定；未把错误显示为 0 只入选':'筛选失败：'+friendly(error)+'；本次没有可用的筛选结果',true);if(!more)nextAfter=null;}
 finally{if(token===generation){busy=false;controls();}}
}
el('form').addEventListener('submit',event=>{event.preventDefault();return run(false);});
el('more').addEventListener('click',()=>run(true));
el('mode').addEventListener('change',updateMode);
el('symbols').addEventListener('input',()=>{const count=tokens().length;el('input-note').textContent='已输入 '+count+' 个 · 每次最多 20 个，不按名称猜代码';invalidate('输入已变更 · 请重新手动筛选，旧结果已清除');});
window.addEventListener('stock-directory-selection',event=>{const input=event?.detail?.symbols;if(suspended||!Array.isArray(input)||input.length<1||input.length>20||input.some(value=>typeof value!=='string'||symbolCode(value)!==value)||new Set(input).size!==input.length)return;el('mode').value='explicit';el('input-group').hidden=false;el('run').textContent='筛选这些代码';el('symbols').value=input.join('\n');el('input-note').textContent='已填入 '+input.length+' 个目录代码 · 请手动筛选';invalidate('目录代码已填入 · 尚未运行筛选，证券状态仍未核实');el('panel').scrollIntoView?.({behavior:'smooth',block:'start'});});
window.addEventListener('pagehide',()=>{suspended=true;invalidate('页面已离开 · 返回后请重新手动筛选');});
window.addEventListener('pageshow',()=>{suspended=false;controls();});
controls();
})();`;
