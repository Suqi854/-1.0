// Synthetic payloads and injected fetch only; also run with offline-test-guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../portable/sqlite.mjs';
import {createLocalPublicLoader, isTrustedLocalPublicLoaderForEnv, LOCAL_PUBLIC_LOADER_POLICY} from '../portable/local-public-loader.mjs';
import {parseHistory, parseTencent, parseSina} from '../src/worker.mjs';

const NOW = Date.parse('2026-09-30T14:00:00+08:00'), SYMBOL = 'sh600522';
const SERIES = {interval: '1d', adjustment: 'none', limit: 200, include_incomplete: true, source: 'tencent'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const code = expected => error => error.code === expected && error.message === expected;
function history(symbol = SYMBOL, key = 'day') {
  return JSON.stringify({synthetic: true, code: 0, data: {[symbol]: {[key]: [
    ['2026-09-28', '19', '20', '21', '18', '100'], ['2026-09-29', '20', '21', '22', '19', '123']
  ]}}});
}
function quoteRaw(provider, symbols = [SYMBOL], stamp = provider === 'tencent' ? '135959' : '13:59:58', name = 'Synthetic') {
  return symbols.map(symbol => {
    const f = Array(provider === 'tencent' ? 51 : 33).fill('0');
    if (provider === 'tencent') {
      Object.assign(f, {1: name, 2: symbol.slice(2), 3: '20', 4: '20', 5: '19.8', 6: '100',
        30: '20260930' + stamp, 33: '20.5', 34: '19.5', 35: '20/100/2000', 37: '2', 47: '22', 48: '18'});
      for (let i = 0; i < 5; i++) { f[9+2*i] = String(20-i/100); f[10+2*i] = String(10+i); f[19+2*i] = String(20.01+i/100); f[20+2*i] = String(20+i); }
      return 'v_' + symbol + '="' + f.join('~') + '";';
    }
    Object.assign(f, {0: name, 1: '19.8', 2: '20', 3: '20', 4: '20.5', 5: '19.5', 8: '9997', 9: '199940', 30: '2026-09-30', 31: stamp});
    for (let i = 0; i < 5; i++) { f[10+2*i] = String(1003+i); f[11+2*i] = String(20-i/100); f[20+2*i] = String(2001+i); f[21+2*i] = String(20.01+i/100); }
    return 'var hq_str_' + symbol + '="' + f.join(',') + '";';
  }).join('\n');
}
function fixture(options = {}) {
  const env = openLocalDatabase(':memory:'), calls = []; let clock = NOW;
  const fetchImpl = options.fetchImpl || (async (url, opts) => {
    calls.push({url, opts});
    if (url.includes('fqkline')) {
      const [symbol, period, , , , adjustment] = url.split('param=')[1].split(',');
      return new Response(history(symbol, adjustment + period));
    }
    const provider = url.includes('qt.gtimg') ? 'tencent' : 'sina';
    return new Response(quoteRaw(provider, url.slice(url.indexOf('=') + 1).split(',')));
  });
  const loader = createLocalPublicLoader(env, {...options, fetchImpl, now: options.now || (() => clock)});
  return {env, loader, calls, advance: ms => clock += ms, close: () => env.close()};
}
function poison(counter) {
  return new Proxy({}, {get() {counter.count++; throw Error('GET');}, ownKeys() {counter.count++; throw Error('KEYS');},
    getPrototypeOf() {counter.count++; throw Error('PROTO');}, getOwnPropertyDescriptor() {counter.count++; throw Error('DESC');}});
}

test('forged D1/lookalike environments fail first with zero env/option traps or source calls', () => {
  const counter = {count: 0}, bad = poison(counter), env = openLocalDatabase(':memory:');
  try {
    for (const value of [undefined, null, {}, {DB: env.DB}, bad]) assert.throws(() => createLocalPublicLoader(value, bad), code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
    assert.equal(counter.count, 0);
  } finally { env.close(); }
});

test('revoked env and revoked options are rejected without executing proxy traps', () => {
  const p = Proxy.revocable({}, {}); p.revoke();
  assert.throws(() => createLocalPublicLoader(p.proxy, p.proxy), code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
  const env = openLocalDatabase(':memory:');
  try { assert.throws(() => createLocalPublicLoader(env, p.proxy), code('INVALID_LOCAL_LOADER_OPTIONS')); } finally { env.close(); }
});

test('factory/status/resume/reservation do no network or DB writes and return frozen metadata', async () => {
  const f = fixture();
  try {
    assert.equal(Object.isFrozen(f.loader), true);
    const before = await f.env.DB.prepare('SELECT total_changes() AS count').first();
    assert.equal(f.loader.status().http_attempts, 0); f.loader.resumeSource('tencent'); f.loader.setPostcloseActive(true);
    assert.equal(f.calls.length, 0);
    assert.equal(Object.isFrozen(f.loader.status().sources.tencent), true);
    assert.deepEqual(await f.env.DB.prepare('SELECT total_changes() AS count').first(), before);
    assert.equal(LOCAL_PUBLIC_LOADER_POLICY.background_registered, false);
    assert.equal(f.loader.status().source_license, 'unknown');
  } finally { f.close(); }
});

test('factory rejects endpoint/headers/credentials/private and unknown overrides without getter access', () => {
  const env = openLocalDatabase(':memory:'), counter = {count: 0};
  try {
    for (const key of ['url', 'source', 'headers', 'api_key', 'credentials', 'owner', 'retry', 'key'])
      assert.throws(() => createLocalPublicLoader(env, {[key]: 'private'}), code('INVALID_LOCAL_LOADER_OPTIONS'));
    const getter = {}; Object.defineProperty(getter, 'fetchImpl', {enumerable: true, get() {counter.count++;}});
    for (const opts of [getter, poison(counter), {timeout_ms: 6501}, {min_start_interval_ms: 999}, {max_active_requests: 4}, {max_active_series: 3}, {max_http_attempts: Infinity}])
      assert.throws(() => createLocalPublicLoader(env, opts));
    assert.equal(counter.count, 0);
  } finally { env.close(); }
});

test('series options reject getters/proxies, unknown fields and non-fixed windows before HTTP', async () => {
  const f = fixture(), counter = {count: 0}, getter = {...SERIES};
  Object.defineProperty(getter, 'interval', {enumerable: true, get() {counter.count++;}});
  try {
    for (const options of [getter, poison(counter), {...SERIES, url: 'https://evil.test'}, {...SERIES, headers: {}},
      {...SERIES, source: 'sina'}, {...SERIES, limit: 199}, {...SERIES, adjustment: 'hfq'}, {...SERIES, interval: '1m'},
      {...SERIES, interval: '1w', adjustment: 'qfq'}, {...SERIES, include_incomplete: 1}, {...SERIES, signal: {}}])
      await assert.rejects(() => f.loader.loadSeries(SYMBOL, options));
    assert.equal(counter.count, 0); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('only validated SH/SZ mainboard stock codes are accepted; no names or URL symbols', async () => {
  const f = fixture();
  try {
    for (const symbol of ['sh688981', 'sh689009', 'sz300001', 'bj430001', 'sz000000', 'sz001001', 'Synthetic', 'sh600522?x=1', {}])
      await assert.rejects(() => f.loader.loadSeries(symbol, SERIES), code('INVALID_LOCAL_MAINBOARD_SYMBOL'));
    assert.equal(f.calls.length, 0);
    assert.equal((await f.loader.loadSeries('600522.SH', SERIES)).symbol, SYMBOL);
  } finally { f.close(); }
});

test('all four exact Tencent keys reuse parseHistory with shares/null amount and unknown finality', async () => {
  const f = fixture();
  try {
    for (const series of LOCAL_PUBLIC_LOADER_POLICY.series) {
      const result = await f.loader.loadSeries(SYMBOL, {interval: series.interval, adjustment: series.adjustment, limit: series.limit, include_incomplete: true});
      const request = f.calls.at(-1), period = {'1d': 'day', '1w': 'week', '1mo': 'month'}[series.interval];
      assert.equal(request.url, 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + SYMBOL + ',' + period + ',,,' + series.limit + ',' + (series.adjustment === 'none' ? '' : 'qfq'));
      const expected = parseHistory(history(SYMBOL, (series.adjustment === 'none' ? '' : 'qfq') + period), SYMBOL,
        series.interval, series.limit, series.adjustment, true, NOW + f.calls.length * 1000 - 1000, NOW + f.calls.length * 1000 - 1000);
      assert.deepEqual(result.bars, expected.bars); assert.deepEqual(result.unit_notes, expected.unit_notes);
      assert.equal(result.bars.at(-1).volume_shares, 12300); assert.equal(result.bars.at(-1).amount_cny, null);
      assert.equal(result.series_key, series.key); assert.equal(result.source_finality, 'unknown');
      assert.equal(Object.isFrozen(result.bars[0]), true); f.advance(1000);
    }
    assert.equal(f.loader.status().http_attempts, 4);
  } finally { f.close(); }
});

test('every actual fetch has fixed GET, manual redirect, omitted credentials and no private headers', async () => {
  const f = fixture();
  try {
    await f.loader.loadSeries(SYMBOL, SERIES); f.advance(1000); await f.loader.loadQuotes([SYMBOL]);
    assert.equal(f.calls.length, 3);
    for (const {opts} of f.calls) {
      assert.equal(opts.method, 'GET'); assert.equal(opts.credentials, 'omit'); assert.equal(opts.redirect, 'manual'); assert.equal(opts.cache, 'no-store');
      assert.deepEqual(Object.keys(opts.headers).sort(), ['Referer', 'User-Agent']); assert.ok(opts.signal instanceof AbortSignal);
    }
  } finally { f.close(); }
});

test('gb18030 decoding preserves Chinese names and selected quote parser identity/units', async () => {
  const text = quoteRaw('tencent', [SYMBOL], '135959', 'NAME'), marker = text.indexOf('NAME');
  const body = Buffer.concat([Buffer.from(text.slice(0, marker)), Buffer.from([0xb2, 0xe2, 0xca, 0xd4]), Buffer.from(text.slice(marker + 4))]);
  const f = fixture({fetchImpl: async url => new Response(url.includes('gtimg') ? body : quoteRaw('sina'))});
  try {
    const result = await f.loader.loadQuotes([SYMBOL]), expected = parseTencent(new TextDecoder('gb18030').decode(body), SYMBOL, true);
    assert.equal(result.quotes[0].name, '测试');
    for (const key of ['price', 'volume_shares', 'amount_cny', 'book', 'unit_notes']) assert.deepEqual(result.quotes[0][key], expected[key]);
    assert.equal(result.quotes[0].volume_shares, 10000); assert.equal(result.quotes[0].book.bids[0].volume_shares, 1000);
  } finally { f.close(); }
});

test('transport/HTTP/parser failures count once, sanitize errors and never retry or fall back series', async () => {
  for (const fetchImpl of [async () => {throw Error('PRIVATE_URL_KEY_BODY');}, async () => new Response('PRIVATE_BODY', {status: 500}), async () => new Response('PRIVATE_BAD_JSON')]) {
    const f = fixture({fetchImpl});
    try {
      await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), error => /^LOCAL_SOURCE_(REQUEST|HTTP|PARSE)_FAILED$/.test(error.code) && !String(error).includes('PRIVATE'));
      assert.equal(f.loader.status().http_attempts, 1); assert.equal(f.loader.status().active_requests, 0);
    } finally { f.close(); }
  }
});

test('redirect responses and silently followed redirects are rejected after exactly one attempt', async () => {
  for (const response of [new Response('', {status: 302, headers: {location: 'https://evil.test'}}),
    {status: 200, ok: true, redirected: true, arrayBuffer() {throw Error('NO_BODY_READ');}}]) {
    const f = fixture({fetchImpl: async () => response});
    try { await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_REDIRECT_REJECTED')); assert.equal(f.loader.status().http_attempts, 1); } finally { f.close(); }
  }
});

test('Content-Length cap rejects before body read; streaming overflow cancels promptly at one MiB', async () => {
  let reads = 0, canceled = false;
  const f = fixture({fetchImpl: async () => ({status: 200, ok: true, headers: new Headers({'content-length': '1048577'}), arrayBuffer() {reads++;}})});
  try { await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RESPONSE_TOO_LARGE')); assert.equal(reads, 0); } finally { f.close(); }
  const g = fixture({fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) {reads++; controller.enqueue(new Uint8Array(600000));}, cancel() {canceled = true;}
  }))});
  try { await assert.rejects(() => g.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RESPONSE_TOO_LARGE')); assert.ok(canceled); assert.ok(reads <= 3); } finally { g.close(); }
});

test('non-streaming buffer overflow is rejected and small bodies retain raw-byte hashes', async () => {
  const f = fixture({fetchImpl: async () => ({status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(1048577)})});
  try { await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RESPONSE_TOO_LARGE')); } finally { f.close(); }
  const g = fixture();
  try {
    const data = await g.loader.loadSeries(SYMBOL, SERIES);
    assert.equal(data.receipt.raw_body_sha256, createHash('sha256').update(history()).digest('hex'));
    assert.equal(data.receipt.byte_length, Buffer.byteLength(history()));
  } finally { g.close(); }
});

test('429 Retry-After creates bounded cooldown with no hidden attempts and preserves finite retry_at', async () => {
  let calls = 0;
  const f = fixture({fetchImpl: async () => {calls++; return new Response('', {status: 429, headers: {'retry-after': '10'}});}});
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), error => error.code === 'LOCAL_SOURCE_RATE_DEFERRED' && Date.parse(error.retry_at) === NOW + 10000);
    f.advance(9999); await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED'));
    assert.equal(calls, 1); assert.equal(Date.parse(f.loader.status().sources.tencent.next_retry_at), NOW + 10000);
    f.advance(1); await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED')); assert.equal(calls, 2);
  } finally { f.close(); }
});

test('Retry-After dates, excessive/negative/malformed values are bounded to 1..300 seconds', async () => {
  for (const [header, seconds] of [[new Date(NOW + 20000).toUTCString(), 20], ['9999999', 300], ['-1', 1], ['private', 1], ['0', 1]]) {
    const f = fixture({fetchImpl: async () => new Response('', {status: 429, headers: {'retry-after': header}})});
    try { await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES)); assert.equal(Date.parse(f.loader.status().sources.tencent.next_retry_at), NOW + seconds * 1000); } finally { f.close(); }
  }
});

