import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {auctionQuality} from '../src/auction-quality.mjs';import {parseAuction} from '../src/worker.mjs';
const raw=readFileSync(new URL('./fixtures/eastmoney_premarket.json',import.meta.url),'utf8'),now=Date.parse('2026-09-30T10:00:00+08:00');
test('auction quality separates minute phases and absent volume from zero',()=>{const d=parseAuction(raw,'sh600522',now);assert.deepEqual(d.auction_quality.phases.map(p=>p.points),[5,5,6]);assert.deepEqual(d.auction_quality.missing_elapsed_minute_labels,[]);const p=d.points.filter(p=>!p.source_timestamp.includes('09:18'));p[0]={...p[0],reported_volume_shares:null};const q=auctionQuality(p,now);assert.deepEqual(q.missing_elapsed_minute_labels,['09:18']);assert.equal(q.missing_reported_volume_points,1);assert.equal(q.same_day,true);assert.equal(auctionQuality(p,now+86400000).same_day,false);});
test('empty or future minutes not counted as missing elapsed observations',()=>{assert.deepEqual(auctionQuality([],now).missing_elapsed_minute_labels,[]);const d=parseAuction(raw,'sh600522',now);assert.deepEqual(auctionQuality(d.points.slice(0,1),Date.parse('2026-09-30T09:16:20+08:00')).missing_elapsed_minute_labels,[]);});
test('auction rejects future observations and inconsistent OHLC',()=>{assert.throws(()=>parseAuction(raw,'sh600522',now-86400000),/INVALID_AUCTION_POINT/);const d=JSON.parse(raw);d.data.trends[0]=d.data.trends[0].replace(',20.00,20.00,20.00,20.00,',',20.00,21,20.00,20.00,');assert.throws(()=>parseAuction(JSON.stringify(d),'sh600522',now),/INVALID_AUCTION_POINT/);});

import {marketFreshness} from '../src/market-session.mjs';
test('auction history is not measured against afternoon quote freshness',()=>{
 const d=marketFreshness('2026-09-30T09:26:00+08:00',Date.parse('2026-09-30T15:05:00+08:00'),90,{symbol:'sh600522',kind:'auction'});
 assert.equal(d.status,'historical_auction_observations');assert.equal(d.expected_source_timestamp,null);assert.equal(d.full_process_verified,false);assert.equal(d.age_seconds,20340);
 assert.equal(marketFreshness('2026-09-29T09:30:00+08:00',now,90,{kind:'auction'}).status,'prior_session_observations');
});
test('auction window distinguishes delayed observations and retains future/calendar guards',()=>{
 const at=t=>Date.parse('2026-09-30T'+t+'+08:00');
 assert.equal(marketFreshness('2026-09-30T09:19:00+08:00',at('09:20:00'),90,{kind:'auction'}).status,'delayed_recent_observation');
 assert.equal(marketFreshness('2026-09-30T09:15:00+08:00',at('09:20:00'),90,{kind:'auction'}).status,'delayed_observation_lagging');
 assert.equal(marketFreshness('2026-09-30T09:26:00+08:00',at('09:20:00'),90,{kind:'auction'}).status,'future_timestamp');
 assert.equal(marketFreshness('2027-01-04T09:20:00+08:00',Date.parse('2027-01-04T09:21:00+08:00'),90,{kind:'auction'}).status,'unknown');
});
