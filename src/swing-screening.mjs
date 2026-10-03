// Deterministic, descriptive daily rules. No optimization, orders, storage writes or timers.
import {MARKET_CALENDAR,tradingDay,periodCompletion,securityStatus,latestCompletedPeriod} from './market-session.mjs';
export const SWING_LIMITS=Object.freeze({symbols:20,concurrency:3,deadline_ms:24000,source_timeout_ms:6500,requested_bars:200,minimum_bars:65});
export const SWING_DEFAULTS=Object.freeze({breakout_volume_ratio:1.5,continuation_volume_ratio:0.8,continuation_near_high_pct:5,max_extension_ma20_pct:12,max_return_5d_pct:20});
const BOUNDS={breakout_volume_ratio:[1,5],continuation_volume_ratio:[0.1,5],continuation_near_high_pct:[0,20],max_extension_ma20_pct:[1,50],max_return_5d_pct:[1,100]};
export const swingThresholdSchema={type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(BOUNDS).map(([key,[minimum,maximum]])=>[key,{type:'number',minimum,maximum,default:SWING_DEFAULTS[key]}]))};
export const SWING_FORMULAS=Object.freeze({
 ma:'MA_n[t] = arithmetic mean of the n completed closes ending at t; fixed periods 20 and 60',
 ma_slope:'MA_n[t] > MA_n[t-5]; 5 observed completed sessions, not calendar days',
 prior_high20:'max(high[t-20], ..., high[t-1]); signal bar excluded',
 volume_ratio20:'volume_shares[t] / mean(volume_shares[t-20], ..., volume_shares[t-1]); signal bar excluded; baseline must be positive',
 emerging:'close > MA20 AND MA20[t] > MA20[t-5] AND close > prior_high20 AND volume_ratio20 >= breakout_volume_ratio',
 continuation:'close > MA20 > MA60 AND MA20[t] > MA20[t-5] AND MA60[t] > MA60[t-5] AND close >= prior_high20 * (1 - continuation_near_high_pct / 100) AND volume_ratio20 >= continuation_volume_ratio',
 classification:'continuation has priority when both predicates match; otherwise emerging; each predicate stays visible',
 return_5d_pct:'100 * (close[t] / close[t-5] - 1)',
 extension_ma20_pct:'100 * (close[t] / MA20[t] - 1)',
 risk_flags:'flag, do not suppress a match: extension_ma20_pct > max_extension_ma20_pct; return_5d_pct > max_return_5d_pct'
});
const WARNINGS=Object.freeze(['DESCRIPTIVE_RULES_NOT_VALIDATED_TRADING_EDGE','NOT_FULL_MARKET_SCREEN; only the supplied or original-watchlist batch','NO_MATCH_IS_NOT_NO_OPPORTUNITY','QFQ_HISTORY_CAN_BE_REVISED; not point-in-time history or a profitability backtest','QFQ_PRICES_ARE_RESEARCH_VALUES; not unadjusted executable order prices','CURRENT_CHOSEN_UNIVERSE; historical delisted and absent stocks not included; survivorship bias unverified','QFQ_PRICES_AND_UNADJUSTED_VOLUME; corporate actions can distort volume ratios','SCHEDULE_INFERRED_POSTCLOSE_BARS; source final revisions unknown; not live quotes','SUSPENSION_TRADABILITY_AND_SECURITY_SPECIFIC_LIMITS_UNVERIFIED','UNOFFICIAL_PUBLIC_FEED; finality and redistribution license unverified']);
const DAY=86400000,cnDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10),addDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const mean=rows=>rows.reduce((sum,v)=>sum+v,0)/rows.length;
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function swingThresholds(value={}){if(!plain(value)||Object.keys(value).some(k=>!Object.hasOwn(BOUNDS,k)))throw Error('INVALID_SWING_THRESHOLDS');for(const [key,v] of Object.entries(value)){const [min,max]=BOUNDS[key];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('INVALID_SWING_THRESHOLD_'+key);}return {...SWING_DEFAULTS,...value};}
export function validateSwingArguments(a,normalize){
 if(!plain(a)||Object.keys(a).some(k=>!['universe','symbols','after','thresholds'].includes(k)))throw Error('INVALID_SWING_ARGUMENTS');
 const kind=a.universe??'explicit',thresholds=swingThresholds(a.thresholds);
 if(!['explicit','original_watchlist'].includes(kind))throw Error('INVALID_SWING_UNIVERSE');
 if(kind==='original_watchlist'){if(a.symbols!==undefined)throw Error('WATCHLIST_SCREEN_FORBIDS_SYMBOLS');return {kind,after:a.after===undefined?'':normalize(a.after),thresholds};}
 if(a.after!==undefined||!Array.isArray(a.symbols)||a.symbols.length<1||a.symbols.length>SWING_LIMITS.symbols)throw Error('SWING_SYMBOLS_MUST_HAVE_1_TO_20_ITEMS');
 // Invalid symbols are per-input results; no names guessed and no URL accepted.
 const seen=new Set(),items=[];
 for(const input of a.symbols){if(typeof input!=='string'||input.length>40)throw Error('INVALID_SWING_SYMBOL_INPUT');try{const s=normalize(input);if(!seen.has(s)){seen.add(s);items.push({symbol:s});}}catch{items.push({symbol:null,input,error:'INVALID_SYMBOL'});}}
 return {kind,items,requested_count:a.symbols.length,deduplicated_count:a.symbols.length-items.length,thresholds};
}
export function expectedSwingSession(now){return latestCompletedPeriod(now,'1d');}
export function unavailableSwing(symbol,reason,extra={}){return {symbol,status:'insufficient_data',phase:null,reason_codes:[reason],metrics:null,checks:null,risk_flags:[],sample:null,provenance:null,freshness:{status:'unknown',expected_session_date:null},security_status:securityStatus(),warnings:[...WARNINGS],...extra};}
export function evaluateSwingHistory(data,{symbol=data?.symbol,now=Date.now(),thresholds={}}={}){
 const t=swingThresholds(thresholds),today=cnDate(now),expected=expectedSwingSession(now);
 let out=unavailableSwing(symbol,'INVALID_HISTORY',{freshness:{status:expected?'unavailable':'unknown',expected_session_date:expected,as_of:new Date(now).toISOString(),basis:'latest verified scheduled trading session after the conservative 15:30:03 boundary',calendar_version:MARKET_CALENDAR.calendar_version},provenance:{source:data?.source??null,adjustment:data?.adjustment??null,fetched_at:data?.fetched_at??null,source_timestamp:null,volume_basis:data?.unit_notes?.volume??null,point_in_time:false,source_timestamp_is_bar_label:true,source_finality:'unknown',price_basis:'Tencent qfq adjusted research values, not executable raw prices'}});
 const fail=(reason,extra={})=>({...out,reason_codes:[reason],...extra});
 if(!data||data.symbol!==symbol||data.source!=='tencent'||data.adjustment!=='qfq'||data.interval!=='1d'||data.cache?.used||!Array.isArray(data.bars)||data.bars.length>SWING_LIMITS.requested_bars)return fail('INVALID_HISTORY_BASIS');
 let excludedCurrent=0,excludedFuture=0,excludedIncomplete=0,excludedUnknown=0,reordered=false;const seen=new Set(),eligible=[];let previous='';
 for(const b of data.bars){
  if(!plain(b)||!validDate(b.date)||typeof b.source_timestamp!=='string'||!Number.isFinite(Date.parse(b.source_timestamp))||cnDate(Date.parse(b.source_timestamp))!==b.date)return fail('INVALID_HISTORY_DATE');
  // Future/current observations cannot affect indicators at this frozen cutoff.
  if(b.date>today){excludedFuture++;continue;}if(b.date===today&&periodCompletion(b.date,'1d',now)!==true){excludedCurrent++;continue;}
  if(seen.has(b.date))return fail('DUPLICATE_HISTORY_DATE');seen.add(b.date);if(previous&&b.date<previous)reordered=true;previous=b.date;
  if((b.source!==undefined&&b.source!=='tencent')||(b.adjustment!==undefined&&b.adjustment!=='qfq'))return fail('MIXED_HISTORY_BASIS');
  if(tradingDay(b.date)===null){excludedUnknown++;continue;}if(tradingDay(b.date)===false)return fail('BAR_ON_NONTRADING_DATE');
  if(b.complete!==true||periodCompletion(b.date,'1d',now)!==true){excludedIncomplete++;continue;}
  if(['open','high','low','close'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])||b[k]<=0)||typeof b.volume_shares!=='number'||!Number.isFinite(b.volume_shares)||b.volume_shares<0||b.low>b.high||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high)return fail('INVALID_HISTORY_VALUES');
  eligible.push(b);
 }
 eligible.sort((a,b)=>a.date.localeCompare(b.date));const used=eligible.slice(-SWING_LIMITS.minimum_bars),last=used.at(-1);
 out={...out,sample:{requested_count:SWING_LIMITS.requested_bars,input_count:data.bars.length,completed_count:eligible.length,used_count:used.length,minimum_required:SWING_LIMITS.minimum_bars,first_date:used[0]?.date??null,last_date:last?.date??null,excluded_current_date:excludedCurrent,excluded_future:excludedFuture,excluded_incomplete:excludedIncomplete,excluded_unknown_calendar:excludedUnknown,reordered,missing_scheduled_dates:[]},provenance:{...out.provenance,source_timestamp:last?.source_timestamp??null},freshness:{...out.freshness,status:!expected?'unknown':!last?'unavailable':last.date===expected?'latest_completed_adjusted_session':'stale'},warnings:[...WARNINGS,...(reordered?['HISTORY_REORDERED_CHRONOLOGICALLY']:[]),...(excludedUnknown?['OLDER_ROWS_OUTSIDE_VERIFIED_CALENDAR_EXCLUDED']:[])]};
 if(!expected)return fail('UNKNOWN_CALENDAR');
 if(used.length<SWING_LIMITS.minimum_bars)return fail('INSUFFICIENT_COMPLETED_BARS');
 if(last.date!==expected)return fail('STALE_DAILY_HISTORY');
 const dates=new Set(used.map(b=>b.date)),missing=[];
 for(let d=used[0].date;d<=last.date;d=addDay(d,1))if(tradingDay(d)===true&&!dates.has(d))missing.push(d);
 out.sample.missing_scheduled_dates=missing;if(missing.length)return fail('MISSING_SCHEDULED_SESSIONS');
 const close=used.map(b=>b.close),i=used.length-1,ma=(n,lag=0)=>mean(close.slice(close.length-lag-n,close.length-lag));
 const ma20=ma(20),ma60=ma(60),ma20Before=ma(20,5),ma60Before=ma(60,5),prior20=used.slice(-21,-1),volumeMean=mean(prior20.map(b=>b.volume_shares)),priorHigh=Math.max(...prior20.map(b=>b.high));
 if(volumeMean<=0)return fail('NONPOSITIVE_VOLUME_BASELINE');
 const metrics={close:last.close,ma20,ma60,ma20_5_bars_ago:ma20Before,ma60_5_bars_ago:ma60Before,ma20_change_5d_pct:100*(ma20/ma20Before-1),ma60_change_5d_pct:100*(ma60/ma60Before-1),prior_high20:priorHigh,prior_high20_first_date:prior20[0].date,prior_high20_last_date:prior20.at(-1).date,volume_shares:last.volume_shares,prior_mean_volume20:volumeMean,volume_ratio20:last.volume_shares/volumeMean,close_5_bars_ago:close[i-5],return_5d_pct:100*(last.close/close[i-5]-1),extension_ma20_pct:100*(last.close/ma20-1),amount_cny:null};
 if(Object.values(metrics).some(v=>typeof v==='number'&&!Number.isFinite(v)))return fail('INVALID_DERIVED_METRICS');
 const shared={above_ma20:last.close>ma20,ma20_rising:ma20>ma20Before};
 const e={...shared,breakout_prior20:last.close>priorHigh,breakout_volume:metrics.volume_ratio20>=t.breakout_volume_ratio};
 const c={...shared,ma_alignment:ma20>ma60,ma60_rising:ma60>ma60Before,near_prior20_high:last.close>=priorHigh*(1-t.continuation_near_high_pct/100),continuation_volume:metrics.volume_ratio20>=t.continuation_volume_ratio};
 const checks={emerging:{matched:Object.values(e).every(Boolean),conditions:e},continuation:{matched:Object.values(c).every(Boolean),conditions:c}},phase=checks.continuation.matched?'continuation':checks.emerging.matched?'emerging':null;
 const priorYesterday=Math.max(...used.slice(-22,-2).map(b=>b.high)),breakoutKind=e.breakout_prior20?(used.at(-2).close>priorYesterday?'repeated':'fresh'):null;
 return {...out,status:phase?'match':'not_match',phase,reason_codes:phase?[]:['NO_RULE_MATCH'],metrics,checks,breakout_kind:breakoutKind,risk_flags:[...(metrics.extension_ma20_pct>t.max_extension_ma20_pct?['OVEREXTENDED_MA20']:[]),...(metrics.return_5d_pct>t.max_return_5d_pct?['RAPID_5_BAR_ADVANCE']:[])]};
}
export async function runSwingScreen(a,{normalize,loadHistory,listOriginal,now=Date.now}={}){
 const args=validateSwingArguments(a,normalize),started=now();let items=args.items,universe;
 if(args.kind==='original_watchlist'){
  const page=await listOriginal(args.after);if(!Array.isArray(page?.items))throw Error('ORIGINAL_WATCHLIST_UNAVAILABLE');
  items=page.items.slice(0,SWING_LIMITS.symbols).map(row=>({symbol:normalize(row.symbol),name:row.name}));
  const more=page.items.length>items.length||page.has_more===true;
  universe={kind:args.kind,storage_source:'original',total:page.total,returned:items.length,has_more:more,next_after:more?items.at(-1)?.symbol??null:null,after:args.after||null,requested_count:items.length,deduplicated_count:0};
 }else universe={kind:args.kind,total:items.length,returned:items.length,has_more:false,next_after:null,requested_count:args.requested_count,deduplicated_count:args.deduplicated_count};
 const results=new Array(items.length);let cursor=0;
 async function lane(){while(cursor<items.length){const i=cursor++,item=items[i];if(item.error){results[i]=unavailableSwing(null,item.error,{input:item.input});continue;}
   const remaining=started+SWING_LIMITS.deadline_ms-now();if(remaining<=0){results[i]=unavailableSwing(item.symbol,'BATCH_DEADLINE_EXCEEDED',{...(item.name?{name:item.name}:{})});continue;}
   try{const data=await loadHistory(item.symbol,{now:started,timeout_ms:Math.min(remaining,SWING_LIMITS.source_timeout_ms)});results[i]={...evaluateSwingHistory(data,{symbol:item.symbol,now:started,thresholds:args.thresholds}),...(item.name?{name:item.name}:{})};}
   catch(error){const code=String(error?.message??'');results[i]=unavailableSwing(item.symbol,/TIMEOUT|DEADLINE/.test(code)?'SOURCE_TIMEOUT':'SOURCE_UNAVAILABLE',{...(item.name?{name:item.name}:{}),source_error:{code:/^(INVALID_|SYMBOL_|HISTORY_|TENCENT_|UPSTREAM_)[A-Z0-9_ :;-]*$/.test(code)?code.slice(0,100):'SOURCE_REQUEST_FAILED'}});}
 }}
 await Promise.all(Array.from({length:Math.min(SWING_LIMITS.concurrency,items.length)},lane));
 return {as_of:new Date(started).toISOString(),generated_at:new Date(now()).toISOString(),timezone:'Asia/Shanghai',universe,rules:{version:'swing-daily-v1',eligibility_version:'verified-postclose-v2',defaults:SWING_DEFAULTS,thresholds:args.thresholds,formulas:SWING_FORMULAS,periods:{fast_ma:20,slow_ma:60,slope_lag:5,breakout:20,volume_baseline:20},minimum_bars:SWING_LIMITS.minimum_bars,minimum_applies_to_both_branches:true,thresholds_are_unvalidated_hypotheses:true},limits:SWING_LIMITS,summary:Object.fromEntries(['match','not_match','insufficient_data'].map(k=>[k,results.filter(r=>r.status===k).length])),results,warnings:[...WARNINGS],batch:{elapsed_ms:Math.max(0,now()-started),ordering:'input order, deduplicated normalized valid symbols; original watchlist lexicographic code order',manual_only:true,storage_writes:false,cloud_bridge_requests:false,deadline_scope:'market fetches after request start; original-watchlist database read has no independent timeout, not a whole-request SLA'}};
}