test('401 and 403 pause a source until explicit resume, without clearing start/cooldown or changing host', async () => {
  for (const status of [401, 403]) {
    let forbidden = true, calls = 0;
    const f = fixture({fetchImpl: async url => {calls++; assert.match(url, /^https:\/\/web\.ifzq\.gtimg\.cn\//); return forbidden ? new Response('', {status}) : new Response(history());}});
    try {
      await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_PAUSED'));
      f.advance(300000); await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_PAUSED')); assert.equal(calls, 1);
      assert.equal(f.loader.resumeSource('tencent').sources.tencent.paused, false); forbidden = false;
      await f.loader.loadSeries(SYMBOL, SERIES); assert.equal(calls, 2);
      assert.throws(() => f.loader.resumeSource('https://other.test'), code('INVALID_LOCAL_SOURCE'));
    } finally { f.close(); }
  }
});

test('same-source series and quote starts share 1Hz; healthy alternate still returns a whole book', async () => {
  const f = fixture();
  try {
    await f.loader.loadSeries(SYMBOL, SERIES);
    const result = await f.loader.loadQuotes([SYMBOL]);
    assert.equal(f.calls.length, 2); assert.equal(result.quotes[0].source, 'sina'); assert.equal(result.quotes[0].book.source, 'sina');
    assert.equal(result.source_outcomes[0].http_attempts, 0); assert.equal(result.source_outcomes[0].error_code, 'LOCAL_SOURCE_RATE_DEFERRED');
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED')); assert.equal(f.calls.length, 2);
    f.advance(1000); await f.loader.loadSeries(SYMBOL, SERIES); assert.equal(f.calls.length, 3);
  } finally { f.close(); }
});

test('new loader instances cannot bypass trusted-host rate, cooldown or paused state', async () => {
  let calls = 0;
  const f = fixture({fetchImpl: async () => {calls++; return new Response('', {status: 403});}});
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES));
    const other = createLocalPublicLoader(f.env, {fetchImpl: async () => {calls++; return new Response(history());}, now: () => NOW + 100000});
    await assert.rejects(() => other.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_PAUSED')); assert.equal(calls, 1);
    assert.equal(other.status().http_attempts, 1);
  } finally { f.close(); }
  const g = fixture({fetchImpl: async () => new Response('', {status: 429, headers: {'retry-after': '10'}})});
  try {
    await assert.rejects(() => g.loader.loadSeries(SYMBOL, SERIES));
    const other = createLocalPublicLoader(g.env, {fetchImpl: async () => {throw Error('MUST_NOT_RUN');}, now: () => NOW + 1000});
    await assert.rejects(() => other.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED'));
  } finally { g.close(); }
});

test('finite instance attempt budget includes both quote providers and never resets with clock/resume', async () => {
  const f = fixture({max_http_attempts: 2});
  try {
    await f.loader.loadQuotes([SYMBOL]); assert.equal(f.calls.length, 2); assert.equal(f.loader.status().remaining_http_attempts, 0);
    f.advance(600000); f.loader.resumeSource('tencent');
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_ATTEMPT_BUDGET_EXHAUSTED'));
    assert.equal(f.calls.length, 2); assert.equal(f.loader.status().instance_http_attempts, 2);
  } finally { f.close(); }
});

test('one remaining attempt requests one quote provider and explicitly skips the other', async () => {
  const f = fixture({max_http_attempts: 1});
  try {
    const result = await f.loader.loadQuotes([SYMBOL]); assert.equal(result.quotes[0].source, 'tencent');
    assert.equal(f.calls.length, 1); assert.equal(result.source_outcomes[1].error_code, 'LOCAL_SOURCE_ATTEMPT_BUDGET_EXHAUSTED');
  } finally { f.close(); }
});

test('series uses at most two slots and leaves one for fast Sina quotes within global cap three', async () => {
  const pending = []; let active = 0, peak = 0;
  const f = fixture({fetchImpl: async url => {active++; peak = Math.max(peak, active);
    if (url.includes('fqkline')) return new Promise(resolve => pending.push(() => {active--; resolve(new Response(history()));}));
    active--; return new Response(quoteRaw('sina'));
  }});
  try {
    f.loader.setPostcloseActive(true);
    const a = f.loader.loadSeries(SYMBOL, SERIES); f.advance(1000); const b = f.loader.loadSeries(SYMBOL, SERIES); f.advance(1000);
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED'));
    const q = await f.loader.loadQuotes([SYMBOL]); assert.equal(q.quotes[0].source, 'sina'); assert.equal(peak, 3);
    assert.equal(f.loader.status().active_series, 2); assert.equal(f.loader.status().http_attempts, 3);
    for (const finish of pending) finish(); await Promise.all([a, b]); assert.equal(f.loader.status().active_requests, 0);
  } finally { f.close(); }
});

test('postclose resource marker preserves Tencent starts for bars while one-second Sina quotes continue', async () => {
  const f = fixture();
  try {
    f.loader.setPostcloseActive(true);
    for (let i = 0; i < 3; i++) {
      const q = await f.loader.loadQuotes([SYMBOL]); assert.equal(q.quotes[0].source, 'sina');
      assert.equal(q.source_outcomes[0].error_code, 'LOCAL_SOURCE_RESERVED_FOR_POSTCLOSE'); assert.equal(q.source_outcomes[0].http_attempts, 0);
      await f.loader.loadSeries(SYMBOL, SERIES); f.advance(1000);
    }
    assert.equal(f.loader.status().sources.tencent.http_attempts, 3); assert.equal(f.loader.status().sources.sina.http_attempts, 3);
    const before = f.calls.length; f.loader.setPostcloseActive(false); assert.equal(f.calls.length, before);
    const resumed = await f.loader.loadQuotes([SYMBOL]); assert.equal(resumed.source_outcomes[0].http_attempts, 1);
  } finally { f.close(); }
});

test('hung fetch has a bounded deadline, propagated abort and timeout backoff; late completion cannot publish', async () => {
  let finish, sourceSignal;
  const f = fixture({fetchImpl: async (_url, opts) => {sourceSignal = opts.signal; return new Promise(resolve => finish = resolve);}});
  try {
    const began = Date.now(); await assert.rejects(() => f.loader.loadSeries(SYMBOL, {...SERIES, timeout_ms: 20}), code('LOCAL_SOURCE_TIMEOUT'));
    assert.ok(Date.now() - began < 500); assert.equal(sourceSignal.aborted, true);
    assert.equal(f.loader.status().http_attempts, 1); assert.equal(f.loader.status().active_requests, 1);
    assert.ok(Date.parse(f.loader.status().sources.tencent.next_retry_at) >= NOW + 1000);
    finish(new Response(history())); await sleep(0);
    assert.equal(f.loader.status().active_requests, 0); assert.equal(f.loader.status().http_attempts, 1);
  } finally { f.close(); }
});

test('hung response-body read is bounded by the same timeout and late bytes release its retained slot', async () => {
  let finish, sourceSignal;
  const f = fixture({fetchImpl: async (_url, opts) => {sourceSignal = opts.signal; return {status: 200, ok: true, arrayBuffer: () => new Promise(resolve => finish = resolve)};}});
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, {...SERIES, timeout_ms: 20}), code('LOCAL_SOURCE_TIMEOUT'));
    assert.equal(sourceSignal.aborted, true); assert.equal(f.loader.status().active_requests, 1);
    finish(Buffer.from(history())); await sleep(0); assert.equal(f.loader.status().active_requests, 0);
  } finally { f.close(); }
});

