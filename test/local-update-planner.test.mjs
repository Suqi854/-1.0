import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLocalMarketTasks } from '../portable/local-update-planner.mjs';

const time = (clock, day = '2026-09-30') => Date.parse(`${day}T${clock}+08:00`);
const pool = count => Array.from({ length: count }, (_, index) => `sh${600000 + index}`);
const options = (clock = '10:00:00', changes = {}, day) => ({ now: time(clock, day), fast_quote_symbols: pool(2), research_pool_size: 101, ...changes });
const quote = plan => plan.tasks.find(task => task.kind === 'quote_batch');
const tail = plan => plan.tasks.find(task => task.kind === 'postclose_tail');

test('pure planner opens at exactly 09:00 and excludes exactly 16:00 Shanghai time', () => {
  assert.equal(planLocalMarketTasks(options('08:59:59.999')).reason, 'outside_collection_window');
  const open = planLocalMarketTasks(options('09:00:00'));
  assert.equal(open.valid, true);
  assert.equal(open.collection_window_active, true);
  assert.equal(open.market_phase, 'pre_open');
  assert.equal(open.regular_continuous_trading, false);
  assert.equal(quote(open).runnable, true);
  assert.equal(planLocalMarketTasks(options('15:59:59.999')).tasks.length, 2);
  const end = planLocalMarketTasks(options('16:00:00'));
  assert.equal(end.reason, 'outside_collection_window');
  assert.deepEqual(end.tasks, []);
  assert.equal(end.collection_window_active, false);
  assert.equal(planLocalMarketTasks({ ...options(), now: Date.parse('2026-09-30T02:00:00Z') }).session_date, '2026-09-30');
});

test('collection includes lunch and auction phases without claiming continuous trading', () => {
  for (const [clock, phase] of [['09:15:00', 'opening_auction'], ['09:25:00', 'opening_auction_gap'], ['11:30:00', 'lunch_break'], ['14:57:00', 'closing_auction'], ['15:10:00', 'after_close']]) {
    const result = planLocalMarketTasks(options(clock));
    assert.equal(result.market_phase, phase);
    assert.equal(result.regular_continuous_trading, false);
    assert.equal(quote(result).runnable, true);
  }
  assert.equal(planLocalMarketTasks(options('09:30:00')).regular_continuous_trading, true);
});

test('holiday, weekend, exchange make-up weekday and unknown calendar fail closed', () => {
  for (const day of ['2026-10-03', '2026-10-07', '2026-10-10', '2026-09-25']) {
    const result = planLocalMarketTasks(options('15:40:00', {}, day));
    assert.equal(result.reason, 'nontrading_day');
    assert.equal(result.trading_day, false);
    assert.equal(result.calendar_verified, true);
    assert.deepEqual(result.tasks, []);
  }
  for (const day of ['2025-12-31', '2027-01-04']) {
    const result = planLocalMarketTasks(options('15:40:00', {}, day));
    assert.equal(result.reason, 'calendar_unknown');
    assert.equal(result.trading_day, null);
    assert.equal(result.calendar_verified, false);
    assert.equal(result.tail.completion_gate_passed, false);
    assert.deepEqual(result.tasks, []);
  }
  assert.equal(planLocalMarketTasks(options('10:00:00', {}, '2026-10-08')).reason, 'planned');
});

test('tail uses strict >15:30:03 gate but waits for 15:35 before today-only planning', () => {
  for (const clock of ['15:30:02.999', '15:30:03']) {
    const result = planLocalMarketTasks(options(clock));
    assert.equal(result.tail.completion_gate_passed, false);
    assert.equal(tail(result), undefined);
  }
  for (const clock of ['15:30:03.001', '15:34:59.999']) {
    const result = planLocalMarketTasks(options(clock));
    assert.equal(result.tail.completion_gate_passed, true);
    assert.equal(tail(result), undefined);
  }
  const scheduled = planLocalMarketTasks(options('15:35:00'));
  assert.equal(tail(scheduled).target_session, '2026-09-30');
  assert.equal(tail(scheduled).catch_up, false);
  assert.equal(scheduled.tail.reason, 'scheduled');
  assert.equal(tail(planLocalMarketTasks(options('15:35:00.001'))).catch_up, true);
});

