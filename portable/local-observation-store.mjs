import {isTrustedLocalDatabase} from './sqlite.mjs';
import {coverage} from '../src/data-integrity.mjs';
import {auctionQuality} from '../src/auction-quality.mjs';

// Importing this Node-only module does not open a database or request observations.
// Only an openLocalDatabase capability can enter any operation below.
const policy = 'explicit_local_request_observations';
const storageScope = 'local_node_sqlite';
const archiveScope = 'Completed observations supplied to a local request only; separate source and adjustment series; no automatic collection, invented gaps, or full-history guarantee. Local archive has no automatic expiry.';
const snapshotScope = 'Latest requested window in local Node SQLite; seven-day fallback limit; no full-history guarantee.';
const auctionScope = 'Successful same-China-calendar-day auction observations in local Node SQLite; fuller coverage and nonregressing clocks preserved; not a complete auction feed.';
const maxSnapshotAge = 7 * 86400;
const local = {policy, storage_scope: storageScope};

function unavailable(field) {
  return {available: false, ...(field ? {[field]: false} : {}), reason: 'TRUSTED_LOCAL_STORAGE_REQUIRED', ...local};
}

function reasonText(value, fallback = 'SOURCE_UNAVAILABLE') {
  return typeof value === 'string' && value.length ? value.slice(0, 120).replace(/[\x00-\x1f\x7f]/g, ' ') : fallback;
}

function sourceErrorText(error) {
  try { return reasonText(error?.message); } catch { return 'SOURCE_UNAVAILABLE'; }
}