test('timeout rejects and aborts even when a pending request makes the injected clock NaN or throwing', {timeout: 1000}, async () => {
  for (const brokenClock of [() => NaN, () => {throw Error('PRIVATE_CLOCK_ERROR');}]) {
    let currentClock = () => NOW, sourceSignal, calls = 0;
    const f = fixture({now: () => currentClock(), fetchImpl: async (_url, opts) => {
      calls++; sourceSignal = opts.signal;
      return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('ABORTED')), {once: true}));
    }});
    try {
      const work = f.loader.loadSeries(SYMBOL, {...SERIES, timeout_ms: 20});
      currentClock = brokenClock;
      await assert.rejects(() => work, code('LOCAL_SOURCE_TIMEOUT'));
      assert.equal(sourceSignal.aborted, true); assert.equal(calls, 1);
      currentClock = () => NOW + 20; await sleep(0);
      const status = f.loader.status(), retry = Date.parse(status.sources.tencent.next_retry_at);
      assert.equal(status.active_requests, 0); assert.equal(status.http_attempts, 1);
      assert.ok(retry >= NOW + 1020 && retry <= NOW + 300020);
      await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED'));
      assert.equal(calls, 1);
    } finally { f.close(); }
  }
});

test('receipt clock regression rejects the fetched payload after one attempt without publishing a receipt', async () => {
  let time = NOW, calls = 0;
  const f = fixture({now: () => time, fetchImpl: async () => {calls++; time = NOW - 1; return new Response(history());}});
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_CLOCK_REGRESSION'));
    assert.equal(calls, 1); time = NOW;
    assert.equal(f.loader.status().http_attempts, 1); assert.equal(f.loader.status().active_requests, 0);
  } finally { f.close(); }
});

