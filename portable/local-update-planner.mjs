import { readJSONInput } from '../modules/condition-screen/src/json-input.js';
import { MARKET_CALENDAR, tradingDay, latestCompletedPeriod, marketState } from '../src/market-session.mjs';

// Local, synchronous planning only. This module never starts work or stores state.
// The host owns acknowledgements, source throttling, leases and serial execution.
const VERSION = 'local-market-plan-v1';
const OFFSET = 8 * 3600000;
const MIN_SOURCE_INTERVAL_MS = 1000;
const MAX_POOL_SIZE = 10000;
const MAX_JSON_LENGTH = 250000;
const MAINBOARD_SYMBOL = /^(?:sh(?:600|601|603|605)\d{3}|sz(?:000|001|002|003|004)\d{3})$/;
const INPUT_FIELDS = new Set(['now', 'fast_quote_symbols', 'research_pool_symbols', 'research_pool_size', 'quote_refresh_target_ms', 'last_due_keys', 'paused']);
const DAY_FIELDS = new Set(['quote', 'tail']);
const owns = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const closed = (o, allowed) => record(o) && Object.keys(o).every(key => allowed.has(key));
const at = (day, time) => Date.parse(`${day}T${time}+08:00`);
const localDate = ms => new Date(ms + OFFSET).toISOString().slice(0, 10);
const invalid = code => ({ valid: false, reason: 'invalid_input', error_code: code, planning_only: true, runtime: 'local', activated_background: false, source_freshness: 'unknown', tasks: [] });
const validSymbols = (symbols, limit) => Array.isArray(symbols) && symbols.length <= limit && symbols.every(symbol => typeof symbol === 'string' && MAINBOARD_SYMBOL.test(symbol) && symbol !== 'sz000000' && !(symbol >= 'sz001001' && symbol <= 'sz001199'));

function quoteKeyState(key) {
  if (key === null) return { valid: true, bucket: null };
  if (typeof key !== 'string' || key.length > 100) return { valid: false };
  const match = /^local-market-plan-v1:quote:(\d{4}-\d{2}-\d{2}):(\d{13})$/.exec(key);
  if (!match || tradingDay(match[1]) !== true) return { valid: false };
  const bucket = Number(match[2]);
  return { valid: bucket >= at(match[1], '09:00:00') && bucket < at(match[1], '16:00:00'), bucket };
}

function tailKeyState(key) {
  if (key === null) return { valid: true, date: null };
  if (typeof key !== 'string' || key.length > 100) return { valid: false };
  const match = /^local-market-plan-v1:tail:(\d{4}-\d{2}-\d{2})$/.exec(key);
  return { valid: Boolean(match && tradingDay(match[1]) === true), date: match?.[1] ?? null };
}

/**
 * Accepts JSON text, or a bounded plain JSON object in Node. Only `now` (integer
 * epoch milliseconds) and `fast_quote_symbols` (0..20 local symbols) are required.
 * Optional fields: quote_refresh_target_ms=1000 (1000..60000),
 * research_pool_symbols (0..10000 normalized local symbols) OR research_pool_size
 * (0..10000 integer), last_due_keys={quote:null,tail:null}, paused=false.
 * No calendar overrides, network sources, private strategy or executable input.
 *
 * Fast symbols are copied, sorted and deduplicated; research symbols are never
 * inferred to be a fast quote subscription or echoed in the output. The explicit
 * research denominator is frozen for this plan/task only; persistence and pool
 * identity freezing across calls belong to the host. Keep acknowledged due keys
 * locally; acknowledge work only under the host's lease.
 * A due key is an idempotency hint, never evidence that an observation exists.
 * Tail candidates cover today's 15:35..16:00 catch-up window only. Both scopes
 * can be planned together; the host must fairly serialize their source work
 * under the shared source budget while keeping fast quotes responsive. A pure
 * plan cannot enforce a lease, schedule HTTP work or certify source freshness.
 */
