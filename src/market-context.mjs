import {sectorContext} from './sector-context.mjs';
import {marketState,marketFreshness} from './market-session.mjs';
export const BENCHMARKS=['sh000001','sz399001','sz399006','sh000300','sh000905','sh000852'];
export function parseBenchmark(raw,symbol,now=Date.now()){
 if(!BENCHMARKS.includes(symbol))throw Error('INVALID_BENCHMARK');const fields=raw.match(new RegExp('v_'+symbol+'="([^"\\r\\n]*)"'))?.[1]?.split('~');
 if(!fields||fields.length<35||fields[2]!==symbol.slice(2)||!fields[1])throw Error('BENCHMARK_NOT_RETURNED');
 const number=i=>{const v=fields[i];if(v===undefined||v.trim()===''||!Number.isFinite(Number(v))||Number(v)<=0)throw Error('INVALID_BENCHMARK_NUMBER');return Number(v);};
 if(!/^\d{14}$/.test(fields[30]))throw Error('INVALID_BENCHMARK_TIMESTAMP');const t=fields[30].replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3T$4:$5:$6+08:00'),fresh=marketFreshness(t,now,90,{symbol});if(['invalid_timestamp','future_timestamp'].includes(fresh.status))throw Error('INVALID_BENCHMARK_TIMESTAMP');
 const price=number(3),previous=number(4),open=number(5),high=number(33),low=number(34);if(low>high||price<low||price>high||open<low||open>high)throw Error('INVALID_BENCHMARK_RANGE');return {symbol,name:fields[1],source:'tencent',source_timestamp:t,index_points:price,previous_close_points:previous,open_points:open,high_points:high,low_points:low,change_points:price-previous,change_percent:(price/previous-1)*100,unit:'index points; change_percent is percent change from previous close',timestamp_semantics:'provider reported update clock, not verified last-trade time',last_trade_timestamp:null,freshness:fresh,market_state:marketState(now,symbol)};
}
export async function marketContext(fetchText,now=Date.now){
 const started=now();const [benchmark,industry_context]=await Promise.all([fetchText('https://qt.gtimg.cn/q='+BENCHMARKS.join(',')).then(raw=>({raw,fetched:now()})).catch(e=>({error:String(e.message)})),sectorContext(fetchText,now)]);
 const fetched=now(),indices=BENCHMARKS.map(symbol=>{try{if(benchmark.error)throw Error(benchmark.error);return {...parseBenchmark(benchmark.raw,symbol,benchmark.fetched),fetched_at:new Date(benchmark.fetched).toISOString()};}catch(e){return {symbol,error:String(e.message)};}});
 if(indices.every(i=>i.error)&&!industry_context.available)throw Error('MARKET_CONTEXT_UNAVAILABLE');
 return {indices,source:'tencent benchmarks; eastmoney delayed industries',fetched_at:new Date(fetched).toISOString(),request_latency_ms:fetched-started,market_state:marketState(fetched,'sh000001'),industry_context,scope:'Six fixed benchmarks and provider industry top/bottom lists; not full-market breadth or stock attribution',warnings:['UNOFFICIAL_PUBLIC_FEED','INDEX_VALUES_ARE_POINTS_NOT_CNY; no index order book or guessed volume units','INDEX_AND_STOCK_TIMESTAMPS_MAY_DIFFER; compare only compatible observations','NO_INSTITUTIONAL_INTENT_INFERRED','BENCHMARKS_AND_SECTORS_OVERLAP; do not sum or infer whole-market breadth','AFTER_CLOSE_SOURCE_CLOCK_UPDATES_DO_NOT_ESTABLISH_TRADING']};
}