test('fast quotes and research tail have independent scopes without a full tail blocking quotes', () => {
  const input = options('15:35:00', { fast_quote_symbols: pool(20), research_pool_size: 101 });
  const first = planLocalMarketTasks(input);
  assert.deepEqual(first.tasks.map(task => [task.scope, task.priority, task.runnable]), [['fast_quote', 1, true], ['postclose_research_pool', 2, true]]);
  assert.equal(first.fast_quote.reason, 'scheduled');
  assert.equal(tail(first).research_pool_size, 101);
  assert.equal(first.source_budget.shared, true);
  assert.equal(first.source_budget.minimum_operation_interval_ms, 1000);
  assert.equal(first.source_budget.enforced_by_planner, false);
  assert.match(first.source_budget.dispatch_policy, /host_fair_serialisation_keep_fast_quote_responsive/);
  const acknowledged = planLocalMarketTasks({ ...input, last_due_keys: { quote: null, tail: tail(first).due_key } });
  assert.equal(tail(acknowledged), undefined);
  assert.equal(quote(acknowledged).runnable, true);
  assert.equal(quote(acknowledged).due_key, quote(first).due_key);
});

test('one-second bucket keys are stable within the second and deduplicate acknowledged work', () => {
  const first = planLocalMarketTasks(options('10:00:00.001'));
  const repeated = planLocalMarketTasks(options('10:00:00.999'));
  assert.equal(quote(first).due_key, quote(repeated).due_key);
  assert.equal(quote(first).observation_revision, quote(repeated).observation_revision);
  const saved = { quote: quote(first).due_key, tail: null };
  const deduplicated = planLocalMarketTasks(options('10:00:00.999', { last_due_keys: saved }));
  assert.equal(deduplicated.reason, 'deduplicated');
  assert.deepEqual(deduplicated.tasks, []);
  assert.notEqual(quote(planLocalMarketTasks(options('10:00:01', { last_due_keys: saved }))).due_key, saved.quote);
  const slower = planLocalMarketTasks(options('10:00:00.001', { quote_refresh_target_ms: 60000 }));
  assert.equal(quote(slower).due_key, quote(planLocalMarketTasks(options('10:00:59.999', { quote_refresh_target_ms: 60000 }))).due_key);
  assert.notEqual(quote(slower).due_key, quote(planLocalMarketTasks(options('10:01:00', { quote_refresh_target_ms: 60000 }))).due_key);
});

test('101 research members are an explicit tail denominator and never become one-second quote subscriptions', () => {
  const input = { now: time('15:35:00'), fast_quote_symbols: ['sz000001', 'sh600000'], research_pool_symbols: pool(101) };
  const result = planLocalMarketTasks(input);
  assert.equal(result.fast_quote.subscribed_symbol_count, 2);
  assert.equal(result.fast_quote.requested_refresh_target_ms, 1000);
  assert.equal(result.fast_quote.batch_count, 1);
  assert.equal(result.fast_quote.minimum_full_batch_cycle_ms, 1000);
  assert.equal(result.research_pool.size, 101);
  assert.equal(result.research_pool.denominator_basis, 'explicit_local_symbols_deduplicated');
  assert.equal(result.research_pool.denominator_frozen_for_plan, true);
  assert.equal(result.research_pool.membership_verified, false);
  assert.equal(tail(result).research_pool_size, 101);
  assert.deepEqual(quote(result).symbols, ['sh600000', 'sz000001']);
  assert.equal(result.source_freshness, 'unknown');
  assert.equal(result.source_finality, 'unknown');
  assert.equal(tail(result).symbols, undefined);
  input.research_pool_symbols.push('sh600101');
  assert.equal(tail(result).research_pool_size, 101);
  assert.equal(planLocalMarketTasks({ ...input, fast_quote_symbols: [] }).tasks.length, 1);
  assert.equal(planLocalMarketTasks({ now: time('15:35:00'), fast_quote_symbols: [] }).tasks.length, 0);
});

test('pool sorting, duplicate removal and copying are deterministic without research inference', () => {
  const input = { now: time('10:00:00'), fast_quote_symbols: ['sz000001', 'sh600002', 'sh600001', 'sh600001'], research_pool_symbols: ['sh600004', 'sh600004', 'sh600003'] };
  const before = JSON.stringify(input), result = planLocalMarketTasks(input);
  assert.equal(result.fast_quote.subscribed_symbol_count, 3);
  assert.equal(result.research_pool.size, 2);
  assert.deepEqual(quote(result).symbols, ['sh600001', 'sh600002', 'sz000001']);
  assert.equal(JSON.stringify(input), before);
  quote(result).symbols[0] = 'sh600099';
  assert.equal(input.fast_quote_symbols[0], 'sz000001');
  const empty = planLocalMarketTasks(options('15:35:00', { fast_quote_symbols: [], research_pool_size: 0 }));
  assert.deepEqual(empty.tasks, []);
  assert.equal(empty.fast_quote.batch_count, 0);
  assert.equal(empty.fast_quote.minimum_full_batch_cycle_ms, 0);
  assert.equal(empty.tail.reason, 'empty_research_pool');
});

