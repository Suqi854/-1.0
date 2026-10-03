// Explicit, credential-free local source calls. No store, service, scheduled
// collector, retry loop, or persistence is installed by this adapter.
import {types as nodeTypes} from 'node:util';
import {createHash} from 'node:crypto';
import {isTrustedLocalDatabase} from './sqlite.mjs';
import {symbol as normalizeSymbol, parseHistory, parseTencent, parseSina} from '../src/worker.mjs';
import {routeQuotes, selectQuote, validateQuote} from '../src/quote-routing.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const LOCAL_PUBLIC_LOADER_POLICY = freeze({
  version: 'local-public-loader-v1', runtime: 'trusted_local_sqlite',
  series: [
    {key: 'raw1d200', interval: '1d', adjustment: 'none', limit: 200},
    {key: 'raw1w104', interval: '1w', adjustment: 'none', limit: 104},
    {key: 'raw1mo60', interval: '1mo', adjustment: 'none', limit: 60},
    {key: 'qfq1d200', interval: '1d', adjustment: 'qfq', limit: 200}
  ],
  max_quote_symbols: 20, max_response_bytes: 1048576, timeout_ms: 6500,
  min_start_interval_ms: 1000, max_active_requests: 3, max_active_series: 2,
  max_http_attempts: null,
  source_finality: 'unknown', exchange_certified: false,
  source_license: 'unknown', retention_scope: 'local_only', background_registered: false
});
const budgets = new WeakMap();
const loaderEnvironments = new WeakMap();
const SOURCES = ['tencent', 'sina'];
const HEADERS = Object.freeze({'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'});
const iso = value => new Date(value).toISOString();
const errors = new WeakSet();
function localError(code, metadata = {}) {
  const error = Object.assign(new Error(code), {code, ...metadata});
  errors.add(error);
  return error;
}
function trusted(env) {
  // WeakSet identity check deliberately precedes all env/options/argument reads.
  if (!isTrustedLocalDatabase(env)) throw localError('TRUSTED_LOCAL_SQLITE_REQUIRED');
}
/** Read-only identity check; no caller properties or proxy traps are read. */
export function isTrustedLocalPublicLoaderForEnv(env, loader) {
  return isTrustedLocalDatabase(env) && loaderEnvironments.get(loader) === env;
}
function optionsObject(value, keys) {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw localError('INVALID_LOCAL_LOADER_OPTIONS');
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptor) || !descriptor.enumerable)
      throw localError('INVALID_LOCAL_LOADER_OPTIONS');
    result[key] = descriptor.value;
  }
  return result;
}
function integer(value, fallback, min, max) {
  const number = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw localError('INVALID_LOCAL_LOADER_LIMIT');
  return number;
}
function mainboard(value) {
  let symbol;
  try { symbol = normalizeSymbol(value); } catch { throw localError('INVALID_LOCAL_MAINBOARD_SYMBOL'); }
  if (!/^(?:sh(?:600|601|603|605)\d{3}|sz(?:000|001|002|003|004)\d{3})$/.test(symbol)
      || symbol === 'sz000000' || symbol.startsWith('sz') && Number(symbol.slice(2)) >= 1001 && Number(symbol.slice(2)) <= 1199)
    throw localError('INVALID_LOCAL_MAINBOARD_SYMBOL');
  return symbol;
}
function symbolBatch(value) {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) || !Array.isArray(value)
      || value.length < 1 || value.length > 20 || Reflect.ownKeys(value).length !== value.length + 1)
    throw localError('INVALID_LOCAL_QUOTE_SYMBOLS');
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) throw localError('INVALID_LOCAL_QUOTE_SYMBOLS');
    result.push(mainboard(d.value));
  }
  if (new Set(result).size !== result.length) throw localError('INVALID_LOCAL_QUOTE_SYMBOLS');
  return result;
}
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
function signal(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value)) throw localError('INVALID_LOCAL_ABORT_SIGNAL');
  try { signalAborted.call(value); } catch { throw localError('INVALID_LOCAL_ABORT_SIGNAL'); }
  return value;
}
const aborted = value => value !== undefined && signalAborted.call(value);
function source(value) {
  if (!SOURCES.includes(value)) throw localError('INVALID_LOCAL_SOURCE');
  return value;
}
function newBudget(limits) {
  return {http_attempts: 0, active: 0, active_series: 0, active_postclose: 0, postclose_active: false, limits,
    sources: Object.fromEntries(SOURCES.map(name => [name, {
      http_attempts: 0, active: 0, reserved: 0, paused: false,
      next_start: 0, cooldown_until: 0, failures: 0
    }]))};
}

