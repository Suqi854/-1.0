import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeQuotes, selectQuote, validateQuote, QUOTE_ROUTING_CAPABILITIES} from '../src/quote-routing.mjs';
import {parseTencent, parseSina} from '../src/worker.mjs';
const now = Date.parse('2026-09-30T14:00:00+08:00');
const sym = 'sh600522';
function quote(source, timestamp = '2026-09-30T13:59:59+08:00', symbol = sym) {
  return {symbol, source, source_timestamp: timestamp, name: 'test', price: 10, previous_close: 10,
    open: 10, high: 11, low: 9, volume_shares: 100, amount_cny: 1000, currency: 'CNY',
    unit_notes: {volume: 'shares', amount: 'CNY', book: 'shares'}, warnings: [],
    book: {source, bids: Array.from({length:5},()=>({price: 9, volume_shares: 100})), asks: Array.from({length:5},()=>({price:11,volume_shares:100}))}};
}
function candidate(source, timestamp, latency) {
  return {source, quote: quote(source,timestamp), request_started_at: new Date(now-latency).toISOString(), fetched_at: new Date(now).toISOString(), request_latency_ms:latency};
}
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
test('fast stale loses to slow fresh full-source snapshot and book', () => {
  const result = selectQuote(sym,[candidate('tencent','2026-09-30T13:00:00+08:00',2),candidate('sina','2026-09-30T13:59:59+08:00',80)],now);
  assert.equal(result.source,'sina'); assert.equal(result.book.source,'sina');
  assert.equal(result.selection_reason,'NEWEST_VALID_SOURCE_TIMESTAMP'); assert.equal(result.data_age_seconds,1);
});
test('newest timestamp wins even when both recent; identical freshness chooses lower HTTP latency', () => {
  assert.equal(selectQuote(sym,[candidate('tencent','2026-09-30T13:59:58+08:00',1),candidate('sina','2026-09-30T13:59:59+08:00',90)],now).source,'sina');
  const r=selectQuote(sym,[candidate('tencent','2026-09-30T13:59:59+08:00',90),candidate('sina','2026-09-30T13:59:59+08:00',1)],now);
  assert.equal(r.source,'sina'); assert.equal(r.selection_reason,'EQUAL_SOURCE_TIMESTAMP_LOWER_REQUEST_LATENCY');
});
test('stale-only results are explicitly stale, both failures explicitly unavailable',()=>{
  const r=selectQuote(sym,[candidate('tencent','2026-09-29T13:59:59+08:00',1)],now);
  assert.equal(r.freshness.status,'stale');assert.equal(r.selection_reason,'NEWEST_VALID_BUT_STALE');
  assert.match(r.warnings.join(','),/NOT_CURRENT_DATA/);
  assert.equal(selectQuote(sym,[{source:'tencent',error:'FAIL'},{source:'sina',error:'FAIL'}],now).error.code,'QUOTE_UNAVAILABLE');
});
test('validation rejects future, impossible date, negative values, invalid unit/currency and mixed books',()=>{
  for(const change of [q=>q.source_timestamp='2026-09-30T14:01:00+08:00',q=>q.source_timestamp='2026-02-30T14:00:00+08:00',q=>q.volume_shares=-1,q=>q.price=NaN,q=>q.currency='USD',q=>q.unit_notes={},q=>q.book.source='sina',q=>q.high=8]){
    const q=quote('tencent');change(q);assert.throws(()=>validateQuote(q,sym,'tencent',true,now));
  }
});
test('both providers start in parallel, share one deadline, return partial batch success',async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{calls.push(String(url));assert.equal(opts.redirect,'manual');assert.equal(opts.cache,'no-store');await delay(10);return new Response('test');};
  const parsers={parseTencent:(_raw,s)=>{if(s!==sym)throw Error('SYMBOL_NOT_RETURNED');return quote('tencent',undefined,s);},parseSina:(_raw,s)=>quote('sina',undefined,s)};
  const pending=routeQuotes([sym,'sz000001'],true,parsers,{fetchImpl,now:()=>now,deadlineMs:100});
  assert.equal(calls.length,2);assert.ok(calls.every(u=>u.includes(sym+',sz000001')));
  const result=await pending;assert.equal(result.quotes.length,2);assert.equal(result.quotes[1].source,'sina');
  assert.equal(result.quotes[1].candidates[0].error,'SYMBOL_NOT_RETURNED');
});
test('hung fetch cannot hold a successful alternate past shared deadline and receives abort',async()=>{
  let signal;
  const began=Date.now();
  const r=await routeQuotes([sym],true,{parseTencent:()=>quote('tencent'),parseSina:()=>quote('sina')},{deadlineMs:30,
    fetchImpl:async(url,opts)=>{if(url.includes('gtimg')){signal=opts.signal;return new Promise(()=>{});}return new Response('ok');}});
  assert.ok(Date.now()-began<300);assert.equal(signal.aborted,true);assert.equal(r.quotes[0].source,'sina');
  assert.equal(r.quotes[0].candidates[0].error,'SHARED_DEADLINE_EXCEEDED');
});
test('hung response body is bounded too',async()=>{
  const r=await routeQuotes([sym],false,{parseTencent:()=>quote('tencent'),parseSina:()=>quote('sina')},{deadlineMs:20,
    fetchImpl:async()=>({ok:true,status:200,arrayBuffer:()=>new Promise(()=>{})})});
  assert.equal(r.quotes[0].error.code,'QUOTE_UNAVAILABLE');
});
test('future or malformed candidate fails over automatically',async()=>{
  for(const parseTencent of [()=>quote('tencent','2026-09-30T14:02:00+08:00'),()=>({...quote('tencent'),volume_shares:-1})]){
    const r=await routeQuotes([sym],true,{parseTencent,parseSina:()=>quote('sina')},{now:()=>now,fetchImpl:async()=>new Response('ok')});
    assert.equal(r.quotes[0].source,'sina');assert.equal(r.quotes[0].selection_reason,'ONLY_VALID_SOURCE');assert.equal(r.quotes[0].candidates[0].status,'error');
  }
});
test('actual fetched timestamp stays earlier than selection after a slow alternate; no invented exchange latency',async()=>{
  let clock=now;
  const r=await routeQuotes([sym],true,{parseTencent:()=>quote('tencent'),parseSina:()=>quote('sina','2026-09-30T13:59:58+08:00')},{now:()=>clock,fetchImpl:async url=>{
    if(url.includes('sinajs')){await delay(10);clock+=20;}return new Response('ok');
  }});
  assert.equal(r.quotes[0].fetched_at,new Date(now).toISOString());assert.equal(r.quotes[0].selected_at,new Date(now+20).toISOString());
  assert.equal(r.quotes[0].data_age_seconds,1.02);assert.match(r.quotes[0].latency_notes,/Neither certifies/);
});
test('synthetic schema fixtures preserve mainboard and STAR verified share units through routing validation',()=>{
  const fixtures=new URL('./fixtures/',import.meta.url);
  for(const [file,source,symbol,parse] of [['tencent_snapshot.txt','tencent',sym,parseTencent],['sina_snapshot.txt','sina',sym,parseSina],['tencent_star_quote.txt','tencent','sh688981',parseTencent],['sina_star_quote.txt','sina','sh688981',parseSina]]){
    const raw=readFileSync(new URL(file,fixtures),'utf8');const q=parse(raw,symbol,true);
    validateQuote(q,symbol,source,true,Date.parse('2026-10-01T00:00:00Z'));assert.ok(q.volume_shares>0);
  }
});
test('capabilities scope daily multi-source and minute/auction limitations explicitly',()=>{
  assert.equal(QUOTE_ROUTING_CAPABILITIES.quotes.parallel,true);
  assert.equal(QUOTE_ROUTING_CAPABILITIES.historical_bars.parallel,true);
  assert.match(QUOTE_ROUTING_CAPABILITIES.historical_bars.scope,/adjustment=none/);
  for(const kind of ['minute_bars','intraday','auction'])assert.equal(QUOTE_ROUTING_CAPABILITIES[kind].parallel,false);
});
