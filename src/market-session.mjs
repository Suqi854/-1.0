// Static, dated exchange-announced calendar. No live halt/exception-calendar claim.
const DAY = 86400000, OFFSET = 8 * 3600000;
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
const cnDate = ms => isoDate(ms + OFFSET);
const at = (date, time) => Date.parse(`${date}T${time}:00+08:00`);
const addDay = (date, n) => isoDate(Date.parse(date + 'T00:00:00Z') + n * DAY);
const SOURCES = Object.freeze({
  sh: Object.freeze({calendar: 'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml', rules: 'https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20260424_10816482.shtml'}),
  sz: Object.freeze({calendar: 'https://www.szse.cn/disclosure/notice/t20251222_618087.html', rules: 'https://docs.static.szse.cn/www/lawrules/rule/trade/current/W020260424690713155663.pdf'}),
  bj: Object.freeze({calendar: 'https://www.bse.cn/important_news/200027428.html', rules: 'https://www.bse.cn/jygl_list/200028217.html'})
});
export const MARKET_CALENDAR = Object.freeze({
  timezone: 'Asia/Shanghai', coverage_start: '2026-01-01', coverage_end: '2026-12-31',
  verified_as_of: '2026-09-30', calendar_version: 'exchange-announced-2026-v1',
  sources: SOURCES,
  scope: 'Announced regular A-share competitive-auction sessions only; not live exchange operating status. Extraordinary closures, security suspensions, and after-hours participation are not verified.'
});
const HOLIDAYS = Object.freeze([
  ['2026-01-01','2026-01-03'], ['2026-02-15','2026-02-23'],
  ['2026-04-04','2026-04-06'], ['2026-05-01','2026-05-05'],
  ['2026-06-19','2026-06-21'], ['2026-09-25','2026-09-27'], ['2026-10-01','2026-10-07']
]);
function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + 'T00:00:00Z')) && isoDate(Date.parse(date + 'T00:00:00Z')) === date;
}
export function tradingDay(date) {
  if (!validDate(date) || date < MARKET_CALENDAR.coverage_start || date > MARKET_CALENDAR.coverage_end) return null;
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.some(([first, last]) => date >= first && date <= last);
}
function previousSession(date, inclusive = false) {
  for (let d = inclusive ? date : addDay(date, -1); ; d = addDay(d, -1)) {
    const state = tradingDay(d);
    if (state === null) return null;
    if (state) return d;
  }
}
export function securityStatus(quote) {
  if(quote?.source==='tencent'&&quote.provider_price_limits?.mapping_verified){const p=quote.provider_price_limits;return {suspension:'unknown',price_limit_status:p.price_relation,limit_up_price:p.limit_up_price,limit_down_price:p.limit_down_price,verified:false,provider_fields_verified:true,source:p.source,source_timestamp:p.source_timestamp,scope:'same provider quote snapshot only; may be stale',reason:'Provider limit fields and price comparison validated; exchange effective rules and suspension unverified; price at limit does not prove locked book'};}
  return {suspension: 'unknown', price_limit_status: 'unknown', limit_up_price: null, limit_down_price: null,
    verified: false, reason: 'No documented and independently checked provider security-status fields or security-specific effective limit rules; do not infer from zero volume, stale price, name, code, or percentage change.'};
}
export function marketState(now = Date.now(), symbol = '') {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const exchange = /^(sh|sz|bj)/i.exec(symbol)?.[1].toLowerCase() ?? null;
  const base = {timezone: 'Asia/Shanghai', exchange, calendar: {...MARKET_CALENDAR, sources: exchange ? SOURCES[exchange] : SOURCES},
    live_exchange_status_verified: false, security_status: securityStatus(),
    warnings: ['REGULAR_AUCTION_SCHEDULE_ONLY; extraordinary closures and security-specific halts unverified', 'AFTER_HOURS_FINAL_VOLUME_AND_PARTICIPATION_UNVERIFIED']};
  if (!Number.isFinite(ms)) return {...base, phase: 'unknown', market_calendar_verified: false, trading_day: null, expected_source_timestamp: null};
  const date = cnDate(ms), time = new Date(ms + OFFSET).toISOString().slice(11,19), minute = Number(time.slice(0,2)) * 60 + Number(time.slice(3,5));
  const trading = tradingDay(date);
  if (trading === null) return {...base, date, local_time: time, phase: 'unknown', market_calendar_verified: false, trading_day: null, expected_source_timestamp: null, warnings: [...base.warnings, 'OUTSIDE_VERIFIED_CALENDAR_COVERAGE']};
  let phase, expectedDate = date, expectedTime, active = false;
  if (!trading || minute < 555) {
    phase = !trading ? 'closed' : 'pre_open'; expectedDate = previousSession(date); expectedTime = '15:00';
  } else if (minute < 565) {
    phase = 'opening_auction'; expectedDate = previousSession(date); expectedTime = '15:00';
  } else if (minute < 570) {phase = 'opening_auction_gap'; expectedTime = '09:25';}
  else if (minute < 690) {phase = 'continuous_am'; active = true;}
  else if (minute < 780) {phase = 'lunch_break'; expectedTime = '11:30';}
  else if (minute < 897) {phase = 'continuous_pm'; active = true;}
  else if (minute < 900) {phase = 'closing_auction'; expectedTime = '14:57';}
  else {phase = 'after_close'; expectedTime = '15:00';}
  return {...base, date, local_time: time, phase, trading_day: trading, market_calendar_verified: true,
    regular_continuous_trading: active, expected_session_date: expectedDate,
    expected_source_timestamp: active ? new Date(ms).toISOString() : expectedDate ? `${expectedDate}T${expectedTime}:00+08:00` : null,
    expected_timestamp_basis: active ? 'current_regular_continuous_session' : phase === 'opening_auction' ? 'previous_close; auction indicative fields are not verified by this feed' : 'last_scheduled_regular_auction_observation',
    after_hours_window: trading && minute >= 905 && minute < 930 ? 'possible; applicability and implementation unverified' : null};
}
function periodBounds(date, interval) {
  if (!validDate(date)) return null;
  if (interval === '1d') return [date,date];
  if (interval === '1w') {
    const offset = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const start = addDay(date, -offset); return [start,addDay(start,6)];
  }
  if (interval === '1mo') {
    const start = date.slice(0,7) + '-01', d = new Date(start + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth()+1); return [start,isoDate(d.getTime()-DAY)];
  }
  return null;
}
function finalSessionInPeriod(date, interval) {
  const bounds = periodBounds(date, interval);
  if (!bounds) return null;
  const [start, end] = bounds;
  // Requiring full coverage prevents wrongly finalizing cross-year periods.
  if (tradingDay(start) === null || tradingDay(end) === null) return null;
  const last = previousSession(end, true);
  return last && last >= start ? last : null;
}
// null means unverified, never truthy. 15:30+3s is a conservative aggregate-volume
// boundary (potential after-hours/block totals); not a provider-finalization guarantee.
export function periodCompletion(date, interval, cutoff = Date.now()) {
  const last = finalSessionInPeriod(date, interval);
  if (!last || interval === '1d' && tradingDay(date) !== true) return null;
  return at(last,'15:30') + 3000 < Number(cutoff);
}
export function latestCompletedPeriod(now, interval = '1d') {
  const today = cnDate(now);
  if (tradingDay(today) === null) return null;
  for (let d = today; tradingDay(d) !== null; d = addDay(d,-1)) {
    if (tradingDay(d) && periodCompletion(d,interval,now) === true) return finalSessionInPeriod(d,interval);
  }
  return null;
}
// `complete` preserves historical chart compatibility. New datasets use the
// separate calendar evidence; neither field certifies upstream finality.
export function barCompletion(date, interval, cutoff = Date.now()) {
  const bounds = periodBounds(date, interval), today = cnDate(Number(cutoff));
  const current = periodBounds(today, interval), calendar = periodCompletion(date, interval, cutoff);
  const invalidDay = interval === '1d' && tradingDay(date) === false;
  const elapsed = !invalidDay && calendar === null && bounds && current && bounds[0] < current[0];
  const expected = latestCompletedPeriod(Number(cutoff), interval);
  const expectedBounds = expected && periodBounds(expected, interval);
  return {
    complete: !invalidDay && (calendar === true || Boolean(elapsed)),
    calendar_completion: invalidDay ? null : calendar,
    completion_basis: invalidDay ? 'invalid_nontrading_daily_label' : calendar === null ? 'elapsed_calendar_period_unverified_exchange_calendar' : 'verified_calendar_schedule_with_conservative_buffer',
    period_end_session: finalSessionInPeriod(date, interval),
    observed_latest: expectedBounds && bounds ? bounds[0] === expectedBounds[0] : null,
    source_finality: 'unknown'
  };
}
export function marketFreshness(timestamp, now = Date.now(), maxAge = 90, {symbol = '', kind = 'quote'} = {}) {
  const state = marketState(now,symbol);
  const parts = typeof timestamp === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  const parsed = parts && validDate(parts[1]) && Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60 ? Date.parse(timestamp) : NaN;
  const age = (Number(now) - parsed)/1000;
  const base = {age_seconds: Number.isFinite(age) ? Math.round(age) : null, threshold_seconds: maxAge,
    source_timestamp: timestamp, market_calendar_verified: state.market_calendar_verified,
    market_phase: state.phase, calendar_coverage: {start: MARKET_CALENDAR.coverage_start,end: MARKET_CALENDAR.coverage_end,verified_as_of: MARKET_CALENDAR.verified_as_of},
    expected_source_timestamp: state.expected_source_timestamp, expected_session_date: state.expected_session_date ?? null,
    exchange_certified_realtime: false, scope: 'Regular competitive-auction price/time expectations; not proof of feed or aggregate-volume finality',
    warnings: [...state.warnings]};
  if (!Number.isFinite(parsed)) return {...base,status:'invalid_timestamp'};
  if (['1d','1w','1mo'].includes(kind) ? cnDate(parsed) > cnDate(Number(now)) : age < -5) return {...base,status:'future_timestamp'};
  if (!state.market_calendar_verified) return {...base,status:'unknown'};
  if (kind === 'auction') {
    const observedDate = cnDate(parsed), today = cnDate(Number(now));
    const currentWindow = state.trading_day && state.local_time >= '09:15:00' && state.local_time < '09:31:00';
    const status = observedDate < today ? 'prior_session_observations' : currentWindow ? (age <= maxAge ? 'delayed_recent_observation' : 'delayed_observation_lagging') : 'historical_auction_observations';
    return {...base, status, expected_source_timestamp: null, expected_session_date: today,
      scope: 'Delayed 09:15–09:30 provider minute observations; historical age is not afternoon-quote lag',
      observation_window: {start: observedDate + 'T09:15:00+08:00', end: observedDate + 'T09:30:00+08:00'},
      same_day: observedDate === today, full_process_verified: false,
      warnings: [...base.warnings, 'DELAYED_SOURCE_NOT_REALTIME_AUCTION', 'HISTORICAL_WINDOW_DOES_NOT_ESTABLISH_COMPLETENESS_OR_FINAL_MATCH']};
  }
  if (['1d','1w','1mo'].includes(kind)) {
    const expected = latestCompletedPeriod(Number(now),kind), observedDate = cnDate(parsed);
    const observedPeriod = periodBounds(observedDate,kind), expectedPeriod = expected && periodBounds(expected,kind);
    return {...base, expected_session_date: expected, expected_source_timestamp: expected ? `${expected}T15:00:00+08:00` : null,
      status: !expected || !observedPeriod ? 'unknown' : observedPeriod[0] < expectedPeriod[0] ? 'stale' : periodCompletion(observedDate,kind,now) !== true ? 'incomplete' : 'latest_session',
      warnings: [...base.warnings,'BAR_DATE_IS_NOT_A_LIVE_UPDATE_TIMESTAMP; period completion is schedule-inferred, provider finality unverified']};
  }
  if (!base.expected_source_timestamp) return {...base,status:'unknown'};
  const behind = (Date.parse(base.expected_source_timestamp)-parsed)/1000;
  const stale = behind > maxAge;
  return {...base, lag_from_expected_seconds: Math.max(0,Math.round(behind)),
    status: stale ? 'stale' : state.regular_continuous_trading || age <= maxAge ? 'recent' : 'latest_session',
    warnings: [...base.warnings,...(stale ? ['SOURCE_BEHIND_EXPECTED_SESSION; delayed feed, missing trades or suspension cannot be distinguished'] : [])]};
}
