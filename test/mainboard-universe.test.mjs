import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseStockDirectory, unavailableDirectory, DIRECTORY_ENDPOINT} from '../src/stock-directory.mjs';
import {expectedSwingSession, SWING_DEFAULTS, unavailableSwing} from '../src/swing-screening.mjs';
import {
  MAINBOARD_UNIVERSE_VERSION, MAINBOARD_UNIVERSE_REQUEST, MAINBOARD_CLASSIFICATIONS, MAINBOARD_RUN_STATUSES,
  MAINBOARD_CLASSIFICATION_RULES, classifyMainboardItem, canonicalMainboardManifest, hashMainboardManifest,
  buildMainboardUniverse, validateMainboardRunCoverage, buildMainboardRunLedger
} from '../src/mainboard-universe.mjs';

const now = Date.parse('2026-10-03T04:00:00Z'), snapshot = now - 86400000;
const row = (ticker = '600522', exchange = 'SH', name = '测试股票') => ({
  ticker, exchange, thscode: ticker + '.' + exchange, name, asset_type: 'a-share', currency: 'CNY',
  list_date: '2002-10-24', end_date: null, last_trade_date: null, last_delivery_date: null
});
const directory = (rows = [row()], args = MAINBOARD_UNIVERSE_REQUEST, timestamp = snapshot) =>
  parseStockDirectory({code: 0, data: {timestamp, item: rows}}, args, now);
const build = value => buildMainboardUniverse(value, {now});
const classified = (ticker, exchange = 'SZ', name = '测试') => classifyMainboardItem(directory([row(ticker, exchange, name)]).items[0]);
const partition = universe => {
  assert.equal(universe.coverage.provider_rows, MAINBOARD_CLASSIFICATIONS.reduce((total, label) => total + universe.coverage[label], 0));
  assert.equal(universe.classifications.length, universe.coverage.provider_rows);
  assert.equal(universe.items.length, universe.coverage.eligible_mainboard_non_st);
};
const bulkRows = () => Array.from({length: 10000}, (_, i) => {
  const prefixes = ['600', '601', '603', '605', '688', '689', '000', '001', '002', '003'];
  return row(prefixes[Math.floor(i / 1000)] + String(i % 1000).padStart(3, '0'), i < 6000 ? 'SH' : 'SZ');
});