test('public mainboard validation accepts SZ004 and ordinary A-share symbols bordering CDR range', () => {
  const symbols = ['sz004000', 'sz004999', 'sz001000', 'sz001200'];
  const result = planLocalMarketTasks({ now: time('15:35:00'), fast_quote_symbols: symbols, research_pool_symbols: symbols });
  assert.equal(result.valid, true);
  assert.deepEqual(quote(result).symbols, [...symbols].sort());
  assert.equal(result.research_pool.size, 4);
  assert.equal(tail(result).research_pool_size, 4);
});

test('public mainboard validation excludes SZ000000 and both CDR boundaries in each local scope', () => {
  for (const symbol of ['sz000000', 'sz001001', 'sz001100', 'sz001199']) {
    assert.equal(planLocalMarketTasks({ now: time('15:35:00'), fast_quote_symbols: [symbol], research_pool_size: 101 }).error_code, 'PLANNER_FAST_QUOTE_SYMBOLS');
    assert.equal(planLocalMarketTasks({ now: time('15:35:00'), fast_quote_symbols: [], research_pool_symbols: [symbol] }).error_code, 'PLANNER_RESEARCH_POOL_SYMBOLS');
  }
});

test('paused stops both kinds, including due catch-up, without activating background work', () => {
  const result = planLocalMarketTasks(options('15:50:00', { paused: true }));
  assert.equal(result.reason, 'paused');
  assert.equal(result.fast_quote.reason, 'paused');
  assert.equal(result.tail.reason, 'paused');
  assert.deepEqual(result.tasks, []);
  assert.equal(result.activated_background, false);
});

test('same-day catch-up is bounded and startup or forward clock jumps never create old backlog', () => {
  const morning = planLocalMarketTasks(options('09:00:00', {}, '2026-10-08'));
  assert.equal(tail(morning), undefined);
  const jumped = planLocalMarketTasks(options('15:59:59', {}, '2026-10-08'));
  assert.equal(jumped.tasks.length, 2);
  assert.equal(tail(jumped).target_session, '2026-10-08');
  assert.equal(tail(jumped).catch_up, true);
  assert.notEqual(tail(jumped).due_key, quote(jumped).due_key);
  assert.notEqual(tail(jumped).observation_revision, quote(jumped).observation_revision);
  assert.equal(planLocalMarketTasks(options('16:00:00', {}, '2026-10-08')).tasks.length, 0);
});

test('acknowledged future keys suppress clock regression, and tail key remains stable all day', () => {
  const first = planLocalMarketTasks(options('15:35:00'));
  const lastKeys = { quote: quote(first).due_key, tail: tail(first).due_key };
  const backward = planLocalMarketTasks(options('10:00:00', { last_due_keys: lastKeys }));
  assert.equal(backward.reason, 'deduplicated');
  assert.equal(backward.tasks.length, 0);
  assert.equal(tail(planLocalMarketTasks(options('15:50:00'))).due_key, lastKeys.tail);
  assert.equal(planLocalMarketTasks(options('15:50:00', { last_due_keys: lastKeys })).tasks.filter(task => task.kind === 'postclose_tail').length, 0);
  const yesterday = planLocalMarketTasks(options('15:40:00', { last_due_keys: lastKeys }, '2026-09-29'));
  assert.deepEqual(yesterday.tasks, []);
  const nextDay = planLocalMarketTasks(options('15:35:00', { last_due_keys: lastKeys }, '2026-10-08'));
  assert.notEqual(tail(nextDay).due_key, lastKeys.tail);
  assert.equal(nextDay.tasks.length, 2);
});