export function planLocalMarketTasks(input) {
  if (typeof input === 'string' && input.length > MAX_JSON_LENGTH) return invalid('JSON_INPUT_BOUNDS');
  const parsed = readJSONInput(input);
  if (!parsed.valid) return invalid(parsed.error.code);
  const options = parsed.value;
  if (!closed(options, INPUT_FIELDS) || !owns(options, 'now') || !owns(options, 'fast_quote_symbols')) return invalid('PLANNER_INPUT_FIELDS');
  const now = options.now;
  // Keep Asia/Shanghai's local ISO year within the four-digit JSON contract.
  if (!Number.isSafeInteger(now) || now < -62167248000000 || now >= 253402272000000) return invalid('PLANNER_NOW');
  if (!validSymbols(options.fast_quote_symbols, 20)) return invalid('PLANNER_FAST_QUOTE_SYMBOLS');
  const hasResearchSymbols = owns(options, 'research_pool_symbols'), hasResearchSize = owns(options, 'research_pool_size');
  if (hasResearchSymbols && hasResearchSize) return invalid('PLANNER_RESEARCH_POOL_FIELDS');
  if (hasResearchSymbols && !validSymbols(options.research_pool_symbols, MAX_POOL_SIZE)) return invalid('PLANNER_RESEARCH_POOL_SYMBOLS');
  if (hasResearchSize && (!Number.isInteger(options.research_pool_size) || options.research_pool_size < 0 || options.research_pool_size > MAX_POOL_SIZE)) return invalid('PLANNER_RESEARCH_POOL_SIZE');
  const researchSize = hasResearchSymbols ? new Set(options.research_pool_symbols).size : hasResearchSize ? options.research_pool_size : 0;
  const target = owns(options, 'quote_refresh_target_ms') ? options.quote_refresh_target_ms : 1000;
  const paused = owns(options, 'paused') ? options.paused : false;
  if (!Number.isInteger(target) || target < MIN_SOURCE_INTERVAL_MS || target > 60000) return invalid('PLANNER_QUOTE_TARGET');
  if (typeof paused !== 'boolean') return invalid('PLANNER_PAUSED');
  const keys = owns(options, 'last_due_keys') ? options.last_due_keys : { quote: null, tail: null };
  if (!closed(keys, DAY_FIELDS) || !owns(keys, 'quote') || !owns(keys, 'tail')) return invalid('PLANNER_DUE_KEYS');
  const lastQuote = quoteKeyState(keys.quote), lastTail = tailKeyState(keys.tail);
  if (!lastQuote.valid || !lastTail.valid) return invalid('PLANNER_DUE_KEYS');

  const members = [...new Set(options.fast_quote_symbols)].sort();
  const state = marketState(now);
  const day = localDate(now), trading = tradingDay(day);
  const calendarKnown = trading !== null && state.market_calendar_verified === true;
  const open = at(day, '09:00:00'), end = at(day, '16:00:00');
  const inWindow = calendarKnown && trading === true && now >= open && now < end;
  const scheduledTail = at(day, '15:35:00');
  // Reuse the calendar's strict conservative >15:30:03 completion boundary.
  const completionPassed = calendarKnown && trading === true && latestCompletedPeriod(now, '1d') === day;
  const baseReason = paused ? 'paused' : !calendarKnown ? 'calendar_unknown' : !trading ? 'nontrading_day' : !inWindow ? 'outside_collection_window' : null;
  const result = {
    valid: true, reason: baseReason ?? 'idle', planning_only: true, runtime: 'local', activated_background: false,
    session_date: day, timezone: MARKET_CALENDAR.timezone, calendar_version: MARKET_CALENDAR.calendar_version,
    calendar_verified: calendarKnown, trading_day: trading, market_phase: state.phase,
    collection_window_active: inWindow, regular_continuous_trading: state.regular_continuous_trading === true,
    source_freshness: 'unknown', source_finality: 'unknown',
    fast_quote: {
      requested_refresh_target_ms: target, source_min_interval_ms: MIN_SOURCE_INTERVAL_MS,
      subscribed_symbol_count: members.length, maximum_batch_size: 20, batch_count: members.length ? 1 : 0,
      minimum_full_batch_cycle_ms: members.length ? MIN_SOURCE_INTERVAL_MS : 0,
      reason: baseReason ?? (members.length ? 'not_due' : 'empty_subscription')
    },
    research_pool: { size: researchSize, denominator_basis: hasResearchSymbols ? 'explicit_local_symbols_deduplicated' : hasResearchSize ? 'explicit_local_size_only' : 'not_provided', membership_verified: false, denominator_frozen_for_plan: true },
    tail: { scheduled_at: scheduledTail, completion_gate_passed: completionPassed, target_session: null, reason: baseReason ?? (researchSize ? 'before_15_35' : 'empty_research_pool') },
    source_budget: { shared: true, minimum_operation_interval_ms: MIN_SOURCE_INTERVAL_MS, dispatch_policy: 'host_fair_serialisation_keep_fast_quote_responsive', enforced_by_planner: false },
    tasks: []
  };
  if (baseReason) return result;

  const tailDue = researchSize > 0 && now >= scheduledTail && completionPassed;
  const tailDeduplicated = tailDue && lastTail.date !== null && lastTail.date >= day;
  if (tailDue) {
    result.tail.target_session = day;
    result.tail.reason = tailDeduplicated ? 'deduplicated_or_clock_regression' : now === scheduledTail ? 'scheduled' : 'same_day_catch_up';
    if (!tailDeduplicated) result.tasks.push({
      kind: 'postclose_tail', scope: 'postclose_research_pool', due_key: `${VERSION}:tail:${day}`,
      observation_revision: `${VERSION}:observation:tail:${day}`, target_session: day,
      priority: 2, runnable: true, source_operation_budget_class: 'postclose_research_pool', catch_up: now > scheduledTail, research_pool_size: researchSize
    });
  }
  if (members.length) {
    const bucket = open + Math.floor((now - open) / target) * target;
    if (lastQuote.bucket !== null && lastQuote.bucket >= bucket) result.fast_quote.reason = 'deduplicated_or_clock_regression';
    else {
      result.fast_quote.reason = 'scheduled';
      result.tasks.unshift({
        kind: 'quote_batch', scope: 'fast_quote', due_key: `${VERSION}:quote:${day}:${bucket}`,
        observation_revision: `${VERSION}:observation:quote:${day}:${bucket}`,
        target_session: day, priority: 1, runnable: true, source_operation_budget_class: 'fast_quote',
        symbols: members
      });
    }
  }
  result.reason = result.tasks.length ? 'planned' : result.fast_quote.reason === 'deduplicated_or_clock_regression' || tailDeduplicated ? 'deduplicated' : 'idle';
  return result;
}
