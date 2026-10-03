// Quote-only routing. Parsers remain owned by worker.mjs to preserve verified units.
export const QUOTE_ROUTING_CAPABILITIES = {
  quotes: {providers: ['tencent', 'sina'], parallel: true, automatic_failover: true},
  minute_bars: {providers: ['sina'], parallel: false},
  intraday: {providers: ['tencent', 'sina'], parallel: false, automatic_failover: true, scope: 'Sina backup minute OHLC close/interval volume only; no cumulative or average price'},
  historical_bars: {providers: ['tencent', 'sina'], parallel: true, scope: '1d with adjustment=none only; adjusted daily/week/month remain Tencent'},
  auction: {providers: ['eastmoney'], parallel: false, delayed: true},
  limitation: 'Parallel failover is scoped to quotes and unadjusted daily history; intraday has sequential Sina minute-close fallback; minute bars, adjusted daily/week/month, and auction each retain one provider.'
};
const HEADERS = {'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'};
const iso = ms => new Date(ms).toISOString();
const errorCode = e => String(e?.message || e).slice(0, 180);

export function validateQuote(q, symbol, source, includeBook, now) {
  if (!q || q.symbol !== symbol || q.source !== source || q.currency !== 'CNY' ||
      typeof q.name !== 'string' || !q.name.trim() || !Array.isArray(q.warnings) ||
      !q.unit_notes?.volume || !q.unit_notes?.amount) throw Error('INVALID_QUOTE_SCHEMA_OR_UNITS');
  // Round-trip rejects dates silently normalized by Date.parse, e.g. February 30.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(q.source_timestamp)) throw Error('INVALID_SOURCE_TIMESTAMP');
  const timestamp = Date.parse(q.source_timestamp);
  if (!Number.isFinite(timestamp) || iso(timestamp + 8 * 3600000).slice(0, 19) !== q.source_timestamp.slice(0, 19)) throw Error('INVALID_SOURCE_TIMESTAMP');
  if (timestamp > now + 5000) throw Error('FUTURE_SOURCE_TIMESTAMP');
  for (const key of ['price', 'previous_close', 'open', 'high', 'low', 'volume_shares', 'amount_cny']) {
    if (!Number.isFinite(q[key]) || q[key] < 0) throw Error('INVALID_QUOTE_VALUES');
  }
  if (q.price <= 0 || q.previous_close <= 0 || q.high < q.low ||
      (q.high > 0 && (q.price > q.high || (q.open > 0 && q.open > q.high))) ||
      (q.low > 0 && (q.price < q.low || (q.open > 0 && q.open < q.low)))) throw Error('INVALID_QUOTE_OHLC');
  if (includeBook) {
    if (q.book?.source !== source || !q.unit_notes?.book) throw Error('INVALID_BOOK_SOURCE_OR_UNITS');
    for (const side of ['bids', 'asks']) {
      if (!Array.isArray(q.book[side]) || q.book[side].length !== 5) throw Error('INVALID_BOOK_SCHEMA');
      for (const level of q.book[side]) if (!Number.isFinite(level.price) || level.price < 0 ||
        !Number.isFinite(level.volume_shares) || level.volume_shares < 0) throw Error('INVALID_BOOK_VALUES');
    }
  }
  return q;
}

async function fetchCandidateBatch(provider, symbols, {fetchImpl, now, deadline, includeBook}) {
  const started = now(), controller = new AbortController();
  let timer;
  const metadata = () => ({source: provider.name, request_started_at: iso(started), fetched_at: iso(now()), request_latency_ms: Math.max(0, now() - started)});
  const operation = (async () => {
    const response = await fetchImpl(provider.url + symbols.join(','), {
      headers: HEADERS, redirect: 'manual', cache: 'no-store', signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) throw Error('UPSTREAM_REDIRECT_REJECTED');
    if (!response.ok) throw Error('UPSTREAM_HTTP_' + response.status);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 1000000) throw Error('UPSTREAM_RESPONSE_TOO_LARGE');
    return new TextDecoder('gb18030').decode(buffer);
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(Error('SHARED_DEADLINE_EXCEEDED')); controller.abort(); }, Math.max(0, deadline - now()));
  });
  try {
    const raw = await Promise.race([operation, timeout]);
    const info = metadata(), received = Date.parse(info.fetched_at);
    return symbols.map(symbol => {
      try {
        const quote = validateQuote(provider.parse(raw, symbol, includeBook), symbol, provider.name, includeBook, received);
        return {...info, symbol, quote};
      } catch (e) { return {...info, symbol, error: errorCode(e)}; }
    });
  } catch (e) {
    const info = metadata();
    return symbols.map(symbol => ({...info, symbol, error: errorCode(e)}));
  } finally { clearTimeout(timer); }
}

