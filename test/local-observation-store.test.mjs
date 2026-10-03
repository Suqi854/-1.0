import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase, isTrustedLocalDatabase} from '../portable/sqlite.mjs';
import {archiveObservations, readArchive, snapshotKey, saveSnapshot, readSnapshot, storageHealth, saveAuctionSnapshot, readAuctionSnapshot, auctionWithLocalStorage} from '../portable/local-observation-store.mjs';

// Entirely invented observations and stub sources; no files, network or live data.
const symbol = 'sh600000';
const auctionNow = Date.parse('2026-09-30T10:00:00Z');
const archiveArgs = {symbol, source: 'tencent', interval: '1d', adjustment: 'none', limit: 10};
const archiveSample = () => ({symbol, source: 'tencent', interval: '1d', adjustment: 'none', fetched_at: '2026-09-30T08:00:00Z', bars: [
  {source_timestamp: '2026-09-28T15:00:00+08:00', close: 10, complete: true},
  {source_timestamp: '2026-09-29T15:00:00+08:00', close: 11, complete: true},
  {source_timestamp: '2026-09-30T15:00:00+08:00', close: 12, complete: false}
]});
const auctionSample = (count = 2, fetched = '2026-09-30T01:32:00Z', startMinute = 15) => {
  const points = Array.from({length: count}, (_, offset) => ({source_timestamp: '2026-09-30T09:' + String(startMinute + offset).padStart(2, '0') + ':00+08:00', observed_price: 10, reported_volume_shares: null, reported_amount_cny: null}));
  return {symbol, source: 'eastmoney', session_date: '2026-09-30', source_timestamp: points.at(-1)?.source_timestamp, fetched_at: fetched, points, warnings: ['PARTIAL_AUCTION_COVERAGE_ONLY'], capabilities: {full_auction_feed: false}, cache: {used: false}};
};

function database(t) {
  const env = openLocalDatabase(':memory:');
  t.after(() => { if (isTrustedLocalDatabase(env)) env.close(); });
  return env;
}

async function rejectCapability(env, argument, callback) {
  assert.equal((await archiveObservations(env, argument)).reason, 'TRUSTED_LOCAL_STORAGE_REQUIRED');
  await assert.rejects(() => readArchive(env, argument), /^Error: LOCAL_ARCHIVE_STORAGE_UNAVAILABLE$/);
  assert.equal((await saveSnapshot(env, argument, argument)).reason, 'TRUSTED_LOCAL_STORAGE_REQUIRED');
  assert.equal(await readSnapshot(env, argument, argument), null);
  assert.equal((await storageHealth(env)).reason, 'TRUSTED_LOCAL_STORAGE_REQUIRED');
  assert.equal((await saveAuctionSnapshot(env, argument, argument, argument)).reason, 'TRUSTED_LOCAL_STORAGE_REQUIRED');
  assert.equal(await readAuctionSnapshot(env, argument, argument, argument), null);
  await assert.rejects(() => auctionWithLocalStorage(env, argument, callback, argument), /^Error: LOCAL_AUCTION_STORAGE_UNAVAILABLE$/);
}

test('pure snapshot keys preserve legacy request shape and separate window, basis and completeness', () => {
  assert.equal(snapshotKey('get_bars', {symbol}), JSON.stringify(['get_bars', symbol, null, 'none', false, null]));
  assert.equal(snapshotKey('get_bars'), JSON.stringify(['get_bars', null, null, 'none', false, null]));
  const variations = [{symbol}, {symbol, adjustment: 'qfq'}, {symbol, interval: '1d'}, {symbol, include_incomplete: true}, {symbol, limit: 20}, {symbol: 'sz000001'}];
  assert.equal(new Set(variations.map(args => snapshotKey('get_bars', args))).size, variations.length);
});