/** Calls only public fixed feeds after a genuine, still-open NodeSQLite guard. */
export function createLocalPublicLoader(env, options) {
  trusted(env);
  const opts = optionsObject(options === undefined ? {} : options,
    ['fetchImpl', 'now', 'timeout_ms', 'min_start_interval_ms', 'max_active_requests', 'max_active_series', 'max_http_attempts']);
  const fetchImpl = opts.fetchImpl === undefined ? globalThis.fetch : opts.fetchImpl;
  const now = opts.now === undefined ? Date.now : opts.now;
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw localError('INVALID_LOCAL_LOADER_OPTIONS');
  const limits = {
    timeout_ms: integer(opts.timeout_ms, 6500, 1, 6500),
    min_start_interval_ms: integer(opts.min_start_interval_ms, 1000, 1000, 300000),
    max_active_requests: integer(opts.max_active_requests, 3, 1, 3),
    max_active_series: integer(opts.max_active_series, 2, 1, 2)
  };
  const maxAttempts = opts.max_http_attempts === undefined ? null : integer(opts.max_http_attempts, undefined, 1, Number.MAX_SAFE_INTEGER);
  const instance = {http_attempts: 0, reserved: 0};
  let budget = budgets.get(env);
  if (!budget) { budget = newBudget(limits); budgets.set(env, budget); }
  else {
    // Another adapter on the same local host cannot loosen existing limits.
    budget.limits.min_start_interval_ms = Math.max(budget.limits.min_start_interval_ms, limits.min_start_interval_ms);
    for (const key of ['timeout_ms', 'max_active_requests', 'max_active_series']) budget.limits[key] = Math.min(budget.limits[key], limits[key]);
  }
  function clock() {
    let value;
    try { value = now(); } catch { trusted(env); throw localError('INVALID_LOCAL_LOADER_CLOCK'); }
    // The injected clock is caller work and may close the genuine local env.
    // Recheck its live identity before any caller proceeds to source dispatch.
    trusted(env);
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - 300000)
      throw localError('INVALID_LOCAL_LOADER_CLOCK');
    return value;
  }
  function snapshot() {
    trusted(env);
    const time = clock();
    return freeze({runtime: 'trusted_local_sqlite', read_only: true,
      http_attempts: budget.http_attempts, active_requests: budget.active,
      active_series: budget.active_series, active_postclose_requests: budget.active_postclose,
      postclose_active: budget.postclose_active,
      instance_http_attempts: instance.http_attempts,
      remaining_http_attempts: maxAttempts === null ? null : Math.max(0, maxAttempts - instance.http_attempts - instance.reserved),
      limits: {...budget.limits, max_http_attempts: maxAttempts, attempt_budget_scope: 'this_instance_no_automatic_reset'}, clock: iso(time),
      sources: Object.fromEntries(SOURCES.map(name => {
        const state = budget.sources[name], retry = Math.max(state.next_start, state.cooldown_until);
        return [name, {http_attempts: state.http_attempts, active_requests: state.active, paused: state.paused,
          next_retry_at: state.paused || retry <= time ? null : iso(retry)}];
      })), source_license: 'unknown', retention_scope: 'local_only', background_registered: false});
  }
  function reserve(names, callerSignal, kind) {
    trusted(env);
    if (aborted(callerSignal)) throw localError('LOCAL_SOURCE_ABORTED');
    const time = clock();
    for (const name of names) if (budget.sources[name].paused) throw localError('LOCAL_SOURCE_PAUSED', {source: name});
    if (kind === 'quotes' && budget.postclose_active && names.includes('tencent'))
      throw localError('LOCAL_SOURCE_RESERVED_FOR_POSTCLOSE');
    if (maxAttempts !== null && instance.http_attempts + instance.reserved + names.length > maxAttempts)
      throw localError('LOCAL_SOURCE_ATTEMPT_BUDGET_EXHAUSTED');
    const retry = Math.max(time, ...names.map(name => Math.max(budget.sources[name].next_start, budget.sources[name].cooldown_until)));
    if (retry > time || budget.active + names.length > budget.limits.max_active_requests
        || kind !== 'quotes' && budget.active_postclose >= budget.limits.max_active_series
        || names.some(name => budget.sources[name].reserved))
      throw localError('LOCAL_SOURCE_RATE_DEFERRED', {retry_at: iso(retry > time ? retry : time + 1000)});
    const tokens = names.map(name => ({source: name, kind, started: false, released: false, request_started_at: time}));
    for (const token of tokens) {
      budget.active++; instance.reserved++;
      if (kind === 'series') budget.active_series++;
      if (kind !== 'quotes') budget.active_postclose++;
      budget.sources[token.source].active++; budget.sources[token.source].reserved++;
    }
    return tokens;
  }
  function release(token) {
    if (token.released) return;
    token.released = true;
    budget.active--; budget.sources[token.source].active--;
    if (token.kind === 'series') budget.active_series--;
    if (token.kind !== 'quotes') budget.active_postclose--;
    if (!token.started) { instance.reserved--; budget.sources[token.source].reserved--; }
  }
  function backoff(name, received, retryAfter) {
    const state = budget.sources[name];
    state.failures++;
    let seconds = Math.min(300, 2 ** Math.min(state.failures - 1, 9));
    if (typeof retryAfter === 'string' && retryAfter.length <= 80) {
      const trimmed = retryAfter.trim();
      const parsed = /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - received) / 1000;
      if (Number.isFinite(parsed)) seconds = Math.max(seconds, parsed);
    }
    seconds = Math.max(1, Math.min(300, Math.ceil(seconds)));
    state.cooldown_until = Math.max(state.cooldown_until, received + seconds * 1000);
  }
  async function bytes(response, controller) {
    const length = response.headers?.get?.('content-length');
    if (length !== null && length !== undefined && /^\d+$/.test(length) && Number(length) > 1048576) {
      controller.abort(); throw localError('LOCAL_SOURCE_RESPONSE_TOO_LARGE');
    }
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1048576) { controller.abort(); void reader.cancel().catch(() => {}); throw localError('LOCAL_SOURCE_RESPONSE_TOO_LARGE'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const result = new Uint8Array(size); let cursor = 0;
      for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.byteLength; }
      return result;
    }
    const result = new Uint8Array(await response.arrayBuffer());
    if (result.byteLength > 1048576) { controller.abort(); throw localError('LOCAL_SOURCE_RESPONSE_TOO_LARGE'); }
    return result;
  }
  async function request(token, url, {timeout, callerSignal, routeSignal}) {
    const controller = new AbortController(), listeners = []; let timer, terminal;
    const interrupt = new Promise((_, reject) => {
      const stop = code => {
        if (terminal) return;
        terminal = code;
        // Rejection and cancellation cannot depend on a fallible caller clock.
        reject(localError(code)); controller.abort();
        if (code === 'LOCAL_SOURCE_TIMEOUT') {
          let received = token.request_started_at + timeout;
          try { received = Math.max(received, clock()); } catch {}
          backoff(token.source, received);
        }
      };
      for (const item of [callerSignal, routeSignal]) if (item) {
        const listener = () => stop(item === callerSignal ? 'LOCAL_SOURCE_ABORTED' : 'LOCAL_SOURCE_TIMEOUT');
        if (aborted(item)) listener();
        else { addListener.call(item, 'abort', listener, {once: true}); listeners.push([item, listener]); }
      }
      timer = setTimeout(() => stop('LOCAL_SOURCE_TIMEOUT'), timeout);
    });
    const operation = (async () => {
      try {
        trusted(env);
        if (terminal || aborted(callerSignal) || aborted(routeSignal)) throw localError(terminal || 'LOCAL_SOURCE_ABORTED');
        const state = budget.sources[token.source], started = clock();
        // Caller clock work may also abort an accepted signal reentrantly.
        if (terminal || aborted(callerSignal) || aborted(routeSignal)) throw localError(terminal || 'LOCAL_SOURCE_ABORTED');
        token.started = true; token.request_started_at = started;
        instance.reserved--; instance.http_attempts++; state.reserved--; budget.http_attempts++; state.http_attempts++;
        state.next_start = Math.max(state.next_start, started + budget.limits.min_start_interval_ms);
        const response = await fetchImpl(url, {method: 'GET', credentials: 'omit', redirect: 'manual',
          cache: 'no-store', headers: {...HEADERS}, signal: controller.signal});
        // Late results never change pause/cooldown or produce an accepted receipt.
        if (terminal) throw localError(terminal);
        trusted(env);
        if (response.redirected || response.status >= 300 && response.status < 400) throw localError('LOCAL_SOURCE_REDIRECT_REJECTED');
        if (response.status === 401 || response.status === 403) { state.paused = true; throw localError('LOCAL_SOURCE_PAUSED', {source: token.source}); }
        if (response.status === 429) {
          backoff(token.source, clock(), response.headers?.get?.('retry-after'));
          throw localError('LOCAL_SOURCE_RATE_DEFERRED', {retry_at: iso(state.cooldown_until)});
        }
        if (!response.ok) throw localError('LOCAL_SOURCE_HTTP_FAILED');
        const body = await bytes(response, controller);
        if (terminal) throw localError(terminal);
        trusted(env);
        const received = clock();
        if (received < started) throw localError('LOCAL_SOURCE_CLOCK_REGRESSION');
        if (received - started >= timeout) { terminal = 'LOCAL_SOURCE_TIMEOUT'; backoff(token.source, received); controller.abort(); throw localError(terminal); }
        state.failures = 0;
        return {body, receipt: {source: token.source, request_started_at: iso(started),
          fetched_at: iso(received), received_at: iso(received),
          raw_body_sha256: createHash('sha256').update(body).digest('hex'), byte_length: body.byteLength,
          hash_basis: 'raw_response_bytes_sha256', source_finality: 'unknown', exchange_certified: false,
          source_license: 'unknown', retention_scope: 'local_only'}};
      } catch (error) {
        if (errors.has(error)) throw error;
        throw localError(terminal || 'LOCAL_SOURCE_REQUEST_FAILED');
      } finally { release(token); }
    })();
    try { return await Promise.race([operation, interrupt]); }
    finally { clearTimeout(timer); for (const [item, listener] of listeners) removeListener.call(item, 'abort', listener); }
    // A fetch/body that ignores cancellation retains its active slot until it
    // actually settles. This prevents late work from exceeding the source cap.
  }
  function requestOptions(value, keys) {
    const opts = optionsObject(value === undefined ? {} : value, keys);
    return {...opts, signal: signal(opts.signal), timeout_ms: integer(opts.timeout_ms, budget.limits.timeout_ms, 1, budget.limits.timeout_ms)};
  }
  function withQuoteReceipt(quote, receipts) {
    const receipt = receipts.get(quote.source);
    return {...quote, source_finality: 'unknown', exchange_certified: false,
      ...(receipt ? {request_started_at: receipt.request_started_at, fetched_at: receipt.fetched_at,
        request_latency_ms: Math.max(0, Date.parse(receipt.fetched_at) - Date.parse(receipt.request_started_at)),
        receipt: {...receipt, symbol: quote.symbol, source_timestamp: quote.source_timestamp,
          selected_at: quote.selected_at, selected_source: quote.source},
        observation_receipt: {source: quote.source, request_started_at: receipt.request_started_at,
          fetched_at: receipt.fetched_at, raw_body_sha256: receipt.raw_body_sha256,
          quote_binding_sha256: createHash('sha256').update(JSON.stringify([
            quote.symbol, quote.name, quote.source, quote.source_timestamp
          ]), 'utf8').digest('hex')}} : {})};
  }
  async function loadSeries(value, options) {
    trusted(env);
    const opts = requestOptions(options, ['interval', 'adjustment', 'limit', 'include_incomplete', 'source', 'timeout_ms', 'signal']);
    const symbol = mainboard(value), adjustment = opts.adjustment === undefined ? 'none' : opts.adjustment;
    const series = LOCAL_PUBLIC_LOADER_POLICY.series.find(item => item.interval === opts.interval && item.adjustment === adjustment);
    if (!series || opts.limit !== undefined && opts.limit !== series.limit || opts.source !== undefined && opts.source !== 'tencent'
        || opts.include_incomplete !== undefined && typeof opts.include_incomplete !== 'boolean') throw localError('INVALID_LOCAL_SERIES');
    const [token] = reserve(['tencent'], opts.signal, 'series');
    const period = {'1d': 'day', '1w': 'week', '1mo': 'month'}[series.interval];
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + symbol + ',' + period + ',,,' + series.limit + ',' + (adjustment === 'none' ? '' : adjustment);
    const {body, receipt} = await request(token, url, {timeout: opts.timeout_ms, callerSignal: opts.signal});
    trusted(env);
    let result;
    try { result = parseHistory(new TextDecoder('gb18030').decode(body), symbol, series.interval, series.limit,
      adjustment, opts.include_incomplete ?? true, Date.parse(receipt.fetched_at), token.request_started_at); }
    catch { throw localError('LOCAL_SOURCE_PARSE_FAILED'); }
    return freeze({...result, request_started_at: receipt.request_started_at, series_key: series.key, receipt,
      source_license: 'unknown', retention_scope: 'local_only', exchange_certified: false});
  }
  async function loadQuotes(values, options) {
    trusted(env);
    const opts = requestOptions(options, ['include_book', 'timeout_ms', 'signal']);
    const symbols = symbolBatch(values), includeBook = opts.include_book ?? true;
    if (typeof includeBook !== 'boolean') throw localError('INVALID_LOCAL_LOADER_OPTIONS');
    if (aborted(opts.signal)) throw localError('LOCAL_SOURCE_ABORTED');
    const receipts = new Map(), outcomes = new Map(), started = clock();
    const urls = ['https://qt.gtimg.cn/q=', 'https://hq.sinajs.cn/list='].map(base => base + symbols.join(','));
    const result = await routeQuotes(symbols, includeBook, {parseTencent, parseSina}, {
        now: clock, deadlineMs: opts.timeout_ms,
        fetchImpl: async (url, routeOptions) => {
          const index = urls.indexOf(url);
          if (index < 0) throw localError('LOCAL_SOURCE_ENDPOINT_REJECTED');
          const name = SOURCES[index]; let token;
          try {
            [token] = reserve([name], opts.signal, 'quotes');
            const remaining = Math.max(1, opts.timeout_ms - Math.max(0, clock() - started));
            const {body, receipt} = await request(token, urls[index], {
              timeout: remaining, callerSignal: opts.signal, routeSignal: routeOptions.signal});
            receipts.set(name, receipt);
            outcomes.set(name, {source: name, status: 'received', http_attempts: 1});
            return new Response(body);
          } catch (error) {
            outcomes.set(name, {source: name, status: 'unavailable', http_attempts: token?.started ? 1 : 0,
              error_code: error.code || 'LOCAL_SOURCE_REQUEST_FAILED', retry_at: error.retry_at ?? null});
            throw error;
          } finally { if (token && !token.started) release(token); }
        }
    });
    trusted(env);
    if (aborted(opts.signal)) throw localError('LOCAL_SOURCE_ABORTED');
    const quotes = result.quotes.map(quote => withQuoteReceipt(quote, receipts));
    return freeze({...result, quotes, receipts: SOURCES.flatMap(name => receipts.has(name) ? [receipts.get(name)] : []),
      source_outcomes: SOURCES.flatMap(name => outcomes.has(name) ? [outcomes.get(name)] : []),
        source_license: 'unknown', retention_scope: 'local_only', source_finality: 'unknown', exchange_certified: false});
  }
  async function loadNameQuotes(values, options) {
    trusted(env);
    const opts = requestOptions(options, ['include_book', 'timeout_ms', 'signal']);
    const symbols = symbolBatch(values), includeBook = opts.include_book ?? false;
    if (typeof includeBook !== 'boolean') throw localError('INVALID_LOCAL_LOADER_OPTIONS');
    // Name observations are explicit postclose work, sharing the two work slots
    // and Tencent start budget with history. They never reserve a Sina slot.
    const [token] = reserve(['tencent'], opts.signal, 'name_quotes');
    const {body, receipt} = await request(token, 'https://qt.gtimg.cn/q=' + symbols.join(','), {
      timeout: opts.timeout_ms, callerSignal: opts.signal});
    trusted(env);
    if (aborted(opts.signal)) throw localError('LOCAL_SOURCE_ABORTED');
    const raw = new TextDecoder('gb18030').decode(body), received = Date.parse(receipt.fetched_at), selected = clock();
    const receipts = new Map([['tencent', receipt]]);
    const quotes = symbols.map(symbol => {
      let candidate = {source: 'tencent', symbol, request_started_at: receipt.request_started_at,
        fetched_at: receipt.fetched_at, request_latency_ms: Math.max(0, received - token.request_started_at)};
      try { candidate.quote = validateQuote(parseTencent(raw, symbol, includeBook), symbol, 'tencent', includeBook, received); }
      catch { candidate.error = 'LOCAL_SOURCE_PARSE_FAILED'; }
      return withQuoteReceipt(selectQuote(symbol, [candidate], selected), receipts);
    });
    return freeze({quotes, cache: {used: false}, receipts: [receipt],
      source_outcomes: [{source: 'tencent', status: 'received', http_attempts: 1}],
      routing: {mode: 'single_source', providers: ['tencent'], deadline_ms: opts.timeout_ms,
        elapsed_ms: Math.max(0, selected - token.request_started_at),
        selection: 'fixed_tencent_validated_whole_snapshot', purpose: 'explicit_postclose_name_observation'},
      source_license: 'unknown', retention_scope: 'local_only', source_finality: 'unknown', exchange_certified: false,
      warnings: ['PUBLIC_DATA_NO_SLA; verify independently before financial decisions',
        'NAME_OBSERVATION_NOT_OFFICIAL_SECURITY_STATUS']});
  }
  function resumeSource(value) {
    trusted(env);
    budget.sources[source(value)].paused = false;
    return snapshot();
  }
  function setPostcloseActive(value) {
    trusted(env);
    if (typeof value !== 'boolean') throw localError('INVALID_LOCAL_POSTCLOSE_FLAG');
    budget.postclose_active = value;
    return snapshot();
  }
  const loader = Object.freeze({loadSeries, loadQuotes, loadNameQuotes, status: snapshot, resumeSource, setPostcloseActive});
  loaderEnvironments.set(loader, env);
  return loader;
}
