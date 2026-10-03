/** Invented portable-v1 records only. Trusted demo reader, never a market collector. */
import {createMockSnapshot} from './mock.js';
import {PORTABLE_KEYS} from './portable-adapter.js';
const BASIS='verified_calendar_schedule_with_conservative_buffer';
export function createSyntheticBatchDemo(){
  const mock=createMockSnapshot();
  mock.calendarVersion='exchange-announced-2026-v1';
  mock.directory={...mock.directory,universe:'CN_MAINBOARD_NON_ST_LEADERS',universeVersion:'synthetic-leaders-demo-v1',sourceNotes:'仅虚构symbol与行业标签；真实行业龙头池由研究任务提供，尚未接入'};
  const config={version:1,runId:mock.generation,targetSession:mock.targetSession,calendarVersion:mock.calendarVersion,policyVersion:mock.policyVersion,manifestHash:'a'.repeat(64),synthetic:true,directory:mock.directory,frames:mock.frames,batchSize:3};
  function readBatch(request){
    const records=[],suspensionBySymbol={};
    for(const symbol of request.symbols){
      const stock=mock.stocks.find(s=>s.symbol===symbol);
      if(stock)suspensionBySymbol[symbol]=structuredClone(stock.suspension);
      for(const key of PORTABLE_KEYS){
        if(!stock){records.push({symbol,key,result:{available:false,state:'pending',source_finality:'unknown'}});continue;}
        if(stock.status==='error'){records.push({symbol,key,result:{available:false,state:'failed_without_data',source_finality:'unknown'}});continue;}
        const tf=key.startsWith('1d:')?'D':key.startsWith('1w:')?'W':'M',series=stock.series[tf];
        if(series.bars.at(-1).date!==mock.targetSession){records.push({symbol,key,result:{available:false,state:'partial',source_finality:'unknown'}});continue;}
        const bars=series.bars.map(b=>{const verified=b.periodStart>='2026-01-01'&&b.periodEnd<='2026-12-31';return {date:b.date,source_timestamp:b.sourceTimestamp,open:b.open,high:b.high,low:b.low,close:b.close,volume_shares:b.volume_shares,amount_cny:null,complete:b.completion==='complete',calendar_completion:verified?b.calendarCompletion:null,completion_basis:verified?BASIS:'elapsed_period_unverified',period_end_session:b.periodEnd,observed_latest:null,source_finality:'unknown'};});
        const dataset={dataset_id:config.runId,symbol:symbol.toLowerCase(),source:'tencent',interval:key.split(':')[0],adjustment:key.split(':')[1],target_session:config.targetSession,calendar_version:config.calendarVersion,policy_version:config.policyVersion,content_hash:series.contentHash,request_started_at:series.requestStartedAt,completion_cutoff:series.completionCutoff,fetched_at:series.fetchedAt,source_timestamp:series.sourceTimestamp,bars,coverage:{...series.coverage,calendar_unverified_rows:bars.filter(b=>b.calendar_completion===null).length},units:{price:'CNY',volume:'shares; provider unadjusted reported volume',amount:'unavailable=null'},source_finality:'unknown',point_in_time:false,cache:{used:true,scope:'explicit_local_dataset'},warnings:['Invented portable contract fixture, not Tencent observations']};
        records.push({symbol,key,result:{available:true,state:'ready',source_finality:'unknown',dataset}});
      }
    }
    const {seriesKeys,symbols,...receipt}=request;
    return {...receipt,records,suspensionBySymbol};
  }
  return {config,frames:mock.frames,readBatch};
}
