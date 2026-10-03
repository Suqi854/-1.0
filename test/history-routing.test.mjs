import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSinaDaily,selectDailyHistory,routeDailyHistory} from '../src/history-routing.mjs';
import {parseHistory,tools} from '../src/worker.mjs';
const raw=readFileSync(new URL('./fixtures/sina_daily.txt',import.meta.url),'utf8');
const now=Date.parse('2026-09-30T14:40:00+08:00');
const wrapper=rows=>'=('+JSON.stringify(rows)+')';
const row={day:'2026-09-29',open:'10.100',high:'10.500',low:'9.900',close:'10.200',volume:'123456'};
test('synthetic Sina daily fixture preserves shares, raw prices and absent amount',()=>{const x=parseSinaDaily(raw,'sh600522',5,false,now);assert.equal(x.bars.length,5);assert.equal(x.bars.at(-1).volume_shares,112000);assert.equal(x.bars.at(-1).amount_cny,null);assert.equal(x.bars.at(-1).date,'2026-09-29');assert.equal(x.adjustment,'none');});
test('daily completion excludes current session and malformed data fail closed',()=>{let x=parseSinaDaily(wrapper([row,{...row,day:'2026-09-30'}]),'sh600522',5,false,now);assert.equal(x.bars.length,1);x=parseSinaDaily(wrapper([row,{...row,day:'2026-09-30'}]),'sh600522',5,true,now);assert.equal(x.bars.at(-1).complete,false);for(const rows of [[{...row,day:'2026-02-30'}],[{...row,day:'2027-01-01'}],[row,row],[{...row,volume:''}],[{...row,high:10}]])assert.throws(()=>parseSinaDaily(wrapper(rows),'sh600522',5,false,now));});
function candidate(source,rows,latency=50){const data=parseSinaDaily(wrapper(rows),'sh600522',10,false,now);data.source=source;return {source,data,request_latency_ms:latency,fetched_at:new Date(now).toISOString()};}
test('whole daily series prioritizes date then coverage then latency, never merges',()=>{const newer=candidate('sina',[row],100),older=candidate('tencent',[{...row,day:'2026-09-28'}],10);assert.equal(selectDailyHistory([newer,older],10,now).source,'sina');const fuller=candidate('tencent',[{...row,day:'2026-09-28'},row],200);assert.equal(selectDailyHistory([newer,fuller],10,now).source,'tencent');const faster=candidate('tencent',[row],20);const x=selectDailyHistory([newer,faster],10,now);assert.equal(x.source,'tencent');assert.equal(x.routing.mixed_providers,false);assert.equal(x.bars.length,1);});
test('daily parallel route tolerates failed alternative without sequential retry',async()=>{let calls=[];const x=await routeDailyHistory('sh600522',5,false,parseHistory,{now:()=>now,fetchImpl:async url=>{calls.push(url);if(url.includes('gtimg'))throw Error('upstream down');return new Response(raw);}});assert.equal(calls.length,2);assert.equal(x.source,'sina');assert.equal(x.candidates.find(c=>c.source==='tencent').status,'error');assert.equal(x.routing.mode,'parallel');});
test('bounded deadline rejects ignored abort with no retries',async()=>{const begin=Date.now();let calls=0;await assert.rejects(()=>routeDailyHistory('sh600522',5,false,parseHistory,{deadlineMs:25,fetchImpl:()=>{calls++;return new Promise(()=>{});}}),/SHARED_DEADLINE/);assert.equal(calls,2);assert.ok(Date.now()-begin<500);});
test('daily routing contract clearly excludes adjusted history',()=>{assert.match(tools.find(t=>t.name==='get_bars').description,/raw daily Tencent\/Sina/);assert.match(tools.find(t=>t.name==='get_bars').description,/adjusted daily and 1w\/1mo Tencent/);});

test('zero or negative unadjusted Tencent OHLC fails over; both invalid histories unavailable',async()=>{
  for(const badPrice of ['0','-1']){
    const tx=JSON.stringify({code:0,data:{sh600522:{day:[['2026-09-29',badPrice,badPrice,badPrice,badPrice,'100']]}}});
    const fetchImpl=async url=>new Response(url.includes('gtimg')?tx:raw);
    const result=await routeDailyHistory('sh600522',5,false,parseHistory,{now:()=>now,fetchImpl});
    assert.equal(result.source,'sina');
    assert.match(result.candidates.find(c=>c.source==='tencent').error,/INVALID_UNADJUSTED_OHLC/);
    await assert.rejects(()=>routeDailyHistory('sh600522',5,false,parseHistory,{now:()=>now,fetchImpl:async url=>new Response(url.includes('gtimg')?tx:wrapper([{...row,open:badPrice,close:badPrice,high:badPrice,low:badPrice}]))}),/DAILY_HISTORY_UNAVAILABLE/);
  }
});