export function selectQuote(symbol, candidates, now = Date.now(), maxAgeSeconds = 90) {
  const summaries = candidates.map(c => ({
    source: c.source, request_started_at: c.request_started_at, fetched_at: c.fetched_at,
    request_latency_ms: c.request_latency_ms,
    ...(c.error ? {status: 'error', error: c.error} : {
      status: now - Date.parse(c.quote.source_timestamp) <= maxAgeSeconds * 1000 ? 'recent' : 'stale',
      source_timestamp: c.quote.source_timestamp,
      data_age_seconds: (now - Date.parse(c.quote.source_timestamp)) / 1000
    })
  }));
  const usable = candidates.filter(c => !c.error && c.quote).sort((a, b) =>
    Date.parse(b.quote.source_timestamp) - Date.parse(a.quote.source_timestamp) ||
    a.request_latency_ms - b.request_latency_ms || a.source.localeCompare(b.source));
  if (!usable.length) return {symbol, error: {code: 'QUOTE_UNAVAILABLE', message: summaries.map(c => c.source + ': ' + c.error).join('; ')}, fetched_at: iso(now), selection_reason: 'NO_VALID_SOURCE', candidates: summaries};
  const chosen = usable[0], age = (now - Date.parse(chosen.quote.source_timestamp)) / 1000;
  const recent = age <= maxAgeSeconds;
  const reason = !recent ? 'NEWEST_VALID_BUT_STALE' : usable.length === 1 ? 'ONLY_VALID_SOURCE' :
    chosen.quote.source_timestamp === usable[1].quote.source_timestamp ? 'EQUAL_SOURCE_TIMESTAMP_LOWER_REQUEST_LATENCY' : 'NEWEST_VALID_SOURCE_TIMESTAMP';
  return {...chosen.quote,
    request_started_at: chosen.request_started_at, fetched_at: chosen.fetched_at,
    request_latency_ms: chosen.request_latency_ms, selected_at: iso(now), data_age_seconds: age,
    freshness: {status: recent ? 'recent' : 'stale', age_seconds: Math.round(age), threshold_seconds: maxAgeSeconds, market_calendar_verified: false},
    selection_reason: reason, candidates: summaries,
    latency_notes: 'request_latency_ms measures this upstream HTTP request; data_age_seconds measures provider timestamp age at selection. Neither certifies exchange-to-client latency.',
    warnings: [...chosen.quote.warnings,
      ...(!recent ? ['NOT_CURRENT_DATA: source may be delayed, market closed, or trading halted'] : []),
      ...(summaries.some(c => c.status === 'error') ? ['ALTERNATE_SOURCE_FAILED; see candidates'] : []),
      ...(symbol.startsWith('bj') ? ['BEIJING_PROVIDER_COVERAGE_MAY_BE_INCOMPLETE'] : [])]
  };
}

export async function routeQuotes(symbols, includeBook, parsers, options = {}) {
  const now = options.now || Date.now;
  const deadlineMs = options.deadlineMs ?? 6500;
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 6500) throw Error('INVALID_QUOTE_DEADLINE');
  const started = now(), deadline = started + deadlineMs;
  const config = {fetchImpl: options.fetchImpl || fetch, now, deadline, includeBook};
  const providers = [
    {name: 'tencent', url: 'https://qt.gtimg.cn/q=', parse: parsers.parseTencent},
    {name: 'sina', url: 'https://hq.sinajs.cn/list=', parse: parsers.parseSina}
  ];
  // Both whole-batch requests start together; no per-symbol sequential fallback.
  const batches = await Promise.all(providers.map(provider => fetchCandidateBatch(provider, symbols, config)));
  const selectedAt = now();
  return {quotes: symbols.map((symbol, i) => selectQuote(symbol, batches.map(batch => batch[i]), selectedAt)),
    cache: {used: false},
    routing: {mode: 'parallel', providers: providers.map(p => p.name), deadline_ms: deadlineMs,
      elapsed_ms: Math.max(0, selectedAt - started), selection: 'newest_valid_source_timestamp_then_lowest_request_latency',
      comparable_freshness: 'identical source timestamps', capabilities: QUOTE_ROUTING_CAPABILITIES},
    warnings: ['PUBLIC_DATA_NO_SLA; verify independently before financial decisions', 'QUOTE_ROUTING_DOES_NOT_SELECT_OTHER_DATA_TYPES']};
}
