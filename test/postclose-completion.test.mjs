import test from 'node:test';
import assert from 'node:assert/strict';
import {barCompletion,latestCompletedPeriod,periodCompletion} from '../src/market-session.mjs';
import {parseHistory,callData} from '../src/worker.mjs';
import {parseSinaDaily} from '../src/history-routing.mjs';
import {evaluateSwingHistory,expectedSwingSession} from '../src/swing-screening.mjs';
const time=s=>Date.parse(s+'+08:00'),day='2026-09-30';
const raw=(date=day,adjustment='qfq',interval='day')=>JSON.stringify({code:0,data:{sh600000:{[(adjustment==='none'?'':adjustment)+interval]:[[date,'10','11','12','9','1000']]}}});
const sina=date=>'=([{'+JSON.stringify('day')+':'+JSON.stringify(date)+',"open":"10","close":"11","high":"12","low":"9","volume":"100000"}])';

test('all price adjustments and Sina share the exact verified conservative boundary',()=>{
 for(const clock of ['15:00:04','15:30:02','15:30:03','15:30:03.001','18:00:00']){
  const now=time(day+'T'+clock),expected=clock>'15:30:03';
  for(const adj of ['none','qfq','hfq']){
   const row=parseHistory(raw(day,adj),'sh600000','1d',20,adj,true,now).bars[0];
   assert.equal(row.complete,expected,adj+clock);assert.equal(row.calendar_completion,expected);assert.equal(row.source_finality,'unknown');
  }
  assert.equal(parseSinaDaily(sina(day),'sh600000',20,true,now).bars[0].complete,expected);
  assert.equal(expectedSwingSession(now),expected?day:'2026-09-29');
 }
});

test('forming weekly/monthly observations remain available but are never finalized midperiod',()=>{
 const now=time('2026-09-29T18:00:00');
 for(const [interval,period] of [['1w','week'],['1mo','month']]){
  const d=parseHistory(raw('2026-09-29','none',period),'sh600000',interval,5,'none',true,now);
  assert.equal(d.bars[0].complete,false);assert.equal(d.bars[0].calendar_completion,false);assert.equal(d.bars[0].source_finality,'unknown');
 }
 for(const [date,interval,clock] of [['2026-09-24','1w','2026-09-24T18:00:00'],[day,'1w',day+'T18:00:00'],[day,'1mo',day+'T18:00:00'],['2026-02-27','1mo','2026-02-27T18:00:00']])assert.equal(barCompletion(date,interval,time(clock)).calendar_completion,true);
});

test('known closed-day daily labels reject, older unknown calendar history stays display-only',()=>{
 const now=time(day+'T18:00:00');
 for(const date of ['2026-09-25','2026-09-27','2026-10-03']){
  assert.throws(()=>parseHistory(raw(date),'sh600000','1d',20,'qfq',true,time('2026-10-03T18:00:00')),/NONTRADING/);
  assert.throws(()=>parseSinaDaily(sina(date),'sh600000',20,true,time('2026-10-03T18:00:00')),/NONTRADING/);
 }
 const old=parseHistory(raw('2025-12-31'),'sh600000','1d',20,'qfq',false,now).bars[0];
 assert.equal(old.complete,true);assert.equal(old.calendar_completion,null);assert.equal(old.source_finality,'unknown');assert.match(old.completion_basis,/unverified/);
 assert.equal(latestCompletedPeriod(time('2027-01-01T18:00:00')),null);
 assert.equal(barCompletion('2026-12-31','1w',time('2026-12-31T18:00:00')).calendar_completion,null);
});

test('postclose eligibility and date expectations use frozen request start across a boundary and midnight',async()=>{
 const start=time(day+'T15:30:02'),end=time(day+'T18:00:00');
 const d=parseHistory(raw(),'sh600000','1d',20,'qfq',true,end,start);
 assert.equal(d.bars[0].complete,false);assert.equal(d.completion_cutoff,new Date(start).toISOString());
 const originalFetch=globalThis.fetch,originalNow=Date.now;let current=start;
 Date.now=()=>current;globalThis.fetch=async()=>{current=end;return new Response(raw());};
 try{for(const name of ['get_bars','get_macd']){current=start;const result=await callData({name,arguments:{symbol:'600000',interval:'1d',adjustment:'qfq',include_incomplete:true}},undefined,'owner','https://site.test');assert.equal((result.bars??result.points)[0].complete,false);assert.equal((result.bars??result.points)[0].calendar_completion,false);assert.equal(result.source_finality,'unknown');assert.equal(result.freshness.expected_session_date,'2026-09-29');assert.equal(result.freshness.status,'incomplete');assert.equal(result.fetched_at,new Date(end).toISOString());}}
 finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
 const late=time(day+'T23:59:00');assert.equal(parseHistory(raw(),'sh600000','1d',20,'qfq',true,time('2026-10-01T00:01:00'),late).bars[0].complete,true);
});

test('new receipts and elapsed time alone do not certify provider updates or security status',()=>{
 const now=time(day+'T18:00:00');const d=parseHistory(raw('2026-09-29'),'sh600000','1d',20,'qfq',true,now);
 assert.equal(d.bars[0].observed_latest,false);assert.equal(d.source_finality,'unknown');assert.equal(periodCompletion(day,'1d',now),true);
 const evaluated=evaluateSwingHistory(d,{now});assert.equal(evaluated.status,'insufficient_data');assert.equal(evaluated.security_status.suspension,'unknown');
});

test('known holidays and weekend cutoffs keep last scheduled completed trading day',()=>{
 for(const date of ['2026-10-01','2026-10-03','2026-10-07'])assert.equal(expectedSwingSession(time(date+'T18:00:00')),day);
 assert.equal(expectedSwingSession(time('2026-10-10T18:00:00')),'2026-10-09');
 assert.equal(expectedSwingSession(time('2026-09-27T18:00:00')),'2026-09-24');
});