test('clock callbacks closing a genuine env at admission or request-start prevent all HTTP counting and dispatch', async () => {
  for (const closeAt of [1, 2]) {
    const env = openLocalDatabase(':memory:'); let clockCalls = 0, fetchCalls = 0;
    const loader = createLocalPublicLoader(env, {now: () => {
      clockCalls++; if (clockCalls === closeAt) env.close(); return NOW;
    }, fetchImpl: async () => {fetchCalls++; throw Error('MUST_NOT_DISPATCH');}});
    await assert.rejects(() => loader.loadSeries(SYMBOL, SERIES), code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
    assert.equal(fetchCalls, 0); assert.equal(clockCalls, closeAt);
    assert.equal(isTrustedLocalPublicLoaderForEnv(env, loader), false);
  }
});

test('caller abort during request-start clock work costs zero attempts and clears its request timer', async () => {
  const cancel = new AbortController(), pendingTimers = new Set(); let clockCalls = 0, fetchCalls = 0, timerCalls = 0;
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const f = fixture({now: () => {
    clockCalls++; if (clockCalls === 2) cancel.abort('PRIVATE_REASON'); return NOW;
  }, fetchImpl: async () => {fetchCalls++; throw Error('MUST_NOT_DISPATCH');}});
  globalThis.setTimeout = (callback, delay, ...args) => {
    timerCalls++; let timer;
    timer = originalSetTimeout(() => {pendingTimers.delete(timer); callback(...args);}, delay);
    pendingTimers.add(timer); return timer;
  };
  globalThis.clearTimeout = timer => {pendingTimers.delete(timer); return originalClearTimeout(timer);};
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, {...SERIES, signal: cancel.signal}), code('LOCAL_SOURCE_ABORTED'));
    assert.equal(fetchCalls, 0); assert.equal(clockCalls, 2); assert.equal(cancel.signal.aborted, true);
    assert.equal(timerCalls, 1); assert.equal(pendingTimers.size, 0);
    assert.equal(f.loader.status().http_attempts, 0); assert.equal(f.loader.status().active_requests, 0);
    assert.equal(f.loader.status().sources.tencent.http_attempts, 0);
  } finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; f.close(); }
});