test('untrusted Proxy env and all rejected arguments receive zero property traps', async () => {
  let envTraps = 0, argumentTraps = 0, calls = 0;
  const env = new Proxy({}, {get() { envTraps++; throw Error('ENV_READ'); }, has() { envTraps++; return false; }, ownKeys() { envTraps++; return []; }, getPrototypeOf() { envTraps++; return null; }});
  const argument = new Proxy({}, {get() { argumentTraps++; throw Error('ARGUMENT_READ'); }});
  await rejectCapability(env, argument, () => { calls++; });
  assert.equal(envTraps, 0);
  assert.equal(argumentTraps, 0);
  assert.equal(calls, 0);
});

test('counterfeit D1, inherited and copied local envs cannot receive a storage capability', async t => {
  const real = database(t);
  let reads = 0, calls = 0;
  const counterfeit = {get DB() { reads++; return real.DB; }};
  for (const env of [undefined, null, {}, {DB: {prepare() { calls++; }}}, {DB: real.DB}, {...real}, Object.create(real), counterfeit, new Proxy(real, {})]) {
    await rejectCapability(env, {}, () => { calls++; });
  }
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test('a revoked Proxy env is rejected without triggering its revoked traps', async () => {
  const {proxy, revoke} = Proxy.revocable({}, {});
  revoke();
  let argumentReads = 0;
  const argument = new Proxy({}, {get() { argumentReads++; throw Error('ARGUMENT_READ'); }});
  await rejectCapability(proxy, argument, () => assert.fail('source must not run'));
  assert.equal(argumentReads, 0);
});

test('close revokes local capability before any subsequent DB, data or request access', async t => {
  const env = database(t);
  assert.equal(isTrustedLocalDatabase(env), true);
  env.close();
  assert.equal(isTrustedLocalDatabase(env), false);
  let reads = 0;
  const argument = new Proxy({}, {get() { reads++; throw Error('AFTER_CLOSE_ARGUMENT_READ'); }});
  await rejectCapability(env, argument, () => assert.fail('source must not run'));
  assert.equal(reads, 0);
});

test('trusted local env and its DB facade cannot be replaced with a cloud facade', t => {
  const env = database(t);
  assert.equal(Object.isFrozen(env), true);
  assert.equal(Object.isFrozen(env.DB), true);
  assert.throws(() => { env.DB = {prepare() { assert.fail('cloud facade'); }}; }, TypeError);
  assert.throws(() => { env.DB.prepare = () => assert.fail('cloud prepare'); }, TypeError);
});

test('local archive keeps source and adjustment isolated and counts only completed observations', async t => {
  const env = database(t), data = archiveSample();
  data.bars.push({...data.bars[0], source_timestamp: '2026-09-25T15:00:00+08:00', complete: undefined});
  data.bars.push({...data.bars[0], source_timestamp: '2026-09-24T15:00:00+08:00', pending: true});
  data.bars.push({...data.bars[0], source_timestamp: '2026-09-23T15:00:00+08:00', status: 'pending'});
  const saved = await archiveObservations(env, data);
  assert.equal(saved.saved, true);
  assert.equal(saved.observations, 2);
  assert.equal(saved.policy, 'explicit_local_request_observations');
  await archiveObservations(env, {...data, source: 'sina', bars: [{...data.bars[0], close: 20}]});
  await archiveObservations(env, {...data, adjustment: 'qfq', bars: [{...data.bars[0], close: 30}]});
  const read = await readArchive(env, archiveArgs);
  assert.deepEqual(read.bars.map(row => row.close), [10, 11]);
  assert.equal(read.archive.total_observed_records, 2);
  assert.equal(read.archive.full_history, false);
  assert.equal(read.archive.storage_scope, 'local_node_sqlite');
  assert.equal((await readArchive(env, {...archiveArgs, source: 'sina'})).bars[0].close, 20);
  assert.equal((await readArchive(env, {...archiveArgs, adjustment: 'qfq'})).bars[0].close, 30);
  assert.match(read.warnings[0], /NOT_LIVE/);
});

test('local archive revisions preserve nulls, first receipt and idempotence across clock formats', async t => {
  const env = database(t), sample = archiveSample();
  const data = {...sample, bars: [{...sample.bars[0], amount_cny: null}]};
  await archiveObservations(env, data);
  await archiveObservations(env, {...data, fetched_at: '2026-09-30T08:10:00Z'});
  let read = await readArchive(env, archiveArgs);
  assert.equal(read.bars[0].provenance.revision_count, 0);
  assert.equal(read.bars[0].provenance.first_fetched_at, data.fetched_at);
  assert.equal(read.bars[0].amount_cny, null);
  await archiveObservations(env, {...data, fetched_at: '2026-09-30T08:20:00Z', bars: [{...data.bars[0], close: 13}]});
  await archiveObservations(env, {...data, fetched_at: '2026-09-30T16:15:00+08:00', bars: [{...data.bars[0], close: 99}]});
  read = await readArchive(env, archiveArgs);
  assert.equal(read.bars[0].close, 13);
  assert.equal(read.bars[0].provenance.revision_count, 1);
  assert.equal(read.bars[0].provenance.last_fetched_at, '2026-09-30T08:20:00Z');
});

test('local archive pagination is exclusive and returns each window chronologically', async t => {
  const env = database(t);
  await archiveObservations(env, archiveSample());
  const latest = await readArchive(env, {...archiveArgs, limit: 1});
  assert.equal(latest.bars[0].close, 11);
  assert.equal(latest.archive.has_more, true);
  const earlier = await readArchive(env, {...archiveArgs, limit: 1, before: latest.archive.next_before});
  assert.equal(earlier.bars[0].close, 10);
  assert.equal(earlier.archive.has_more, false);
  assert.equal(earlier.archive.next_before, null);
});

test('local intraday archive remains separate from bar intervals and filters incomplete points', async t => {
  const env = database(t), sample = archiveSample();
  await archiveObservations(env, sample);
  const points = [{source_timestamp: '2026-09-30T09:31:00+08:00', price: 10, complete: true}, {source_timestamp: '2026-09-30T09:32:00+08:00', price: 11, complete: false}];
  await archiveObservations(env, {symbol, source: 'tencent', fetched_at: sample.fetched_at, points});
  const read = await readArchive(env, {...archiveArgs, interval: 'intraday'});
  assert.equal(read.points.length, 1);
  assert.equal(read.session_date, null);
  assert.equal(read.coverage.full_session_verified, false);
  assert.equal((await readArchive(env, archiveArgs)).bars.length, 2);
});

test('local archive empty or invalid input never manufactures saved observations', async t => {
  const env = database(t), sample = archiveSample();
  assert.equal((await archiveObservations(env, {...sample, bars: sample.bars.map(row => ({...row, complete: false}))})).observations, 0);
  assert.equal((await archiveObservations(env, {...sample, fetched_at: 'invalid'})).saved, false);
  assert.equal((await archiveObservations(env, {...sample, bars: [{complete: true, source_timestamp: 'invalid'}]})).saved, false);
  const read = await readArchive(env, archiveArgs);
  assert.equal(read.archive.total_observed_records, 0);
  assert.deepEqual(read.bars, []);
  for (const limit of [0, -1, 601, 1.5, '2']) await assert.rejects(() => readArchive(env, {...archiveArgs, limit}), /^Error: LOCAL_ARCHIVE_READ_FAILED$/);
});

test('later local archive batch failure reports partial failure rather than complete success', async t => {
  const env = database(t), sample = archiveSample();
  const bars = Array.from({length: 100}, (_, offset) => ({source_timestamp: new Date(Date.parse('2026-01-01T07:00:00Z') + offset * 86400000).toISOString(), close: 10, complete: true}));
  await env.DB.prepare("CREATE TRIGGER stop_late_batch BEFORE INSERT ON market_archive WHEN NEW.source_timestamp='" + bars[80].source_timestamp + "' BEGIN SELECT RAISE(ABORT,'invented storage failure detail'); END").run();
  const result = await archiveObservations(env, {...sample, bars});
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'LOCAL_ARCHIVE_WRITE_FAILED_OR_PARTIAL');
  assert.equal((await readArchive(env, {...archiveArgs, limit: 120})).archive.total_observed_records, 80);
});

test('local snapshot fallback preserves source clocks, nulls and partial window semantics', async t => {
  const env = database(t), time = Date.now();
  const fetched = new Date(time - 60000).toISOString();
  const data = {symbol, source: 'sina', fetched_at: fetched, source_timestamp: new Date(time - 120000).toISOString(), bars: [{close: 10, amount_cny: null, complete: false}], warnings: ['INCOMPLETE_REQUESTED_WINDOW'], cache: {used: false}};
  const key = snapshotKey('get_bars', {symbol, include_incomplete: true});
  assert.equal((await saveSnapshot(env, key, data)).persisted, true);
  const read = await readSnapshot(env, key, time);
  assert.equal(read.fetched_at, data.fetched_at);
  assert.equal(read.source_timestamp, data.source_timestamp);
  assert.deepEqual(read.bars, data.bars);
  assert.equal(read.cache.age_seconds, 60);
  assert.equal(read.cache.max_age_seconds, 604800);
  assert.equal(read.cache.storage_scope, 'local_node_sqlite');
  assert.equal(read.storage.read_from_storage, true);
  assert.match(read.warnings.at(-1), /NOT_LIVE/);
  assert.equal(await readSnapshot(env, snapshotKey('get_bars', {symbol}), time), null);
});

test('local snapshot does not replace a newer receipt or persist a cached fallback', async t => {
  const env = database(t), time = Date.now();
  const data = {symbol, source: 'tencent', fetched_at: new Date(time - 10000).toISOString(), bars: [{close: 20}]};
  await saveSnapshot(env, 'invented-key', data);
  const older = await saveSnapshot(env, 'invented-key', {...data, fetched_at: new Date(time - 20000).toISOString(), bars: [{close: 10}]});
  assert.equal(older.persisted, false);
  assert.equal(older.reason, 'EXISTING_NEWER_LOCAL_SNAPSHOT_PRESERVED');
  const cached = await saveSnapshot(env, 'invented-key', {...data, fetched_at: new Date(time).toISOString(), cache: {used: true}, bars: [{close: 30}]});
  assert.equal(cached.persisted, false);
  assert.equal((await readSnapshot(env, 'invented-key', time)).bars[0].close, 20);
});

test('local snapshot clock bounds include exactly seven days and reject future or corrupt rows', async t => {
  const env = database(t), time = Date.now();
  const insert = (key, payload, fetched) => env.DB.prepare('INSERT INTO market_snapshots(key,payload,fetched_at,source) VALUES(?,?,?,?)').bind(key, payload, fetched, 'invented').run();
  await insert('edge', '{}', new Date(time - 604800000).toISOString());
  await insert('expired', '{}', new Date(time - 604800001).toISOString());
  await insert('future', '{}', new Date(time + 1).toISOString());
  await insert('bad-clock', '{}', 'invalid');
  await insert('bad-json', 'invalid json', new Date(time).toISOString());
  assert.equal((await readSnapshot(env, 'edge', time)).cache.age_seconds, 604800);
  for (const key of ['expired', 'future', 'bad-clock', 'bad-json', 'missing']) assert.equal(await readSnapshot(env, key, time), null);
  assert.equal(await readSnapshot(env, 'edge', NaN), null);
});

test('local storage health reports genuine local rows and fixed local policy', async t => {
  const env = database(t);
  const empty = await storageHealth(env);
  assert.equal(empty.available, true);
  assert.equal(empty.snapshot_count, 0);
  assert.equal(empty.latest_saved_fetch, null);
  const fetched = new Date().toISOString();
  await saveSnapshot(env, 'invented-one', {source: 'tencent', fetched_at: fetched});
  await saveSnapshot(env, 'invented-two', {source: 'sina', fetched_at: fetched});
  const health = await storageHealth(env);
  assert.equal(health.snapshot_count, 2);
  assert.equal(health.latest_saved_fetch, fetched);
  assert.equal(health.policy, 'explicit_local_request_observations');
  assert.equal(health.storage_scope, 'local_node_sqlite');
});

test('local SQL failures expose bounded storage errors and retain live auction observations', async t => {
  const env = database(t);
  await env.DB.prepare('DROP TABLE market_archive').run();
  assert.equal((await archiveObservations(env, archiveSample())).reason, 'LOCAL_ARCHIVE_WRITE_FAILED_OR_PARTIAL');
  await assert.rejects(() => readArchive(env, archiveArgs), /^Error: LOCAL_ARCHIVE_READ_FAILED$/);
  await env.DB.prepare('DROP TABLE market_snapshots').run();
  assert.equal((await saveSnapshot(env, 'a', {})).reason, 'LOCAL_SNAPSHOT_WRITE_FAILED');
  assert.equal(await readSnapshot(env, 'a'), null);
  assert.equal((await storageHealth(env)).reason, 'LOCAL_SNAPSHOT_READ_FAILED');
  assert.equal(await readAuctionSnapshot(env, symbol, 'failed', auctionNow), null);
  const live = await auctionWithLocalStorage(env, symbol, async () => auctionSample(), () => auctionNow);
  assert.equal(live.points.length, 2);
  assert.equal(live.storage.persisted, false);
  assert.equal(live.storage.reason, 'LOCAL_AUCTION_SNAPSHOT_WRITE_FAILED');
});

test('local same-day auction fallback survives long source failure and preserves original clocks', async t => {
  const env = database(t), sample = auctionSample();
  assert.equal((await saveAuctionSnapshot(env, symbol, sample, auctionNow)).persisted, true);
  const cached = await auctionWithLocalStorage(env, symbol, async () => { throw Error('INVENTED_SOURCE_HTTP_502'); }, () => auctionNow);
  assert.equal(cached.points.length, 2);
  assert.equal(cached.fetched_at, sample.fetched_at);
  assert.equal(cached.source_timestamp, sample.source_timestamp);
  assert.equal(cached.served_at, new Date(auctionNow).toISOString());
  assert.equal(cached.cache.used, true);
  assert.equal(cached.cache.same_session_date_only, true);
  assert.equal(cached.cache.reason, 'INVENTED_SOURCE_HTTP_502');
  assert.equal(cached.capabilities.full_auction_feed, false);
  assert.equal(cached.auction_quality.observed_minutes, 2);
  assert.match(cached.warnings.at(-1), /NOT_LIVE/);
  assert.equal(await readAuctionSnapshot(env, 'sz000001', 'failed', auctionNow), null);
  assert.equal(await readAuctionSnapshot(env, symbol, 'failed', Date.parse('2026-09-30T16:00:00Z')), null);
});

test('local auction rejects mismatched source, session, symbols, receipts and malformed point clocks', async t => {
  const env = database(t), sample = auctionSample();
  const bad = [
    {...sample, symbol: 'sz000001'}, {...sample, source: 'sina'}, {...sample, session_date: '2026-09-29'},
    {...sample, points: []}, {...sample, fetched_at: 'invalid'}, {...sample, fetched_at: new Date(auctionNow + 1).toISOString()},
    {...sample, fetched_at: '2026-09-30T01:00:00Z'}, {...sample, source_timestamp: 'invalid'}, {...sample, cache: {used: true}},
    {...sample, points: [{source_timestamp: 'invalid'}]},
    {...sample, points: [{source_timestamp: '2026-09-29T09:15:00+08:00'}]},
    {...sample, points: [sample.points[1], sample.points[0]], source_timestamp: sample.points[0].source_timestamp},
    {...sample, points: [sample.points[0], sample.points[0]], source_timestamp: sample.points[0].source_timestamp}
  ];
  for (const data of bad) assert.equal((await saveAuctionSnapshot(env, symbol, data, auctionNow)).persisted, false);
  for (const time of [NaN, Infinity, 9e15]) assert.equal((await saveAuctionSnapshot(env, symbol, sample, time)).persisted, false);
  assert.equal((await storageHealth(env)).snapshot_count, 0);
});

test('local auction five-second source skew is bounded and never produces negative fallback age', async t => {
  const env = database(t), time = Date.parse('2026-09-30T01:15:00Z');
  const stamp = '2026-09-30T09:15:05+08:00';
  const data = {...auctionSample(1, new Date(time).toISOString()), source_timestamp: stamp, points: [{source_timestamp: stamp, observed_price: 10}]};
  assert.equal((await saveAuctionSnapshot(env, symbol, data, time)).persisted, true);
  assert.equal((await readAuctionSnapshot(env, symbol, 'failed', time)).freshness.age_seconds, 0);
  const futureStamp = '2026-09-30T09:15:06+08:00';
  assert.equal((await saveAuctionSnapshot(env, symbol, {...data, source_timestamp: futureStamp, points: [{source_timestamp: futureStamp}]}, time)).persisted, false);
});

test('local auction replacement preserves fullest coverage, receipt clock and source clock', async t => {
  const env = database(t);
  await saveAuctionSnapshot(env, symbol, auctionSample(5, '2026-09-30T01:32:00Z', 20), auctionNow);
  for (const data of [auctionSample(1, '2026-09-30T02:00:00Z'), auctionSample(6, '2026-09-30T01:30:00Z', 20), auctionSample(5, '2026-09-30T02:00:00Z', 15)]) {
    const result = await saveAuctionSnapshot(env, symbol, data, auctionNow);
    assert.equal(result.persisted, false);
    assert.equal(result.reason, 'EXISTING_NEWER_OR_FULLER_SNAPSHOT_PRESERVED');
  }
  let cached = await readAuctionSnapshot(env, symbol, 'failed', auctionNow);
  assert.equal(cached.points.length, 5);
  assert.equal(cached.source_timestamp, '2026-09-30T09:24:00+08:00');
  assert.equal(cached.fetched_at, '2026-09-30T01:32:00Z');
  assert.equal((await saveAuctionSnapshot(env, symbol, auctionSample(6, '2026-09-30T10:00:00+08:00', 20), auctionNow)).persisted, true);
  cached = await readAuctionSnapshot(env, symbol, 'failed', auctionNow);
  assert.equal(cached.points.length, 6);
});

test('empty and cached auction source responses cannot erase the last-good local observations', async t => {
  const env = database(t), sample = auctionSample(5);
  await saveAuctionSnapshot(env, symbol, sample, auctionNow);
  const empty = await auctionWithLocalStorage(env, symbol, async () => ({...sample, points: [], session_date: null}), () => auctionNow);
  assert.equal(empty.cache.reason, 'NO_CURRENT_SESSION_AUCTION_OBSERVATIONS');
  assert.equal(empty.points.length, 5);
  const cached = await auctionWithLocalStorage(env, symbol, async () => ({...auctionSample(), cache: {used: true, reason: 'INVENTED_PROVIDER_CACHE'}}), () => auctionNow);
  assert.equal(cached.points.length, 5);
  assert.equal(cached.cache.reason, 'INVENTED_PROVIDER_CACHE');
  assert.equal((await readAuctionSnapshot(env, symbol, 'failed', auctionNow)).fetched_at, sample.fetched_at);
});

test('source coverage or equal-size source-clock regression returns the preserved local auction explicitly cached', async t => {
  const env = database(t), sample = auctionSample(5, '2026-09-30T01:32:00Z', 20);
  await saveAuctionSnapshot(env, symbol, sample, auctionNow);
  for (const data of [auctionSample(1, '2026-09-30T02:00:00Z'), auctionSample(5, '2026-09-30T02:00:00Z', 15)]) {
    const result = await auctionWithLocalStorage(env, symbol, async () => data, () => auctionNow);
    assert.equal(result.points.length, 5);
    assert.equal(result.source_timestamp, sample.source_timestamp);
    assert.equal(result.fetched_at, sample.fetched_at);
    assert.equal(result.cache.used, true);
    assert.equal(result.cache.reason, 'EXISTING_NEWER_OR_FULLER_SNAPSHOT_PRESERVED');
  }
});

test('auction source failure without local fallback is truthful and bounded', async t => {
  const env = database(t);
  await assert.rejects(() => auctionWithLocalStorage(env, symbol, async () => { throw Error('INVENTED_HTTP_502\n' + 'x'.repeat(3000)); }, () => auctionNow), error => {
    assert.match(error.message, /^LOCAL_AUCTION_SOURCE_FAILED: INVENTED_HTTP_502 /);
    assert.ok(error.message.length <= 149);
    assert.equal(error.message.includes('\n'), false);
    return true;
  });
  const empty = {symbol, source: 'eastmoney', points: [], session_date: null};
  assert.equal(await auctionWithLocalStorage(env, symbol, async () => empty, () => auctionNow), empty);
});

test('auction is explicitly invoked and legacy options cannot toggle or redirect local persistence', async t => {
  const env = database(t);
  for (const callback of [undefined, null, {}, 'collect']) await assert.rejects(() => auctionWithLocalStorage(env, symbol, callback), /^Error: LOCAL_AUCTION_REQUEST_REQUIRED$/);
  let calls = 0, optionReads = 0;
  const legacyOptions = new Proxy({persistMarketData: false, DB: {}}, {get() { optionReads++; throw Error('LEGACY_OPTION_READ'); }});
  const result = await auctionWithLocalStorage(env, symbol, async requested => { calls++; assert.equal(requested, symbol); return auctionSample(); }, () => auctionNow, legacyOptions);
  assert.equal(calls, 1);
  assert.equal(optionReads, 0);
  assert.equal(result.storage.persisted, true);
});

test('closing local capability during the request denies later observation getters and writes', async t => {
  const env = database(t);
  let reads = 0;
  // Promise resolution probes `then` before this function can recheck the capability.
  const data = new Proxy({}, {get(_target, property) { if (property === 'then') return undefined; reads++; throw Error('POST_CLOSE_DATA_READ'); }});
  await assert.rejects(() => auctionWithLocalStorage(env, symbol, async () => { env.close(); return data; }, () => auctionNow), /^Error: LOCAL_AUCTION_STORAGE_UNAVAILABLE$/);
  assert.equal(reads, 0);
});

test('archive, snapshot, health and auction fallback reads remain read-only', async t => {
  const env = database(t), time = Date.now();
  await archiveObservations(env, archiveSample());
  await saveSnapshot(env, 'invented-read-only', {symbol, source: 'sina', fetched_at: new Date(time).toISOString()});
  await saveAuctionSnapshot(env, symbol, auctionSample(), auctionNow);
  for (const table of ['market_archive', 'market_snapshots']) for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    await env.DB.prepare('CREATE TRIGGER forbid_' + table + '_' + event + ' BEFORE ' + event + ' ON ' + table + " BEGIN SELECT RAISE(ABORT,'read path wrote local data'); END").run();
  }
  assert.equal((await readArchive(env, archiveArgs)).bars.length, 2);
  assert.equal((await readSnapshot(env, 'invented-read-only', time)).storage.read_from_storage, true);
  assert.equal((await storageHealth(env)).snapshot_count, 2);
  assert.equal((await readAuctionSnapshot(env, symbol, 'failed', auctionNow)).points.length, 2);
  assert.equal((await auctionWithLocalStorage(env, symbol, async () => { throw Error('INVENTED_SOURCE_FAILURE'); }, () => auctionNow)).points.length, 2);
});