test('fixed request is exactly one bounded provider directory contract and rules match current swing', async () => {
  assert.deepEqual(MAINBOARD_UNIVERSE_REQUEST, {offset: 0, limit: 10000});
  assert.equal(Object.isFrozen(MAINBOARD_UNIVERSE_REQUEST), true);
  const u = await build(directory());
  assert.equal(u.available, true);
  assert.equal(u.scope, 'sh_sz_mainboard_excluding_st_names');
  assert.equal(u.universe_version, MAINBOARD_UNIVERSE_VERSION);
  assert.equal(u.manifest_version, MAINBOARD_UNIVERSE_VERSION);
  assert.equal(u.read_only, true);
  assert.equal(u.source, 'hithink');
  assert.equal(u.source_endpoint, DIRECTORY_ENDPOINT);
  assert.equal(u.snapshot_timestamp, snapshot);
  assert.equal(u.source_timestamp, new Date(snapshot).toISOString());
  assert.equal(u.fetched_at, new Date(now).toISOString());
  assert.equal(u.expected_session_date, expectedSwingSession(now));
  assert.equal(u.expected_session_date, '2026-09-30');
  assert.equal(u.rules.version, 'swing-daily-v1');
  assert.deepEqual(u.rules.thresholds, SWING_DEFAULTS);
  assert.equal(u.manifest_hash_algorithm, 'SHA-256');
  assert.match(u.manifest_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(u.items.map(item => [item.symbol, item.name]), [['sh600522', '测试股票']]);
  partition(u);
});

test('fixed SH normal mainboard boundaries include only 600/601/603/605 and exclude STAR/CDR', () => {
  for (const ticker of ['600000', '600999', '601000', '601999', '603000', '603999', '605000', '605999']) {
    assert.equal(classified(ticker, 'SH').classification, 'eligible_mainboard_non_st', ticker);
  }
  for (const ticker of ['602000', '602999', '604000', '604999', '606000', '607000', '609999', '699999', '900901']) {
    assert.equal(classified(ticker, 'SH').classification, 'unsupported', ticker);
  }
  for (const ticker of ['688000', '688999', '689000', '689999']) {
    assert.equal(classified(ticker, 'SH').classification, 'excluded_other_boards', ticker);
  }
});

test('SZ normal range includes original 002 and 004; inclusive 001001–001199 CDR interval is excluded', () => {
  for (const ticker of ['000001', '000999', '001000', '001200', '001999', '002000', '002001', '002999', '003000', '003999', '004000', '004999']) {
    assert.equal(classified(ticker).classification, 'eligible_mainboard_non_st', ticker);
  }
  for (const ticker of ['001001', '001099', '001199']) {
    const item = classified(ticker); assert.equal(item.classification, 'excluded_other_boards');
    assert.equal(item.board, 'sz_mainboard_cdr');
  }
  assert.equal(classified('000000').classification, 'unclassified');
  assert.equal(classified('005000').classification, 'unsupported');
  assert.equal(classified('200001').classification, 'unsupported');
  for (const ticker of ['300000', '300999', '301000', '301999']) assert.equal(classified(ticker).classification, 'excluded_other_boards');
  assert.equal(MAINBOARD_CLASSIFICATION_RULES.original_sme_002_included, true);
});

test('Beijing is outside mainboard scope while unsupported canonical Beijing identities stay unsupported', () => {
  for (const ticker of ['400001', '800001', '920002']) assert.equal(classified(ticker, 'BJ').classification, 'excluded_other_boards');
  for (const ticker of ['100001', '000001']) assert.equal(classified(ticker, 'BJ').classification, 'unsupported');
});

test('NFKC, trim and case-insensitive ST/*ST name filter preserves original source names and official unknown states', async () => {
  const names = ['ST 测试', '*ST 测试', 'st测试', '*sT测试', 'ＳＴ测试', '＊ＳＴ测试', 'Ｓｔ测试', '　＊ＳＴ 测试　'];
  const d = directory(names.map((name, i) => row('600' + String(i).padStart(3, '0'), 'SH', name)));
  const u = await build(d);
  assert.equal(u.available, true);
  assert.equal(u.coverage.excluded_st_name, names.length);
  assert.equal(u.coverage.eligible_mainboard_non_st, 0);
  for (let i = 0; i < names.length; i++) {
    const item = u.classifications[i];
    assert.equal(item.name, d.items[i].name);
    assert.equal(item.name_hints.st_prefix, true);
    assert.equal(item.name_hints.normalization, 'NFKC');
    for (const status of Object.values(item.status)) assert.equal(status, 'unknown');
  }
  assert.ok(u.warnings.includes('SOURCE_ST_NAME_HINT_DIFFERS_FROM_NFKC_FILTER'));
  partition(u);
});

test('source name hints cannot override independently recomputed name filtering or establish official ST', async () => {
  const d = directory([row('600000', 'SH', '普通ST中间'), row('600001', 'SH', 'ＳＴ测试')]);
  d.items[0].name_hints.st_prefix = true;
  d.items[0].status.st = 'true';
  d.items[1].name_hints.st_prefix = false;
  const u = await build(d);
  assert.equal(u.items.length, 1);
  assert.equal(u.items[0].name, '普通ST中间');
  assert.equal(u.classifications[0].name_hints.source_hint_matches, false);
  assert.equal(u.classifications[1].classification, 'excluded_st_name');
  assert.equal(u.classifications[1].name_hints.source_hint_matches, false);
  assert.equal(u.classifications[0].status.st, 'unknown');
  assert.equal(u.classifications[1].status.st, 'unknown');
  const missing = directory(); delete missing.items[0].name_hints;
  assert.equal((await build(missing)).items[0].name_hints.source_hint_matches, null);
});

test('coverage labels are mutually exclusive with unsupported and other-board priority before ST', async () => {
  const u = await build(directory([
    row('600522'), row('000001', 'SZ', '*ST测试'), row('688001', 'SH', 'ST测试'),
    row('001001', 'SZ', 'ST测试'), row('000000', 'SZ', 'ST测试'), row('005001', 'SZ', 'ST测试'),
    row('999999', 'SH'), row('100001', 'BJ')
  ]));
  assert.equal(u.available, true);
  assert.deepEqual(Object.fromEntries(MAINBOARD_CLASSIFICATIONS.map(label => [label, u.coverage[label]])), {
    eligible_mainboard_non_st: 1, excluded_st_name: 1, excluded_other_boards: 2, unclassified: 1, unsupported: 3
  });
  assert.equal(u.coverage.provider_rows, 8);
  assert.equal(u.classifications.find(item => item.symbol === 'sz000000').reason_codes[0], 'NO_FIXED_NORMAL_A_SHARE_BOARD_CLASSIFICATION');
  assert.ok(u.warnings.includes('UNSUPPORTED_SOURCE_IDENTITIES_RETAINED_AND_COUNTED'));
  partition(u);
});

test('empty and short source response have provider-end evidence but never establish complete exchange coverage', async () => {
  for (const rows of [[], [row()], [row('005001', 'SZ')]]) {
    const u = await build(directory(rows));
    assert.equal(u.available, true);
    assert.equal(u.coverage.provider_rows, rows.length);
    assert.equal(u.coverage.source_page_end_observed, true);
    assert.equal(u.coverage.provider_directory_end_from_start_observed, true);
    assert.equal(u.coverage.source_directory_response_classification_complete, true);
    assert.equal(u.coverage.complete_universe, false);
    assert.equal(u.coverage.complete_exchange_universe, false);
    assert.equal(u.coverage.exchange_directory_completeness, 'unverified');
    assert.equal(u.coverage.total, null);
    assert.equal(u.coverage.next_offset, null);
    partition(u);
  }
});

test('exactly 10000 rows is a valid bounded response with unread-continuation uncertainty, not a complete exchange universe', async () => {
  const u = await build(directory(bulkRows()));
  assert.equal(u.available, true);
  assert.equal(u.coverage.provider_rows, 10000);
  assert.equal(u.coverage.eligible_mainboard_non_st, 7800);
  assert.equal(u.coverage.excluded_other_boards, 2199);
  assert.equal(u.coverage.unclassified, 1);
  assert.equal(u.coverage.source_page_end_observed, false);
  assert.equal(u.coverage.provider_directory_end_from_start_observed, false);
  assert.equal(u.coverage.next_offset, 10000);
  assert.equal(u.coverage.more_pages, 'unknown');
  assert.equal(u.coverage.complete_exchange_universe, false);
  partition(u);
});

test('source failure and malformed/incomplete directory return structured unavailable rather than empty success', async () => {
  const failed = unavailableDirectory(MAINBOARD_UNIVERSE_REQUEST, 'request_failed', {error_kind: 'DIRECTORY_TIMEOUT'});
  for (const input of [failed, null, [], {}, {...directory(), available: false}]) {
    const u = await build(input);
    assert.equal(u.available, false);
    assert.equal(u.data_status, 'unavailable');
    assert.deepEqual(u.items, []);
    assert.deepEqual(u.classifications, []);
    assert.equal(u.coverage, null);
    assert.equal(u.manifest, null);
    assert.equal(u.manifest_hash, null);
    assert.equal(u.snapshot_timestamp, null);
  }
  assert.equal((await build(failed)).reason_codes[0], 'MAINBOARD_SOURCE_DIRECTORY_UNAVAILABLE');
  for (const args of [{offset: 0, limit: 100}, {offset: 10000, limit: 10000}, {offset: 0, limit: 10000, expected_snapshot_timestamp: snapshot}]) {
    assert.equal((await build(directory([row()], args))).reason_codes[0], 'MAINBOARD_DIRECTORY_INCOMPLETE_REQUEST');
  }
});

test('metadata is checked rather than trusting full-page or completeness claims', async () => {
  const mutations = [
    d => { delete d.coverage; }, d => { delete d.request; }, d => { delete d.items; },
    d => { d.coverage.provider_rows = 999; d.coverage.returned_count = 999; },
    d => { d.coverage.complete_universe = true; }, d => { d.coverage.exchange_directory_completeness = 'complete'; },
    d => { d.coverage.source_response_count = 2; }, d => { d.coverage.retrieval_mode = 'bounded_page'; },
    d => { d.coverage.market_data_supported_count = 0; }, d => { d.coverage.market_data_unsupported_count = 1; },
    d => { d.coverage.source_page_end_observed = false; }, d => { d.coverage.provider_directory_end_from_start_observed = false; },
    d => { d.coverage.next_offset = 10000; }, d => { d.coverage.total = 1; }, d => { d.coverage.more_pages = false; },
    d => { d.coverage.ordering_and_atomicity = 'guaranteed'; }, d => { d.source = 'other'; },
    d => { d.source_endpoint = 'https://bad.test'; }, d => { d.read_only = false; }, d => { d.cloud_bridge_requests = true; },
    d => { d.fetched_at = 'bad'; }, d => { d.source_timestamp_semantics = 'quote_time'; }
  ];
  for (const mutate of mutations) {
    const d = directory(); mutate(d); const u = await build(d);
    assert.equal(u.available, false, mutate.toString()); assert.equal(u.coverage, null);
  }
});

test('identity and name/date/support conflicts reject whole response with no accepted partial rows', async () => {
  for (const mutate of [
    d => { d.items[1].symbol = 'sh600000'; }, d => { d.items[1].ticker = '600000'; },
    d => { d.items[1].thscode = '600000.SH'; }, d => { d.items[1].market = 'SH'; },
    d => { d.items[1].asset_type = 'fund-etf'; }, d => { d.items[1].market_data_supported = false; },
    d => { d.items[1].ticker = '000001.SZ'; }, d => { d.items[1].market = 'HK'; },
    d => { d.items[1].name = ''; }, d => { d.items[1].name = 'bad\nname'; }, d => { d.items[1].name = 'x'.repeat(81); },
    d => { d.items[1].list_date = '2026-02-30'; }, d => { delete d.items[1].last_trade_date; }
  ]) {
    const d = directory([row(), row('000001', 'SZ')]); mutate(d);
    const u = await build(d); assert.equal(u.available, false, mutate.toString());
    assert.deepEqual(u.items, []); assert.deepEqual(u.classifications, []); assert.equal(u.coverage, null);
  }
  const duplicate = directory([row(), row('000001', 'SZ')]); duplicate.items[1] = {...duplicate.items[0]};
  assert.equal((await build(duplicate)).reason_codes[0], 'MAINBOARD_DIRECTORY_DUPLICATE_IDENTITY');
});

test('mixed, changed, future and invalid snapshots fail rather than joining records', async () => {
  for (const mutate of [
    d => { d.items[1].snapshot_timestamp = snapshot - 1; }, d => { d.items[1].source_timestamp = new Date(snapshot - 1).toISOString(); },
    d => { d.source_timestamp = new Date(snapshot - 1).toISOString(); }, d => { d.snapshot_timestamp = '123'; },
    d => { d.snapshot_timestamp = now + 6000; d.source_timestamp = new Date(now + 6000).toISOString(); }
  ]) {
    const d = directory([row(), row('000001', 'SZ')]); mutate(d);
    assert.equal((await build(d)).available, false, mutate.toString());
  }
  const same = directory(); same.items[0].snapshot_timestamp = snapshot; same.items[0].source_timestamp = same.source_timestamp;
  assert.equal((await build(same)).available, true);
});

test('canonical SHA-256 is stable under directory and manifest row reordering and object key order', async () => {
  const rows = [row('000001', 'SZ'), row('600522'), row('005001', 'SZ'), row('001001', 'SZ')];
  const first = await build(directory(rows)), reordered = await build(directory([...rows].reverse()));
  assert.equal(first.manifest_hash, reordered.manifest_hash);
  assert.deepEqual(first.items, reordered.items);
  const manifest = Object.fromEntries(Object.entries(first.manifest).reverse());
  manifest.items = first.manifest.items.slice().reverse().map(item => Object.fromEntries(Object.entries(item).reverse()));
  assert.equal(canonicalMainboardManifest(first.manifest), canonicalMainboardManifest(manifest));
  assert.equal(await hashMainboardManifest(manifest), first.manifest_hash);
  assert.equal(createHash('sha256').update(canonicalMainboardManifest(first.manifest)).digest('hex'), first.manifest_hash);
});

test('manifest binds snapshot, identities, original names and classification but excludes receipt time and session cutoff', async () => {
  const d = directory([row(), row('005001', 'SZ')]), first = await build(d);
  const laterReceipt = structuredClone(d); laterReceipt.fetched_at = new Date(now + 1000).toISOString();
  assert.equal((await build(laterReceipt)).manifest_hash, first.manifest_hash);
  const nextCutoff = await buildMainboardUniverse(d, {now: Date.parse('2026-10-09T04:00:00Z')});
  assert.notEqual(nextCutoff.expected_session_date, first.expected_session_date);
  assert.equal(nextCutoff.manifest_hash, first.manifest_hash);
  assert.notEqual((await build(directory([row(), row('005001', 'SZ')], MAINBOARD_UNIVERSE_REQUEST, snapshot - 1))).manifest_hash, first.manifest_hash);
  const changedName = structuredClone(d); changedName.items[0].name = '新名称';
  assert.notEqual((await build(changedName)).manifest_hash, first.manifest_hash);
  const changedUnsupportedName = structuredClone(d); changedUnsupportedName.items[1].name = '另一名称';
  assert.notEqual((await build(changedUnsupportedName)).manifest_hash, first.manifest_hash);
  const normalizedDifferent = structuredClone(d); normalizedDifferent.items[0].name = '测试ＳＴ';
  assert.notEqual((await build(normalizedDifferent)).manifest_hash, first.manifest_hash);
});

test('WebCrypto failure or absence is explicitly unavailable and never substituted with a weak hash', async () => {
  const first = await build(directory());
  assert.equal(await hashMainboardManifest(first.manifest, {cryptoImpl: null}), null);
  for (const [cryptoImpl, reason] of [
    [null, 'MAINBOARD_MANIFEST_HASH_UNAVAILABLE'], [{}, 'MAINBOARD_MANIFEST_HASH_UNAVAILABLE'],
    [{subtle: {digest: async () => { throw Error('provider or credential text must never leak'); }}}, 'MAINBOARD_MANIFEST_HASH_FAILED'],
    [{subtle: {digest: async () => new ArrayBuffer(5)}}, 'MAINBOARD_MANIFEST_HASH_FAILED']
  ]) {
    const u = await buildMainboardUniverse(directory(), {now, cryptoImpl});
    assert.equal(u.available, false); assert.equal(u.reason_codes[0], reason); assert.equal(u.coverage, null);
    assert.equal(JSON.stringify(u).includes('credential text'), false);
  }
});

test('manifest canonicalization rejects duplicates, non-JSON values and cycles', async () => {
  const {manifest} = await build(directory());
  assert.throws(() => canonicalMainboardManifest({...manifest, items: [...manifest.items, manifest.items[0]]}), /MAINBOARD_MANIFEST_INVALID/);
  assert.throws(() => canonicalMainboardManifest({...manifest, injected: undefined}), /MAINBOARD_MANIFEST_INVALID_VALUE/);
  assert.throws(() => canonicalMainboardManifest({...manifest, injected: NaN}), /MAINBOARD_MANIFEST_INVALID_VALUE/);
  const cyclic = {...manifest}; cyclic.injected = cyclic;
  assert.throws(() => canonicalMainboardManifest(cyclic), /MAINBOARD_MANIFEST_INVALID_VALUE/);
});

test('outside-calendar expected cutoff stays unknown; valid universe never invents a session', async () => {
  const u = await buildMainboardUniverse(directory(), {now: Date.parse('2027-01-05T04:00:00Z')});
  assert.equal(u.available, true); assert.equal(u.expected_session_date, null);
  for (const invalidNow of [NaN, Infinity, '123', null, 1.5]) {
    assert.equal((await buildMainboardUniverse(directory(), {now: invalidNow})).reason_codes[0], 'MAINBOARD_INVALID_NOW');
  }
});

test('pure run ledger partitions existing swing statuses, failed-without-result and pending without relabeling source failures', async () => {
  const u = await build(directory(Array.from({length: 5}, (_, i) => row('600' + String(i).padStart(3, '0')))));
  const insufficient = unavailableSwing(u.items[2].symbol, 'SOURCE_TIMEOUT');
  const ledger = buildMainboardRunLedger(u, [
    {symbol: u.items[0].symbol, status: 'match'}, {symbol: u.items[1].symbol, status: 'not_match'},
    insufficient, {symbol: u.items[3].symbol, status: 'failed_without_result'}
  ]);
  assert.deepEqual(ledger.coverage, {eligible_mainboard_non_st: 5, match: 1, not_match: 1, insufficient_data: 1, failed_without_result: 1, pending: 1, partition_valid: true});
  assert.equal(ledger.manifest_hash, u.manifest_hash);
  assert.equal(ledger.expected_session_date, u.expected_session_date);
  assert.equal(ledger.rules_version, 'swing-daily-v1');
  assert.equal(ledger.complete, false);
  assert.equal(ledger.complete_exchange_universe, false);
  assert.equal(ledger.entries[2].status, 'insufficient_data');
  assert.equal(insufficient.reason_codes[0], 'SOURCE_TIMEOUT');
  assert.equal(buildMainboardRunLedger(u, u.items.map(item => ({symbol: item.symbol, status: 'failed_without_result'}))).complete, true);
});

test('run ledger rejects duplicate, foreign, invalid-status and mixed-cutoff results rather than counting them twice', async () => {
  const u = await build(directory([row(), row('000001', 'SZ')]));
  const valid = {symbol: u.items[0].symbol, status: 'match'};
  for (const entries of [[valid, valid], [{symbol: 'sh600000', status: 'match'}], [{symbol: valid.symbol, status: 'failed'}],
    [{symbol: valid.symbol, status: null}], [null], [{...valid, freshness: {expected_session_date: '2026-09-29'}}]]) {
    assert.throws(() => buildMainboardRunLedger(u, entries));
  }
  assert.throws(() => buildMainboardRunLedger({...u, manifest_hash: null}, []), /MAINBOARD_RUN_INVALID_UNIVERSE/);
  assert.throws(() => buildMainboardRunLedger({...u, items: [...u.items, u.items[0]]}, []), /MAINBOARD_RUN_INVALID_UNIVERSE/);
  assert.throws(() => buildMainboardRunLedger({...u, coverage: {...u.coverage, eligible_mainboard_non_st: 3}}, []), /MAINBOARD_RUN_INVALID_UNIVERSE/);
  assert.throws(() => buildMainboardRunLedger({...u, rules: {...u.rules, thresholds: {...u.rules.thresholds, breakout_volume_ratio: 2}}}, []), /MAINBOARD_RUN_INVALID_UNIVERSE/);
});

test('run coverage identity must sum exactly and every status counter is a nonnegative integer', async () => {
  const empty = {eligible_mainboard_non_st: 0, ...Object.fromEntries(MAINBOARD_RUN_STATUSES.map(status => [status, 0]))};
  assert.equal(validateMainboardRunCoverage(empty), true);
  assert.throws(() => validateMainboardRunCoverage({...empty, match: 1}), /MAINBOARD_RUN_INVALID_STATUS_PARTITION/);
  for (const status of MAINBOARD_RUN_STATUSES) for (const value of [-1, 1.5, '0', NaN, undefined]) {
    assert.throws(() => validateMainboardRunCoverage({...empty, [status]: value}), /MAINBOARD_RUN_INVALID_STATUS_PARTITION/);
  }
  const u = await build(directory([]));
  const ledger = buildMainboardRunLedger(u);
  assert.equal(ledger.complete, true);
  assert.deepEqual(ledger.coverage, {...empty, partition_valid: true});
});

test('classification, manifest build and ledger do not mutate source responses or supplied result rows', async () => {
  const d = directory([row(), row('000001', 'SZ')]), before = structuredClone(d);
  const u = await build(d);
  assert.deepEqual(d, before);
  const entries = [{symbol: u.items[0].symbol, status: 'not_match'}], entriesBefore = structuredClone(entries);
  buildMainboardRunLedger(u, entries);
  assert.deepEqual(entries, entriesBefore);
});