test('caller cancellation aborts series and both quote providers; pre-aborted signal costs zero attempts', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture();
  try {
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, {...SERIES, signal: controller.signal}), code('LOCAL_SOURCE_ABORTED'));
    await assert.rejects(() => f.loader.loadQuotes([SYMBOL], {signal: controller.signal}), code('LOCAL_SOURCE_ABORTED')); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
  for (const quotes of [false, true]) {
    const signals = [], cancel = new AbortController();
    const g = fixture({fetchImpl: async (_url, opts) => {signals.push(opts.signal); return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('PRIVATE_ABORT_REASON')), {once: true}));}});
    try {
      const work = quotes ? g.loader.loadQuotes([SYMBOL], {signal: cancel.signal}) : g.loader.loadSeries(SYMBOL, {...SERIES, signal: cancel.signal});
      cancel.abort('PRIVATE_REASON'); await assert.rejects(() => work, code('LOCAL_SOURCE_ABORTED'));
      assert.equal(signals.length, quotes ? 2 : 1); assert.ok(signals.every(item => item.aborted));
      await sleep(0); assert.equal(g.loader.status().active_requests, 0);
    } finally { g.close(); }
  }
});

test('quotes batch at most twenty validated symbols into two requests, never per-symbol fanout', async () => {
  const symbols = Array.from({length: 20}, (_, i) => 'sh' + (600000 + i)), f = fixture();
  try {
    const q = await f.loader.loadQuotes(symbols); assert.equal(q.quotes.length, 20); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].url, 'https://qt.gtimg.cn/q=' + symbols.join(',')); assert.equal(f.calls[1].url, 'https://hq.sinajs.cn/list=' + symbols.join(','));
    for (const bad of [[], [...symbols, 'sh600999'], [SYMBOL, SYMBOL], ['sh688981'], new Array(1), poison({count: 0})]) await assert.rejects(() => f.loader.loadQuotes(bad));
    assert.equal(f.calls.length, 2);
  } finally { f.close(); }
});

