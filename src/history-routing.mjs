// Independent unadjusted daily histories only. Never splice providers or adjustments.
import {barCompletion,tradingDay} from './market-session.mjs';
const HEADERS = {'Referer':'https://finance.sina.com.cn','User-Agent':'Mozilla/5.0'};
const iso = ms => new Date(ms).toISOString();
const number = v => {if(v==null||String(v).trim()===''||!Number.isFinite(Number(v)))throw Error('INVALID_SOURCE_NUMBER');return Number(v);};
export function parseSinaDaily(raw,symbol,limit,incomplete=false,now=Date.now(),cutoff=now){
  const start=raw.indexOf('(['),end=raw.lastIndexOf('])');
  if(start<0||end<start)throw Error('INVALID_SINA_BAR_WRAPPER');
  const rows=JSON.parse(raw.slice(start+1,end+1));
  if(!Array.isArray(rows)||!rows.length)throw Error('DAILY_HISTORY_UNAVAILABLE');
  const dates=new Set();let excluded=0;
  const bars=rows.map(r=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.day))throw Error('INVALID_BAR_DATE');
    const t=r.day+'T15:00:00+08:00',ms=Date.parse(t);
    if(!Number.isFinite(ms)||iso(ms+8*3600000).slice(0,10)!==r.day||dates.has(r.day))throw Error('INVALID_OR_DUPLICATE_BAR_DATE');
    if(r.day>iso(cutoff+8*3600000).slice(0,10))throw Error('FUTURE_BAR_DATE');
    dates.add(r.day);
    if(tradingDay(r.day)===false)throw Error('BAR_ON_NONTRADING_DATE');
    const b={date:r.day,source_timestamp:t,open:number(r.open),close:number(r.close),high:number(r.high),low:number(r.low),volume_shares:number(r.volume),amount_cny:null,...barCompletion(r.day,'1d',cutoff)};
    if(b.low<=0||b.high<b.low||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high||b.volume_shares<0)throw Error('INVALID_BAR_VALUES');
    return b;
  }).filter(b=>{if(!incomplete&&!b.complete){excluded++;return false;}return true;}).sort((a,b)=>a.date.localeCompare(b.date)).slice(-limit);
  if(!bars.length)throw Error('NO_COMPLETED_BARS');
  const last=bars.at(-1).source_timestamp,age=(now-Date.parse(last))/1000;
  return {symbol,source:'sina',interval:'1d',adjustment:'none',bars,source_timestamp:last,fetched_at:iso(now),completion_cutoff:iso(cutoff),source_finality:'unknown',freshness:{status:age< -5?'future_timestamp':age<=90?'recent':'stale',age_seconds:Math.round(age),threshold_seconds:90,market_calendar_verified:false},currency:'CNY',timezone:'Asia/Shanghai',history:{requested:limit,returned:bars.length,first_date:bars[0].date,last_date:bars.at(-1).date,full_history:false},unit_notes:{volume:'Sina daily volume: shares',amount:'unavailable=null',timestamp:'daily date labeled at 15:00 Asia/Shanghai, not last-trade timestamp',adjustment:'unadjusted daily OHLC; no corporate-action factor inferred'},cache:{used:false},warnings:['UNOFFICIAL_PUBLIC_FEED','AMOUNT_UNAVAILABLE','BAR_AGE_IS_NOT_REALTIME_QUOTE_FRESHNESS','SCHEDULE_INFERRED_COMPLETION; provider final revisions unknown','SINA_DAILY_MAY_OMIT_CURRENT_SESSION; coverage is provider-dependent',...(excluded?['EXCLUDED_'+excluded+'_POTENTIALLY_INCOMPLETE_BARS']:[])]};
}
export function selectDailyHistory(candidates,requested,now=Date.now()){
  const summaries=candidates.map(c=>({source:c.source,request_latency_ms:c.request_latency_ms,fetched_at:c.fetched_at,...(c.error?{status:'error',error:c.error}:{status:'valid',source_timestamp:c.data.source_timestamp,returned:c.data.bars.length,first_date:c.data.bars[0].date,last_date:c.data.bars.at(-1).date})}));
  const valid=candidates.filter(c=>!c.error&&c.data).sort((a,b)=>Date.parse(b.data.source_timestamp)-Date.parse(a.data.source_timestamp)||b.data.bars.length-a.data.bars.length||a.request_latency_ms-b.request_latency_ms||a.source.localeCompare(b.source));
  if(!valid.length)throw Error('DAILY_HISTORY_UNAVAILABLE: '+summaries.map(c=>c.source+': '+c.error).join('; '));
  const selected=valid[0];
  return {...selected.data,request_latency_ms:selected.request_latency_ms,selected_at:iso(now),candidates:summaries,routing:{mode:'parallel',providers:['tencent','sina'],selection:'newest_bar_date_then_most_requested_bars_then_lowest_request_latency',whole_series:true,mixed_providers:false,adjustment:'none',scope:'daily_unadjusted_only'},selection_reason:valid.length===1?'ONLY_VALID_SOURCE':'NEWEST_DATE_THEN_COVERAGE_THEN_HTTP_LATENCY',warnings:[...selected.data.warnings,...(selected.data.bars.length<requested?['REQUESTED_HISTORY_NOT_FULLY_AVAILABLE']:[]),...(summaries.some(c=>c.status==='error')?['ALTERNATE_HISTORY_SOURCE_FAILED; see candidates']:[]),'DAILY_DATE_IS_NOT_INTRADAY_FRESHNESS; same-date partial daily snapshots cannot be ranked by exchange update time']};
}
export async function routeDailyHistory(symbol,limit,incomplete,parseTencent,options={}){
  const now=options.now||Date.now,fetchImpl=options.fetchImpl||fetch,deadlineMs=options.deadlineMs??10000,started=now();
  if(!Number.isFinite(deadlineMs)||deadlineMs<1||deadlineMs>10000)throw Error('INVALID_HISTORY_DEADLINE');
  const providers=[{source:'tencent',url:'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+symbol+',day,,,'+Math.min(limit+2,640)+',',parse:(raw,end)=>parseTencent(raw,symbol,'1d',limit,'none',incomplete,end,started)},{source:'sina',url:'https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData?symbol='+symbol+'&scale=240&ma=no&datalen='+Math.min(limit+2,602),parse:(raw,end)=>parseSinaDaily(raw,symbol,limit,incomplete,end,started)}];
  const candidates=await Promise.all(providers.map(async p=>{
    const begin=now(),controller=new AbortController();let timer;
    const base=()=>({source:p.source,request_latency_ms:Math.max(0,now()-begin),fetched_at:iso(now())});
    try{
      const operation=(async()=>{const r=await fetchImpl(p.url,{headers:HEADERS,redirect:'manual',cache:'no-store',signal:controller.signal});if(!r.ok||r.status>=300)throw Error('UPSTREAM_HTTP_'+r.status);const b=await r.arrayBuffer();if(b.byteLength>1000000)throw Error('UPSTREAM_RESPONSE_TOO_LARGE');return new TextDecoder('gb18030').decode(b);})();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('SHARED_DEADLINE_EXCEEDED'));controller.abort();},Math.max(0,started+deadlineMs-now()));});
      const raw=await Promise.race([operation,timeout]);const data=p.parse(raw,now());
      const seen=new Set();for(const bar of data.bars){const date=bar.date,ms=Date.parse(bar.source_timestamp);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(ms)||iso(ms+8*3600000).slice(0,10)!==date||date>iso(started+8*3600000).slice(0,10)||seen.has(date))throw Error('INVALID_OR_FUTURE_HISTORY_DATE');seen.add(date);if(['open','close','high','low'].some(key=>!Number.isFinite(bar[key])||bar[key]<=0))throw Error('INVALID_UNADJUSTED_OHLC');}
      return {...base(),data};
    }catch(e){return {...base(),error:String(e?.message||e).slice(0,180)};}finally{clearTimeout(timer);}
  }));
  const result=selectDailyHistory(candidates,limit,now());result.routing.deadline_ms=deadlineMs;result.routing.elapsed_ms=Math.max(0,now()-started);return result;
}