function chinaDay(time) {
  if (!Number.isFinite(time)) return null;
  const date = new Date(time + 8 * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function auctionKey(symbol, time) {
  return JSON.stringify(['auction_same_day_v1', symbol, chinaDay(time)]);
}

function validAuction(data, symbol, time) {
  const day = chinaDay(time);
  if (!day || !data || data.symbol !== symbol || data.source !== 'eastmoney' || data.session_date !== day || !Array.isArray(data.points) || !data.points.length) return false;
  const fetched = Date.parse(data.fetched_at);
  if (!Number.isFinite(fetched) || fetched > time) return false;
  let previous = -Infinity;
  for (const point of data.points) {
    const stamp = point?.source_timestamp;
    const observed = Date.parse(stamp);
    if (typeof stamp !== 'string' || stamp.slice(0, 10) !== day || chinaDay(observed) !== day || !Number.isFinite(observed) || observed > time + 5000 || observed > fetched + 5000 || observed <= previous) return false;
    previous = observed;
  }
  return data.source_timestamp === data.points.at(-1).source_timestamp;
}

export async function archiveObservations(env, data) {
  if (!isTrustedLocalDatabase(env)) return unavailable('saved');
  try {
    const kind = Array.isArray(data?.bars) ? 'bars' : Array.isArray(data?.points) ? 'intraday' : null;
    const interval = data?.interval ?? 'intraday';
    const adjustment = data?.adjustment ?? 'none';
    const receipt = data?.fetched_at;
    if (!kind || typeof data.symbol !== 'string' || typeof data.source !== 'string' || typeof interval !== 'string' || typeof adjustment !== 'string' || !Number.isFinite(Date.parse(receipt))) {
      return {available: true, saved: false, observations: 0, reason: 'LOCAL_ARCHIVE_ARGUMENTS_INVALID', scope: archiveScope, ...local};
    }
    const rows = (kind === 'bars' ? data.bars : data.points).filter(row => row?.complete === true && row.pending !== true && row.status !== 'pending' && typeof row.source_timestamp === 'string' && Number.isFinite(Date.parse(row.source_timestamp)));
    if (!rows.length) return {available: true, saved: false, observations: 0, scope: archiveScope, ...local};
    const statements = rows.map(row => env.DB.prepare(`
      INSERT INTO market_archive (key,symbol,source,kind,interval,adjustment,source_timestamp,payload,first_fetched_at,last_fetched_at,revision_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)
      ON CONFLICT(key) DO UPDATE SET
        revision_count=market_archive.revision_count+CASE WHEN market_archive.payload<>excluded.payload THEN 1 ELSE 0 END,
        payload=excluded.payload,last_fetched_at=excluded.last_fetched_at
      WHERE julianday(excluded.last_fetched_at) >= julianday(market_archive.last_fetched_at)
    `).bind(JSON.stringify([data.symbol, data.source, kind, interval, adjustment, row.source_timestamp]), data.symbol, data.source, kind, interval, adjustment, row.source_timestamp, JSON.stringify(row), receipt, receipt));
    for (let offset = 0; offset < statements.length; offset += 80) {
      if (!isTrustedLocalDatabase(env)) return unavailable('saved');
      await env.DB.batch(statements.slice(offset, offset + 80));
    }
    return {available: true, saved: true, observations: rows.length, scope: archiveScope, revision_policy: 'Latest local observation per source/timestamp; original first receipt, latest receipt and change count retained, not all prior revisions', ...local};
  } catch {
    return {available: false, saved: false, reason: 'LOCAL_ARCHIVE_WRITE_FAILED_OR_PARTIAL', scope: archiveScope, ...local};
  }
}

export async function readArchive(env, args) {
  if (!isTrustedLocalDatabase(env)) throw Error('LOCAL_ARCHIVE_STORAGE_UNAVAILABLE');
  try {
    const {symbol, source, interval, adjustment = 'none', limit = 120, before} = args;
    if (typeof symbol !== 'string' || typeof source !== 'string' || typeof interval !== 'string' || typeof adjustment !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 600 || (before !== undefined && (typeof before !== 'string' || !Number.isFinite(Date.parse(before))))) throw Error('INVALID_ARGUMENTS');
    const kind = interval === 'intraday' ? 'intraday' : 'bars';
    const parameters = [symbol, source, kind, interval, adjustment];
    const summary = await env.DB.prepare('SELECT COUNT(*) AS count,MIN(source_timestamp) AS first_timestamp,MAX(source_timestamp) AS last_timestamp,MIN(first_fetched_at) AS first_receipt,MAX(last_fetched_at) AS last_receipt FROM market_archive WHERE symbol=? AND source=? AND kind=? AND interval=? AND adjustment=?').bind(...parameters).first();
    if (!isTrustedLocalDatabase(env)) throw Error('LOCAL_ARCHIVE_STORAGE_UNAVAILABLE');
    const result = await env.DB.prepare('SELECT source_timestamp,payload,first_fetched_at,last_fetched_at,revision_count FROM market_archive WHERE symbol=? AND source=? AND kind=? AND interval=? AND adjustment=?' + (before !== undefined ? ' AND source_timestamp < ?' : '') + ' ORDER BY source_timestamp DESC LIMIT ?').bind(...parameters, ...(before !== undefined ? [before] : []), limit + 1).all();
    const more = result.results.length > limit;
    const rows = result.results.slice(0, limit).reverse().map(row => ({...JSON.parse(row.payload), provenance: {first_fetched_at: row.first_fetched_at, last_fetched_at: row.last_fetched_at, revision_count: row.revision_count}}));
    const series = {symbol, source, interval, adjustment, ...(kind === 'bars' ? {bars: rows} : {points: rows, session_date: null})};
    return {...series, archive: {available: true, scope: archiveScope, total_observed_records: summary.count, observed_first_timestamp: summary.first_timestamp, observed_last_timestamp: summary.last_timestamp, first_receipt: summary.first_receipt, last_receipt: summary.last_receipt, returned: rows.length, has_more: more, next_before: more ? rows[0]?.source_timestamp : null, query_order: 'latest window, returned chronologically', full_history: false, revision_policy: 'latest local observed payload plus first/last receipt and change count', ...local}, coverage: coverage({...series, ...(kind === 'intraday' ? {session_date: 'archive-multiple-sessions'} : {})}), fetched_at: new Date().toISOString(), cache: {used: true, durable: true, storage_scope: storageScope}, warnings: ['LOCAL_ARCHIVED_OBSERVATIONS_NOT_LIVE', 'COVERAGE_IS_OBSERVED_NOT_COMPLETE; supply compatible missing observations to extend this local archive', 'SOURCES_AND_ADJUSTMENTS_NOT_MIXED']};
  } catch {
    throw Error('LOCAL_ARCHIVE_READ_FAILED');
  }
}

// This pure key function remains compatible with the old request argument shape.
export function snapshotKey(name, args = {}) {
  return JSON.stringify([name, args.symbol ?? null, args.interval ?? null, args.adjustment ?? 'none', args.include_incomplete ?? false, args.limit ?? null]);
}

export async function saveSnapshot(env, key, data) {
  if (!isTrustedLocalDatabase(env)) return unavailable('persisted');
  try {
    if (!data || typeof data !== 'object' || data.cache?.used) return {available: true, persisted: false, reason: 'NOT_NEW_LOCAL_SNAPSHOT', ...local};
    const fetched = data.fetched_at ?? new Date().toISOString();
    if (typeof key !== 'string' || !Number.isFinite(Date.parse(fetched))) return {available: true, persisted: false, reason: 'LOCAL_SNAPSHOT_ARGUMENTS_INVALID', ...local};
    const result = await env.DB.prepare('INSERT INTO market_snapshots (key,payload,fetched_at,source) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,source=excluded.source WHERE julianday(excluded.fetched_at) >= julianday(market_snapshots.fetched_at)').bind(key, JSON.stringify(data), fetched, data.source ?? 'unknown').run();
    if (!isTrustedLocalDatabase(env)) return unavailable('persisted');
    await env.DB.prepare('DELETE FROM market_snapshots WHERE julianday(fetched_at) < julianday(?)').bind(new Date(Date.now() - maxSnapshotAge * 1000).toISOString()).run();
    const changes = result?.meta?.changes ?? result?.changes;
    return {available: true, persisted: changes === 1, ...(changes === 0 ? {reason: 'EXISTING_NEWER_LOCAL_SNAPSHOT_PRESERVED'} : changes === 1 ? {} : {reason: 'WRITE_OUTCOME_UNCONFIRMED'}), scope: snapshotScope, ...local};
  } catch {
    return {available: false, persisted: false, reason: 'LOCAL_SNAPSHOT_WRITE_FAILED', ...local};
  }
}

export async function readSnapshot(env, key, now) {
  if (!isTrustedLocalDatabase(env)) return null;
  try {
    const time = now ?? Date.now();
    if (typeof key !== 'string' || !Number.isFinite(time)) return null;
    const row = await env.DB.prepare('SELECT payload,fetched_at FROM market_snapshots WHERE key=?').bind(key).first();
    if (!row) return null;
    const age = (time - Date.parse(row.fetched_at)) / 1000;
    if (!Number.isFinite(age) || age < 0 || age > maxSnapshotAge) return null;
    const data = JSON.parse(row.payload);
    return {...data, cache: {used: true, durable: true, age_seconds: Math.round(age), max_age_seconds: maxSnapshotAge, storage_scope: storageScope}, storage: {available: true, persisted: true, read_from_storage: true, ...local}, warnings: [...(Array.isArray(data.warnings) ? data.warnings : []), 'LOCAL_SNAPSHOT_FALLBACK_NOT_LIVE; original timestamps preserved']};
  } catch { return null; }
}

export async function storageHealth(env) {
  if (!isTrustedLocalDatabase(env)) return unavailable();
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count,MAX(fetched_at) AS latest FROM market_snapshots').first();
    return {available: true, snapshot_count: row.count, latest_saved_fetch: row.latest, scope: 'Explicit request-time windows in local Node SQLite; no automatic collection', ...local};
  } catch {
    return {available: false, reason: 'LOCAL_SNAPSHOT_READ_FAILED', ...local};
  }
}

export async function saveAuctionSnapshot(env, symbol, data, now) {
  if (!isTrustedLocalDatabase(env)) return unavailable('persisted');
  try {
    const time = now ?? Date.now();
    if (!validAuction(data, symbol, time) || data.cache?.used) return {available: true, persisted: false, reason: 'NOT_NEW_VALID_SAME_DAY_AUCTION', ...local};
    const result = await env.DB.prepare(`
      INSERT INTO market_snapshots (key,payload,fetched_at,source) VALUES (?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,source=excluded.source
      WHERE julianday(excluded.fetched_at) >= julianday(market_snapshots.fetched_at)
        AND json_array_length(excluded.payload,'$.points') >= json_array_length(market_snapshots.payload,'$.points')
        AND julianday(json_extract(excluded.payload,'$.source_timestamp')) >= julianday(json_extract(market_snapshots.payload,'$.source_timestamp'))
    `).bind(auctionKey(symbol, time), JSON.stringify(data), data.fetched_at, data.source).run();
    const changes = result?.meta?.changes ?? result?.changes;
    return {available: true, persisted: changes === 1, reason: changes === 0 ? 'EXISTING_NEWER_OR_FULLER_SNAPSHOT_PRESERVED' : changes === 1 ? 'SAVED' : 'WRITE_OUTCOME_UNCONFIRMED', scope: auctionScope, ...local};
  } catch {
    return {available: false, persisted: false, reason: 'LOCAL_AUCTION_SNAPSHOT_WRITE_FAILED', ...local};
  }
}

export async function readAuctionSnapshot(env, symbol, reason, now) {
  if (!isTrustedLocalDatabase(env)) return null;
  try {
    const time = now ?? Date.now();
    if (!chinaDay(time)) return null;
    const row = await env.DB.prepare('SELECT payload FROM market_snapshots WHERE key=?').bind(auctionKey(symbol, time)).first();
    if (!row) return null;
    const data = JSON.parse(row.payload);
    if (!validAuction(data, symbol, time)) return null;
    return {...data, served_at: new Date(time).toISOString(), auction_quality: auctionQuality(data.points, time), freshness: {...data.freshness, status: 'cached_snapshot', age_seconds: Math.max(0, Math.round((time - Date.parse(data.source_timestamp)) / 1000))}, cache: {used: true, durable: true, scope: 'same_china_calendar_day_only', reason: reasonText(reason), age_seconds: Math.round((time - Date.parse(data.fetched_at)) / 1000), same_session_date_only: true, storage_scope: storageScope}, storage: {available: true, persisted: true, read_from_storage: true, ...local}, warnings: [...(Array.isArray(data.warnings) ? data.warnings : []), 'LOCAL_AUCTION_SNAPSHOT_NOT_LIVE; original timestamps preserved']};
  } catch { return null; }
}

// The caller must explicitly invoke this operation with its request's source function.
// Extra legacy arguments are harmless and cannot enable/disable or redirect storage.
export async function auctionWithLocalStorage(env, symbol, fetchAuction, now) {
  if (!isTrustedLocalDatabase(env)) throw Error('LOCAL_AUCTION_STORAGE_UNAVAILABLE');
  if (typeof fetchAuction !== 'function' || (now !== undefined && typeof now !== 'function')) throw Error('LOCAL_AUCTION_REQUEST_REQUIRED');
  const clock = now ?? (() => Date.now());
  let data;
  try { data = await fetchAuction(symbol); }
  catch (error) {
    if (!isTrustedLocalDatabase(env)) throw Error('LOCAL_AUCTION_STORAGE_UNAVAILABLE');
    const message = sourceErrorText(error);
    const cached = await readAuctionSnapshot(env, symbol, message, clock());
    if (cached) return cached;
    throw Error('LOCAL_AUCTION_SOURCE_FAILED: ' + message);
  }
  if (!isTrustedLocalDatabase(env)) throw Error('LOCAL_AUCTION_STORAGE_UNAVAILABLE');
  const time = clock();
  if (!validAuction(data, symbol, time)) {
    const cached = await readAuctionSnapshot(env, symbol, 'NO_CURRENT_SESSION_AUCTION_OBSERVATIONS', time);
    return cached ?? data;
  }
  if (data.cache?.used) {
    const cached = await readAuctionSnapshot(env, symbol, data.cache.reason ?? 'SOURCE_UNAVAILABLE', time);
    return cached && cached.points.length >= data.points.length ? cached : data;
  }
  const storage = await saveAuctionSnapshot(env, symbol, data, time);
  if (storage.reason === 'EXISTING_NEWER_OR_FULLER_SNAPSHOT_PRESERVED') {
    const preserved = await readAuctionSnapshot(env, symbol, storage.reason, time);
    if (preserved) return preserved;
  }
  return {...data, storage};
}