test('quote options reject endpoint/source/private overrides and accessor/proxy arguments before admission', async () => {
  const f = fixture(), counter = {count: 0}, getter = {};
  Object.defineProperty(getter, 'include_book', {enumerable: true, get() {counter.count++;}});
  try {
    for (const options of [getter, poison(counter), {include_book: 1}, {source: 'sina'}, {url: 'https://evil.test'},
      {headers: {}}, {api_key: 'private'}, {timeout_ms: 6501}, {signal: poison(counter)}])
      await assert.rejects(() => f.loader.loadQuotes([SYMBOL], options));
    const array = [SYMBOL]; Object.defineProperty(array, '0', {get() {counter.count++;}});
    await assert.rejects(() => f.loader.loadQuotes(array));
    assert.equal(counter.count, 0); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('fully deferred quote round exposes each finite retry_at and costs zero additional HTTP attempts', async () => {
  const f = fixture();
  try {
    await f.loader.loadQuotes([SYMBOL]); const deferred = await f.loader.loadQuotes([SYMBOL]);
    assert.equal(f.calls.length, 2); assert.equal(deferred.quotes[0].error.code, 'QUOTE_UNAVAILABLE');
    for (const outcome of deferred.source_outcomes) {
      assert.equal(outcome.error_code, 'LOCAL_SOURCE_RATE_DEFERRED'); assert.equal(outcome.http_attempts, 0);
      assert.equal(Date.parse(outcome.retry_at), NOW + 1000);
    }
    assert.equal(deferred.receipts.length, 0);
  } finally { f.close(); }
});

test('shared quote deadline aborts hung providers, bounds elapsed time and records actual attempts', async () => {
  const signals = [];
  const f = fixture({fetchImpl: async (_url, opts) => {signals.push(opts.signal); return new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Error('UPSTREAM_ABORT')), {once: true});
  });}});
  try {
    const started = Date.now(), result = await f.loader.loadQuotes([SYMBOL], {timeout_ms: 20});
    assert.ok(Date.now() - started < 500); assert.equal(result.quotes[0].error.code, 'QUOTE_UNAVAILABLE');
    assert.equal(signals.length, 2); assert.ok(signals.every(item => item.aborted));
    await sleep(0); assert.equal(f.loader.status().http_attempts, 2); assert.equal(f.loader.status().active_requests, 0);
    assert.ok(result.source_outcomes.every(item => item.http_attempts === 1 && item.error_code === 'LOCAL_SOURCE_TIMEOUT'));
  } finally { f.close(); }
});

test('newer Sina wins as one complete source book and carries bound source/request/receipt/hash provenance', async () => {
  const rawTencent = quoteRaw('tencent', [SYMBOL], '135957'), rawSina = quoteRaw('sina', [SYMBOL], '13:59:59');
  const f = fixture({fetchImpl: async url => new Response(url.includes('gtimg') ? rawTencent : rawSina)});
  try {
    const q = (await f.loader.loadQuotes([SYMBOL])).quotes[0], expected = parseSina(rawSina, SYMBOL, true);
    assert.equal(q.source, 'sina'); assert.deepEqual(q.book, expected.book); assert.deepEqual(q.unit_notes, expected.unit_notes);
    assert.equal(q.receipt.selected_source, q.source); assert.equal(q.receipt.symbol, q.symbol); assert.equal(q.receipt.source_timestamp, q.source_timestamp);
    assert.equal(q.receipt.raw_body_sha256, createHash('sha256').update(rawSina).digest('hex'));
    for (const field of ['request_started_at', 'fetched_at', 'selected_at']) assert.equal(q.receipt[field], q[field]);
    assert.equal(q.receipt.exchange_certified, false); assert.equal(q.source_finality, 'unknown'); assert.equal(Object.isFrozen(q.receipt), true);
    assert.equal(q.volume_shares, 9997); assert.equal(q.book.bids[0].volume_shares, 1003);
    assert.deepEqual(q.observation_receipt, {source: q.source, request_started_at: q.request_started_at,
      fetched_at: q.fetched_at, raw_body_sha256: q.receipt.raw_body_sha256,
      quote_binding_sha256: createHash('sha256').update(JSON.stringify([q.symbol, q.name, q.source, q.source_timestamp]), 'utf8').digest('hex')});
  } finally { f.close(); }
});