test('closed JSON contract rejects invalid values and private configuration without echoing it', () => {
  const bad = [null, [], {}, { ...options(), now: undefined }, { ...options(), now: NaN }, { ...options(), now: Infinity }, { ...options(), now: 1.1 }, { ...options(), now: '2026-09-30T10:00:00+08:00' }, { ...options(), now: 8640000000000000 },
    { ...options(), fast_quote_symbols: pool(21) }, { ...options(), fast_quote_symbols: ['SH600000'] }, { ...options(), fast_quote_symbols: ['sh688000'] }, { ...options(), fast_quote_symbols: ['sz300001'] }, { ...options(), fast_quote_symbols: ['bj430047'] }, { ...options(), fast_quote_symbols: ['sz000000'] }, { ...options(), fast_quote_symbols: [{ symbol: 'sh600000' }] },
    { ...options(), research_pool_size: -1 }, { ...options(), research_pool_size: 10001 }, { ...options(), research_pool_size: 1.1 }, { ...options(), research_pool_symbols: pool(1) }, { now: time('15:35:00'), fast_quote_symbols: [], research_pool_symbols: Array.from({ length: 10001 }, () => 'sh600000') },
    { ...options(), quote_refresh_target_ms: 999 }, { ...options(), quote_refresh_target_ms: 60001 }, { ...options(), paused: 1 }, { ...options(), quote_batch_size: 20 }, { ...options(), quote_pool: pool(101) },
    { ...options(), last_due_keys: { quote: null } }, { ...options(), last_due_keys: { quote: 'PRIVATE_KEY', tail: null } }, { ...options(), last_due_keys: { quote: null, tail: 'local-market-plan-v1:tail:2026-10-03' } },
    { ...options(), private_strategy: 'PRIVATE_STRATEGY' }, { ...options(), source_url: 'https://private.invalid/PRIVATE_URL' }, { ...options(), api_key: 'PRIVATE_API_KEY' }, { ...options(), calendar: { trading_day: true } }, { ...options(), execute: () => { throw Error('CALLBACK_EXECUTED'); } }];
  for (const input of bad) {
    const result = planLocalMarketTasks(input);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_input');
    assert.deepEqual(result.tasks, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private\.invalid/);
  }
  assert.equal(planLocalMarketTasks(JSON.stringify(options())).valid, true);
  assert.equal(planLocalMarketTasks('{').valid, false);
  assert.equal(planLocalMarketTasks(' '.repeat(250001)).error_code, 'JSON_INPUT_BOUNDS');
});

test('accessors, proxies, classes, sparse arrays and extra array fields reject without execution', () => {
  let executions = 0;
  const getter = options();
  Object.defineProperty(getter, 'now', { enumerable: true, get() { executions++; throw Error('GETTER'); } });
  const getterPool = pool(2);
  Object.defineProperty(getterPool, '0', { enumerable: true, get() { executions++; throw Error('ARRAY_GETTER'); } });
  const extraPool = pool(1);
  extraPool.private_payload = 'PRIVATE_PAYLOAD';
  const proxy = value => new Proxy(value, { get() { executions++; throw Error('PROXY'); }, getPrototypeOf() { executions++; throw Error('PROXY'); }, ownKeys() { executions++; throw Error('PROXY'); }, getOwnPropertyDescriptor() { executions++; throw Error('PROXY'); } });
  class Input { constructor() { Object.assign(this, options()); } }
  const inherited = Object.create(options());
  const coercion = { valueOf() { executions++; throw Error('COERCION'); }, toJSON() { executions++; throw Error('TO_JSON'); } };
  for (const input of [getter, proxy(options()), new Input(), inherited, options('10:00:00', { fast_quote_symbols: getterPool }), options('10:00:00', { fast_quote_symbols: proxy(pool(1)) }), options('10:00:00', { fast_quote_symbols: new Array(1) }), options('10:00:00', { fast_quote_symbols: extraPool }), options('10:00:00', { now: coercion }), options('10:00:00', { last_due_keys: proxy({ quote: null, tail: null }) }), { now: time('10:00:00'), fast_quote_symbols: [], research_pool_symbols: proxy(pool(1)) }]) assert.equal(planLocalMarketTasks(input).valid, false);
  assert.equal(executions, 0);
});

test('maximum research denominator stays small, serializable and never activates an execution path', () => {
  const result = planLocalMarketTasks(options('15:35:00', { fast_quote_symbols: pool(20), research_pool_size: 10000 }));
  assert.equal(result.research_pool.size, 10000);
  assert.equal(tail(result).research_pool_size, 10000);
  assert.equal(quote(result).symbols.length, 20);
  assert.equal(result.tasks.length, 2);
  assert.ok(JSON.stringify(result).length < 4000);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const source = readFileSync(new URL('../portable/local-update-planner.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]), ['../modules/condition-screen/src/json-input.js', '../src/market-session.mjs']);
  assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|fetch|eval|Function|registerJob|Date\.now)\s*\(/);
  assert.doesNotMatch(source, /node:(?:http|https|sqlite)|ohlcv-updater|source-loader|window\.|document\.|localStorage/);
  const duplicateResearch = planLocalMarketTasks({ now: time('15:35:00'), fast_quote_symbols: [], research_pool_symbols: Array.from({ length: 10000 }, () => 'sh600000') });
  assert.equal(duplicateResearch.research_pool.size, 1);
});
