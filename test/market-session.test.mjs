import test from 'node:test';
import assert from 'node:assert/strict';
import {marketState,marketFreshness,periodCompletion,tradingDay,securityStatus,MARKET_CALENDAR} from '../src/market-session.mjs';
const t = s => Date.parse(s + (s.includes('T') ? '+08:00' : 'T12:00:00+08:00'));
const fresh = (stamp,now,opts) => marketFreshness(stamp+'+08:00',t(now),90,opts);
test('calendar uses exchange closures, not government make-up workdays',()=>{
  for(const d of ['2026-01-01','2026-02-16','2026-02-23','2026-04-06','2026-05-04','2026-06-19','2026-09-25','2026-10-07','2026-10-10','2026-09-20']) assert.equal(tradingDay(d),false,d);
  for(const d of ['2026-01-05','2026-02-24','2026-09-28','2026-10-08']) assert.equal(tradingDay(d),true,d);
  for(const d of ['2025-12-31','2027-01-04','2026-02-30','wrong']) assert.equal(tradingDay(d),null,d);
  for(const exchange of ['sh','sz','bj']) assert.match(marketState(t('2026-09-30'),exchange+'600000').calendar.sources.calendar,/https:\/\//);
  assert.equal(MARKET_CALENDAR.verified_as_of,'2026-09-30');
});
test('Shanghai boundaries independent of host timezone',()=>{
  for(const [time,phase] of [['09:14:59','pre_open'],['09:15:00','opening_auction'],['09:24:59','opening_auction'],['09:25:00','opening_auction_gap'],['09:29:59','opening_auction_gap'],['09:30:00','continuous_am'],['11:29:59','continuous_am'],['11:30:00','lunch_break'],['12:59:59','lunch_break'],['13:00:00','continuous_pm'],['14:56:59','continuous_pm'],['14:57:00','closing_auction'],['15:00:00','after_close']]) assert.equal(marketState(t('2026-09-30T'+time)).phase,phase,time);
  assert.equal(marketState(Date.parse('2026-09-30T01:30:00Z')).phase,'continuous_am');
  assert.equal(marketState(Date.parse('2026-09-29T17:30:00-08:00')).phase,'continuous_am');
  assert.equal(marketState(t('2026-10-03T10:00:00')).phase,'closed');
  assert.equal(marketState(t('2027-01-04T10:00:00')).phase,'unknown');
});
test('lunch quote keeps actual age without false stale while older morning quote is stale',()=>{
  const r = fresh('2026-09-30T11:30:00','2026-09-30T12:45:00');
  assert.equal(r.status,'latest_session');assert.equal(r.age_seconds,4500);assert.equal(r.lag_from_expected_seconds,0);
  assert.equal(fresh('2026-09-30T11:20:00','2026-09-30T12:45:00').status,'stale');
  assert.equal(fresh('2026-09-30T11:30:00','2026-09-30T13:02:00').status,'stale');
});
test('closed, holiday, and pre-open require most recent actual session close',()=>{
  assert.equal(fresh('2026-09-24T15:00:00','2026-09-27T12:00:00').status,'latest_session');
  assert.equal(fresh('2026-09-23T15:00:00','2026-09-27T12:00:00').status,'stale');
  assert.equal(fresh('2026-09-30T15:00:00','2026-10-07T12:00:00').status,'latest_session');
  assert.equal(fresh('2026-09-30T15:00:00','2026-10-08T09:10:00').status,'latest_session');
  assert.equal(fresh('2026-09-30T15:00:00','2026-10-08T10:00:00').status,'stale');
  assert.equal(fresh('2026-09-30T14:40:00','2026-09-30T16:00:00').status,'stale');
});
test('auction last trade is not confused with indicative auction updates',()=>{
  assert.equal(fresh('2026-09-29T15:00:00','2026-09-30T09:24:00').status,'latest_session');
  assert.equal(fresh('2026-09-29T15:00:00','2026-09-30T09:28:00').status,'stale');
  assert.equal(fresh('2026-09-30T09:25:00','2026-09-30T09:29:00').status,'latest_session');
  assert.equal(fresh('2026-09-30T14:57:00','2026-09-30T14:59:59').status,'latest_session');
});
test('timestamp uncertainty and unverified security status remain explicit',()=>{
  assert.equal(fresh('2026-09-30T10:00:00','2026-09-30T10:00:10').status,'recent');
  assert.equal(fresh('2026-09-30T10:00:30','2026-09-30T10:00:10').status,'future_timestamp');
  assert.equal(marketFreshness('2026-09-30T10:00:00',t('2026-09-30')).status,'invalid_timestamp');
  assert.equal(marketFreshness('2026-02-30T10:00:00+08:00',t('2026-09-30')).status,'invalid_timestamp');
  assert.equal(fresh('2026-12-31T15:00:00','2027-01-04T10:00:00').status,'unknown');
  assert.equal(fresh('2025-12-31T15:00:00','2026-01-02T12:00:00').status,'unknown');
  assert.deepEqual(securityStatus({volume_shares:0,price:11,previous_close:10,suspended:true}),securityStatus());
  assert.equal(securityStatus().suspension,'unknown');assert.equal(securityStatus().price_limit_status,'unknown');
});
test('period finality respects holiday-shortened week, month, and conservative aggregation close',()=>{
  assert.equal(periodCompletion('2026-09-24','1w',t('2026-09-24T15:00:04')),false);
  assert.equal(periodCompletion('2026-09-24','1w',t('2026-09-24T15:30:03')),false);
  assert.equal(periodCompletion('2026-09-24','1w',t('2026-09-24T15:30:04')),true);
  assert.equal(periodCompletion('2026-09-30','1w',t('2026-09-30T16:00:00')),true);
  assert.equal(periodCompletion('2026-09-30','1mo',t('2026-09-30T16:00:00')),true);
  assert.equal(periodCompletion('2026-09-29','1mo',t('2026-09-29T16:00:00')),false);
  assert.equal(periodCompletion('2026-02-28','1mo',t('2026-02-27T16:00:00')),true);
  assert.equal(periodCompletion('2026-09-25','1d',t('2026-09-30')),null);
  assert.equal(periodCompletion('2026-12-31','1w',t('2027-01-05')),null);
  assert.equal(periodCompletion('2025-12-31','1mo',t('2026-09-30')),null);
});
test('daily/weekly bars compare completed period rather than treating dates as current ticks',()=>{
  const opts={kind:'1d'};
  assert.equal(fresh('2026-09-29T15:00:00','2026-09-30T10:00:00',opts).status,'latest_session');
  assert.equal(fresh('2026-09-30T15:00:00','2026-09-30T10:00:00',opts).status,'incomplete');
  assert.equal(fresh('2026-09-29T15:00:00','2026-09-30T16:00:00',opts).status,'stale');
  assert.equal(fresh('2026-09-24T15:00:00','2026-09-29T10:00:00',{kind:'1w'}).status,'latest_session');
  assert.equal(fresh('2026-09-24T15:00:00','2026-09-30T16:00:00',{kind:'1w'}).status,'stale');
});