test('paused or 429 provider never retries while an eligible fixed alternate continues with candid metadata', async () => {
  for (const status of [403, 429]) {
    let tencent = 0, sina = 0;
    const f = fixture({fetchImpl: async url => {if (url.includes('gtimg')) {tencent++; return new Response('', {status, headers: {'retry-after': '10'}});} sina++; return new Response(quoteRaw('sina'));}});
    try {
      const first = await f.loader.loadQuotes([SYMBOL]); assert.equal(first.quotes[0].source, 'sina'); assert.equal(tencent, 1); assert.equal(sina, 1);
      f.advance(1000); const next = await f.loader.loadQuotes([SYMBOL]); assert.equal(next.quotes[0].source, 'sina'); assert.equal(tencent, 1); assert.equal(sina, 2);
      assert.equal(next.source_outcomes[0].http_attempts, 0); assert.match(next.source_outcomes[0].error_code, /LOCAL_SOURCE_(PAUSED|RATE_DEFERRED)/);
      assert.equal(f.loader.status().http_attempts, 3);
    } finally { f.close(); }
  }
});

test('all-source failures and stale quotes remain explicit, with no payload/URL/private error in status', async () => {
  const f = fixture({fetchImpl: async () => {throw Error('PRIVATE_PASSWORD https://evil.test/?token=SECRET');}});
  try {
    const q = await f.loader.loadQuotes([SYMBOL]); assert.equal(q.quotes[0].error.code, 'QUOTE_UNAVAILABLE');
    assert.equal(f.loader.status().http_attempts, 2); assert.doesNotMatch(JSON.stringify(q), /PRIVATE_PASSWORD|evil\.test|SECRET/);
    assert.doesNotMatch(JSON.stringify(f.loader.status()), /https:|body|payload|owner|DB|SECRET/);
  } finally { f.close(); }
  const g = fixture({now: () => NOW + 86400000});
  try { const q = (await g.loader.loadQuotes([SYMBOL])).quotes[0]; assert.equal(q.freshness.status, 'stale'); assert.equal(q.source_finality, 'unknown'); } finally { g.close(); }
});

test('closed local env rejects every method before poisoned arguments/options and suppresses in-flight output', async () => {
  const f = fixture(), counter = {count: 0}, bad = poison(counter); f.close();
  for (const call of [() => f.loader.loadSeries(bad, bad), () => f.loader.loadQuotes(bad, bad), () => f.loader.loadNameQuotes(bad, bad)]) await assert.rejects(call, code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
  for (const call of [() => f.loader.status(), () => f.loader.resumeSource(bad), () => f.loader.setPostcloseActive(bad)]) assert.throws(call, code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
  assert.equal(counter.count, 0); assert.equal(f.calls.length, 0);
  let finish;
  const g = fixture({fetchImpl: async () => new Promise(resolve => finish = resolve)});
  const work = g.loader.loadSeries(SYMBOL, SERIES); g.close(); finish(new Response(history()));
  await assert.rejects(() => work, code('TRUSTED_LOCAL_SQLITE_REQUIRED'));
});

test('loader brand query binds only the real frozen loader to its same live trusted env without argument traps', () => {
  const f = fixture(), other = openLocalDatabase(':memory:'), counter = {count: 0}, bad = poison(counter);
  const revoked = Proxy.revocable(f.loader, {}); revoked.revoke();
  try {
    assert.equal(isTrustedLocalPublicLoaderForEnv(f.env, f.loader), true);
    for (const loader of [{...f.loader}, Object.freeze({...f.loader}), new Proxy(f.loader, {}), revoked.proxy, bad, null, undefined])
      assert.equal(isTrustedLocalPublicLoaderForEnv(f.env, loader), false);
    for (const env of [other, {DB: f.env.DB}, bad, null, undefined]) assert.equal(isTrustedLocalPublicLoaderForEnv(env, f.loader), false);
    assert.equal(counter.count, 0); assert.equal(f.calls.length, 0);
    f.close(); assert.equal(isTrustedLocalPublicLoaderForEnv(f.env, f.loader), false);
  } finally { other.close(); }
});

test('name quotes use exactly one fixed Tencent batch with identical five-field observation receipt binding', async () => {
  const f = fixture(), symbols = Array.from({length: 20}, (_, i) => 'sh' + (600000 + i));
  try {
    f.loader.setPostcloseActive(true);
    const result = await f.loader.loadNameQuotes(symbols);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, 'https://qt.gtimg.cn/q=' + symbols.join(','));
    assert.deepEqual(result.routing.providers, ['tencent']); assert.equal(result.routing.mode, 'single_source');
    assert.equal(result.quotes.length, 20); assert.equal(result.receipts.length, 1);
    for (const q of result.quotes) {
      assert.equal(q.source, 'tencent'); assert.equal(q.book, undefined); assert.equal(q.candidates.length, 1);
      assert.deepEqual(Object.keys(q.observation_receipt).sort(), ['source', 'request_started_at', 'fetched_at', 'raw_body_sha256', 'quote_binding_sha256'].sort());
      assert.equal(q.observation_receipt.quote_binding_sha256, createHash('sha256').update(JSON.stringify([q.symbol, q.name, q.source, q.source_timestamp]), 'utf8').digest('hex'));
      assert.equal(q.observation_receipt.raw_body_sha256, result.receipts[0].raw_body_sha256);
      assert.equal(Object.isFrozen(q.observation_receipt), true);
    }
    assert.equal(f.loader.status().sources.sina.http_attempts, 0);
  } finally { f.close(); }
});

test('name quote input rejects oversized/invalid pools and source/options getters before HTTP', async () => {
  const f = fixture(), counter = {count: 0}, getter = {};
  Object.defineProperty(getter, 'include_book', {enumerable: true, get() {counter.count++;}});
  try {
    for (const [symbols, opts] of [[Array.from({length: 21}, (_, i) => 'sh' + (600000 + i)), {}],
      [['sh688981'], {}], [[SYMBOL], {source: 'sina'}], [[SYMBOL], {url: 'https://evil.test'}], [[SYMBOL], getter],
      [poison(counter), {}], [[SYMBOL], {signal: poison(counter)}]]) await assert.rejects(() => f.loader.loadNameQuotes(symbols, opts));
    assert.equal(counter.count, 0); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('Tencent 403 during name observation stays paused across factories while fast Sina quotes continue', async () => {
  let tencent = 0, sina = 0;
  const f = fixture({fetchImpl: async url => {
    if (url.includes('gtimg')) {tencent++; return new Response('', {status: 403});}
    sina++; return new Response(quoteRaw('sina'));
  }});
  try {
    f.loader.setPostcloseActive(true);
    await assert.rejects(() => f.loader.loadNameQuotes([SYMBOL]), code('LOCAL_SOURCE_PAUSED'));
    f.advance(1000); await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_PAUSED'));
    const other = createLocalPublicLoader(f.env, {fetchImpl: async () => {throw Error('MUST_NOT_REQUEST');}, now: () => NOW + 1000});
    await assert.rejects(() => other.loadNameQuotes([SYMBOL]), code('LOCAL_SOURCE_PAUSED'));
    const q = await f.loader.loadQuotes([SYMBOL]); assert.equal(q.quotes[0].source, 'sina');
    assert.equal(tencent, 1); assert.equal(sina, 1); assert.equal(f.loader.status().sources.tencent.paused, true);
  } finally { f.close(); }
});

test('name and series work share Tencent 1Hz and a finite budget while preserving fast Sina progress', async () => {
  const f = fixture({max_http_attempts: 3});
  try {
    f.loader.setPostcloseActive(true);
    await f.loader.loadNameQuotes([SYMBOL]);
    await assert.rejects(() => f.loader.loadSeries(SYMBOL, SERIES), code('LOCAL_SOURCE_RATE_DEFERRED'));
    assert.equal((await f.loader.loadQuotes([SYMBOL])).quotes[0].source, 'sina');
    f.advance(1000); await f.loader.loadSeries(SYMBOL, SERIES);
    await assert.rejects(() => f.loader.loadNameQuotes([SYMBOL]), code('LOCAL_SOURCE_ATTEMPT_BUDGET_EXHAUSTED'));
    assert.equal(f.calls.length, 3); assert.equal(f.loader.status().http_attempts, 3);
    assert.equal(f.loader.status().sources.tencent.http_attempts, 2); assert.equal(f.loader.status().sources.sina.http_attempts, 1);
  } finally { f.close(); }
});

test('two mixed name/series requests reserve at most two postclose slots and leave the third for fast quotes', async () => {
  const pending = [];
  const f = fixture({fetchImpl: async url => {
    if (url.includes('sinajs')) return new Response(quoteRaw('sina'));
    return new Promise(resolve => pending.push(() => resolve(new Response(url.includes('fqkline') ? history() : quoteRaw('tencent')))));
  }});
  try {
    f.loader.setPostcloseActive(true);
    const names = f.loader.loadNameQuotes([SYMBOL]); f.advance(1000); const series = f.loader.loadSeries(SYMBOL, SERIES); f.advance(1000);
    await assert.rejects(() => f.loader.loadNameQuotes([SYMBOL]), code('LOCAL_SOURCE_RATE_DEFERRED'));
    assert.equal(f.loader.status().active_postclose_requests, 2);
    const q = await f.loader.loadQuotes([SYMBOL]); assert.equal(q.quotes[0].source, 'sina');
    for (const finish of pending) finish(); await Promise.all([names, series]);
    assert.equal(f.loader.status().active_requests, 0); assert.equal(f.loader.status().http_attempts, 3);
  } finally { f.close(); }
});

test('adapter imports verified parsers/routing and contains no high-level hidden-retry loader or DB writer', () => {
  const text = readFileSync(new URL('../portable/local-public-loader.mjs', import.meta.url), 'utf8');
  assert.match(text, /parseHistory, parseTencent, parseSina/); assert.match(text, /import \{routeQuotes, selectQuote, validateQuote\}/);
  assert.doesNotMatch(text, /\b(?:bars|fetchText|contextFetchText)\s*\(|env\??\.DB|setInterval|INSERT INTO|UPDATE\s+\w+/);
});
