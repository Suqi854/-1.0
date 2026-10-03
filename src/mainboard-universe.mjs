// Pure classification of one get_stock_directory response. No fetch, credentials,
// database, timers, retries, numerical strategy changes, or persistent run state.
import {DIRECTORY_CONTRACT, DIRECTORY_ENDPOINT, DIRECTORY_LIMITS} from './stock-directory.mjs';
import {expectedSwingSession, SWING_DEFAULTS} from './swing-screening.mjs';

export const MAINBOARD_UNIVERSE_VERSION = 'mainboard-directory-v1';
export const MAINBOARD_UNIVERSE_REQUEST = Object.freeze({offset: 0, limit: DIRECTORY_LIMITS.max});
export const MAINBOARD_CLASSIFICATIONS = Object.freeze([
  'eligible_mainboard_non_st', 'excluded_st_name', 'excluded_other_boards', 'unclassified', 'unsupported'
]);
export const MAINBOARD_RUN_STATUSES = Object.freeze([
  'match', 'not_match', 'insufficient_data', 'failed_without_result', 'pending'
]);
export const MAINBOARD_CLASSIFICATION_RULES = Object.freeze({
  version: MAINBOARD_UNIVERSE_VERSION,
  sh_normal_a_prefixes: Object.freeze(['600', '601', '603', '605']),
  sz_normal_a_range: Object.freeze(['000001', '004999']),
  sz_cdr_excluded_range: Object.freeze(['001001', '001199']),
  original_sme_002_included: true,
  st_name_filter: 'NFKC display name, trim, case-insensitive leading ST or *ST',
  official_st_status: 'unknown',
  identity_support_priority: 'unsupported before board and name classification',
  membership_basis: 'validated provider a-share identity plus fixed code ranges; not exchange certification'
});
const SUPPORT = /^(sh(600|601|603|605|688|689)\d{3}|sz(000|001|002|003|004|300|301)\d{3}|bj[489]\d{5})$/;
const WARNINGS = Object.freeze([
  'ONE_BOUNDED_PROVIDER_DIRECTORY_RESPONSE_NOT_CERTIFIED_EXCHANGE_UNIVERSE',
  'SHORT_OR_EMPTY_DIRECTORY_IS_PROVIDER_END_EVIDENCE_ONLY',
  'FULL_10000_ROW_RESPONSE_MAY_HAVE_UNREAD_CONTINUATION',
  'DISPLAY_NAME_ST_FILTER_IS_NOT_OFFICIAL_ST_STATUS',
  'LISTING_DELISTING_SUSPENSION_AND_TRADABILITY_UNKNOWN',
  'DIRECTORY_SNAPSHOT_LOAD_TIME_IS_NOT_QUOTE_OR_MEMBERSHIP_EFFECTIVE_TIME',
  'CODE_CLASSIFICATION_DOES_NOT_PROVE_EXISTENCE_OR_SOURCE_HISTORY_AVAILABILITY',
  'FIXED_SWING_DAILY_V1_RULES_ARE_DESCRIPTIVE_NOT_VALIDATED_TRADING_EDGE'
]);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const compareSymbol = (a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
const stamp = value => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime());
const validISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const unknownStatus = () => ({listing: 'unknown', delisting: 'unknown', suspension: 'unknown', st: 'unknown', tradability: 'unknown'});
const fixedRules = () => ({version: 'swing-daily-v1', thresholds: {...SWING_DEFAULTS}, thresholds_are_unvalidated_hypotheses: true});

function validDate(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value);
}
function validatedIdentity(item) {
  if (!plain(item) || !['SH', 'SZ', 'BJ'].includes(item.market) || typeof item.ticker !== 'string' ||
      !/^\d{6}$/.test(item.ticker) || item.symbol !== item.market.toLowerCase() + item.ticker ||
      item.thscode !== item.ticker + '.' + item.market || item.asset_type !== 'a-share') {
    throw Error('MAINBOARD_DIRECTORY_IDENTITY_MISMATCH');
  }
  if (typeof item.market_data_supported !== 'boolean' || item.market_data_supported !== SUPPORT.test(item.symbol)) {
    throw Error('MAINBOARD_DIRECTORY_SUPPORT_MISMATCH');
  }
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || /[\u0000-\u001f\u007f]/.test(item.name)) {
    throw Error('MAINBOARD_DIRECTORY_INVALID_NAME');
  }
  for (const field of ['list_date', 'end_date', 'last_trade_date', 'last_delivery_date']) {
    if (!validDate(item[field])) throw Error('MAINBOARD_DIRECTORY_INVALID_DATE');
  }
  return item;
}

/** Classifies a validated source row; it never guesses or repairs an identity. */
export function classifyMainboardItem(value) {
  const item = validatedIdentity(value), normalizedName = item.name.normalize('NFKC').trim();
  const stName = /^\*?ST/i.test(normalizedName), sourceHint = item.name_hints?.st_prefix;
  const hintMatches = typeof sourceHint === 'boolean' ? sourceHint === stName : null;
  let classification, board = null, reason;
  // Unsupported identities stay visible and counted even if their name is ST.
  if (!item.market_data_supported) {
    classification = 'unsupported'; reason = 'MARKET_DATA_SYMBOL_SYNTAX_UNSUPPORTED';
  } else if (item.market === 'BJ') {
    classification = 'excluded_other_boards'; board = 'beijing'; reason = 'BEIJING_NOT_SH_SZ_MAINBOARD';
  } else if (item.market === 'SH' && /^68[89]/.test(item.ticker)) {
    classification = 'excluded_other_boards'; board = item.ticker.startsWith('689') ? 'star_cdr' : 'star'; reason = 'STAR_OR_STAR_CDR_NOT_MAINBOARD_NORMAL_A_SHARE';
  } else if (item.market === 'SZ' && /^30[01]/.test(item.ticker)) {
    classification = 'excluded_other_boards'; board = 'chinext'; reason = 'CHINEXT_NOT_MAINBOARD';
  } else if (item.market === 'SZ' && item.ticker >= '001001' && item.ticker <= '001199') {
    classification = 'excluded_other_boards'; board = 'sz_mainboard_cdr'; reason = 'SZ_MAINBOARD_CDR_NOT_NORMAL_A_SHARE';
  } else if ((item.market === 'SH' && /^(600|601|603|605)/.test(item.ticker)) ||
             (item.market === 'SZ' && item.ticker >= '000001' && item.ticker <= '004999')) {
    board = item.market === 'SH' ? 'sh_mainboard' : 'sz_mainboard';
    classification = stName ? 'excluded_st_name' : 'eligible_mainboard_non_st';
    reason = stName ? 'NFKC_DISPLAY_NAME_ST_PREFIX' : 'NORMAL_MAINBOARD_CODE_AND_NO_ST_NAME_PREFIX';
  } else {
    classification = 'unclassified'; reason = 'NO_FIXED_NORMAL_A_SHARE_BOARD_CLASSIFICATION';
  }
  return {
    symbol: item.symbol, ticker: item.ticker, thscode: item.thscode, market: item.market,
    name: item.name, asset_type: 'a-share', market_data_supported: item.market_data_supported,
    list_date: item.list_date, end_date: item.end_date, last_trade_date: item.last_trade_date,
    last_delivery_date: item.last_delivery_date, classification, board, reason_codes: [reason],
    status: unknownStatus(),
    name_hints: {st_prefix: stName, normalization: 'NFKC', source_st_prefix: typeof sourceHint === 'boolean' ? sourceHint : null,
      source_hint_matches: hintMatches, evidence: 'display_name_only_not_official_status'},
    warnings: hintMatches === false ? ['SOURCE_ST_NAME_HINT_DIFFERS_FROM_NFKC_FILTER'] : []
  };
}

function validateDirectory(directory, now) {
  if (!plain(directory) || directory.available !== true || directory.data_status !== 'ready' ||
      directory.source !== 'hithink' || directory.source_endpoint !== DIRECTORY_ENDPOINT || directory.contract !== DIRECTORY_CONTRACT ||
      directory.asset_type !== 'a-share' || directory.read_only !== true || directory.cloud_bridge_requests !== false ||
      !Array.isArray(directory.items) || directory.items.length > MAINBOARD_UNIVERSE_REQUEST.limit) {
    throw Error('MAINBOARD_DIRECTORY_INVALID_RESPONSE');
  }
  const request = directory.request, coverage = directory.coverage;
  if (!plain(request) || request.offset !== 0 || request.limit !== MAINBOARD_UNIVERSE_REQUEST.limit ||
      (request.expected_snapshot_timestamp !== null && request.expected_snapshot_timestamp !== undefined)) {
    throw Error('MAINBOARD_DIRECTORY_INCOMPLETE_REQUEST');
  }
  if (!stamp(directory.snapshot_timestamp) || directory.snapshot_timestamp > now + 5000 ||
      directory.source_timestamp !== new Date(directory.snapshot_timestamp).toISOString() ||
      directory.source_timestamp_semantics !== 'upstream_code_table_snapshot_load_time' || !validISO(directory.fetched_at)) {
    throw Error('MAINBOARD_DIRECTORY_INVALID_SNAPSHOT');
  }
  const length = directory.items.length, short = length < MAINBOARD_UNIVERSE_REQUEST.limit;
  if (!plain(coverage) || coverage.scope !== 'single_source_page' || coverage.retrieval_mode !== 'bounded_bulk' ||
      coverage.source_response_count !== 1 || coverage.requested_offset !== 0 || coverage.requested_limit !== MAINBOARD_UNIVERSE_REQUEST.limit ||
      coverage.returned_count !== length || coverage.source_page_end_observed !== short ||
      coverage.provider_directory_end_from_start_observed !== short || coverage.next_offset !== (short ? null : MAINBOARD_UNIVERSE_REQUEST.limit) ||
      coverage.total !== null || coverage.more_pages !== 'unknown' || coverage.complete_universe !== false ||
      coverage.exchange_directory_completeness !== 'unverified' || coverage.ordering_and_atomicity !== 'unverified') {
    throw Error('MAINBOARD_DIRECTORY_INVALID_COVERAGE');
  }
  const seen = new Set(), rows = [];
  for (const item of directory.items) {
    const row = classifyMainboardItem(item);
    if (seen.has(row.symbol)) throw Error('MAINBOARD_DIRECTORY_DUPLICATE_IDENTITY');
    seen.add(row.symbol);
    if ((item.snapshot_timestamp !== undefined && item.snapshot_timestamp !== directory.snapshot_timestamp) ||
        (item.source_timestamp !== undefined && item.source_timestamp !== directory.source_timestamp)) {
      throw Error('MAINBOARD_DIRECTORY_MIXED_SNAPSHOT');
    }
    rows.push(row);
  }
  const supported = rows.filter(row => row.market_data_supported).length;
  if (coverage.market_data_supported_count !== supported || coverage.market_data_unsupported_count !== length - supported) {
    throw Error('MAINBOARD_DIRECTORY_INVALID_COVERAGE');
  }
  return rows.sort(compareSymbol);
}

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) throw Error('MAINBOARD_MANIFEST_INVALID_VALUE');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => canonicalValue(item, seen)) :
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key], seen)]));
  seen.delete(value);
  return result;
}

/** Row order and object-key insertion order cannot alter the manifest hash. */
export function canonicalMainboardManifest(manifest) {
  if (!plain(manifest) || ![MAINBOARD_UNIVERSE_VERSION,PUBLIC_MAINBOARD_UNIVERSE_VERSION].includes(manifest.version) || !Array.isArray(manifest.items)) throw Error('MAINBOARD_MANIFEST_INVALID');
  const seen = new Set();
  for (const item of manifest.items) {
    if (!plain(item) || typeof item.symbol !== 'string' || seen.has(item.symbol)) throw Error('MAINBOARD_MANIFEST_INVALID');
    seen.add(item.symbol);
  }
  return JSON.stringify(canonicalValue({...manifest, items: [...manifest.items].sort(compareSymbol)}));
}

/** Returns null when SHA-256 WebCrypto is unavailable; no weak-hash fallback. */
export async function hashMainboardManifest(manifest, {cryptoImpl = globalThis.crypto} = {}) {
  const canonical = canonicalMainboardManifest(manifest);
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== 'function') return null;
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(digest);
  if (bytes.length !== 32) throw Error('MAINBOARD_MANIFEST_HASH_FAILED');
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

const errors = new Set([
  'MAINBOARD_DIRECTORY_INVALID_RESPONSE', 'MAINBOARD_DIRECTORY_INCOMPLETE_REQUEST', 'MAINBOARD_DIRECTORY_INVALID_SNAPSHOT',
  'MAINBOARD_DIRECTORY_INVALID_COVERAGE', 'MAINBOARD_DIRECTORY_IDENTITY_MISMATCH', 'MAINBOARD_DIRECTORY_SUPPORT_MISMATCH',
  'MAINBOARD_DIRECTORY_INVALID_NAME', 'MAINBOARD_DIRECTORY_INVALID_DATE', 'MAINBOARD_DIRECTORY_DUPLICATE_IDENTITY',
  'MAINBOARD_DIRECTORY_MIXED_SNAPSHOT', 'MAINBOARD_MANIFEST_HASH_FAILED', 'MAINBOARD_MANIFEST_HASH_UNAVAILABLE', 'MAINBOARD_INVALID_NOW'
]);
function unavailable(reason, now) {
  return {available: false, data_status: 'unavailable', reason_codes: [reason], read_only: true,
    scope: 'sh_sz_mainboard_excluding_st_names', universe_version: MAINBOARD_UNIVERSE_VERSION,
    request: {...MAINBOARD_UNIVERSE_REQUEST}, source: 'hithink', source_endpoint: DIRECTORY_ENDPOINT,
    snapshot_timestamp: null, source_timestamp: null, fetched_at: null, manifest_version: MAINBOARD_UNIVERSE_VERSION,
    manifest_hash: null, manifest_hash_algorithm: 'SHA-256', manifest: null, items: [], classifications: [], coverage: null,
    expected_session_date: Number.isSafeInteger(now) && Number.isFinite(new Date(now).getTime()) ? expectedSwingSession(now) : null,
    rules: fixedRules(), warnings: [...WARNINGS, 'NO_PARTIAL_UNIVERSE_OR_FABRICATED_EMPTY_SUCCESS']};
}

/**
 * Adapter entry point for get_mainboard_universe({}). Its owner makes exactly
 * one authorized directory read with MAINBOARD_UNIVERSE_REQUEST, then calls this.
 * A valid empty source response is distinct from unavailable/malformed input.
 */
export async function buildMainboardUniverse(directory, {now = Date.now(), cryptoImpl = globalThis.crypto} = {}) {
  try {
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw Error('MAINBOARD_INVALID_NOW');
    if (plain(directory) && directory.available === false) return unavailable('MAINBOARD_SOURCE_DIRECTORY_UNAVAILABLE', now);
    const rows = validateDirectory(directory, now), counts = Object.fromEntries(MAINBOARD_CLASSIFICATIONS.map(label => [label, 0]));
    for (const row of rows) counts[row.classification]++;
    const manifest = {
      version: MAINBOARD_UNIVERSE_VERSION, classification_rules: MAINBOARD_CLASSIFICATION_RULES,
      source: 'hithink', source_endpoint: DIRECTORY_ENDPOINT, source_contract: DIRECTORY_CONTRACT,
      snapshot_timestamp: directory.snapshot_timestamp, source_timestamp: directory.source_timestamp,
      source_timestamp_semantics: directory.source_timestamp_semantics, request: {...MAINBOARD_UNIVERSE_REQUEST},
      provider_rows: rows.length, partition: counts, complete_exchange_universe: false,
      provider_directory_end_from_start_observed: directory.coverage.provider_directory_end_from_start_observed,
      source_page_end_observed: directory.coverage.source_page_end_observed, items: rows
    };
    let manifestHash;
    try { manifestHash = await hashMainboardManifest(manifest, {cryptoImpl}); }
    catch { throw Error('MAINBOARD_MANIFEST_HASH_FAILED'); }
    if (manifestHash === null) throw Error('MAINBOARD_MANIFEST_HASH_UNAVAILABLE');
    const items = rows.filter(row => row.classification === 'eligible_mainboard_non_st');
    return {
      available: true, data_status: 'ready', read_only: true, request: {...MAINBOARD_UNIVERSE_REQUEST},
      scope: 'sh_sz_mainboard_excluding_st_names', universe_version: MAINBOARD_UNIVERSE_VERSION,
      source: 'hithink', source_endpoint: DIRECTORY_ENDPOINT, snapshot_timestamp: directory.snapshot_timestamp,
      source_timestamp: directory.source_timestamp, source_timestamp_semantics: directory.source_timestamp_semantics,
      fetched_at: directory.fetched_at, expected_session_date: expectedSwingSession(now), rules: fixedRules(),
      manifest_version: MAINBOARD_UNIVERSE_VERSION, manifest_hash: manifestHash, manifest_hash_algorithm: 'SHA-256', manifest,
      items, classifications: rows,
      coverage: {
        scope: 'single_bounded_provider_directory_response', provider_rows: rows.length, ...counts, partition_valid: true,
        source_response_count: 1, requested_offset: 0, requested_limit: MAINBOARD_UNIVERSE_REQUEST.limit,
        provider_directory_end_from_start_observed: directory.coverage.provider_directory_end_from_start_observed,
        source_page_end_observed: directory.coverage.source_page_end_observed, next_offset: directory.coverage.next_offset,
        more_pages: 'unknown', total: null, complete_universe: false, complete_exchange_universe: false, exchange_directory_completeness: 'unverified',
        ordering_and_atomicity: 'unverified', source_directory_response_classification_complete: true
      },
      warnings: [...WARNINGS, ...(rows.some(row => row.warnings.length) ? ['SOURCE_ST_NAME_HINT_DIFFERS_FROM_NFKC_FILTER'] : []),
        ...(counts.unsupported ? ['UNSUPPORTED_SOURCE_IDENTITIES_RETAINED_AND_COUNTED'] : []),
        ...(counts.unclassified ? ['UNCLASSIFIED_SOURCE_IDENTITIES_RETAINED_AND_COUNTED'] : [])]
    };
  } catch (error) {
    return unavailable(errors.has(error?.message) ? error.message : 'MAINBOARD_DIRECTORY_INVALID_RESPONSE', now);
  }
}

/** Checks the exact run-status identity, independent of numeric strategy rules. */
export function validateMainboardRunCoverage(coverage) {
  if (!plain(coverage) || !count(coverage.eligible_mainboard_non_st) || MAINBOARD_RUN_STATUSES.some(status => !count(coverage[status])) ||
      MAINBOARD_RUN_STATUSES.reduce((sum, status) => sum + coverage[status], 0) !== coverage.eligible_mainboard_non_st) {
    throw Error('MAINBOARD_RUN_INVALID_STATUS_PARTITION');
  }
  return true;
}

/**
 * Pure in-memory ledger. Pass existing swing result rows as-is. Represent a
 * failed whole request with {symbol, status:'failed_without_result'} for each
 * symbol that received no result. Omitted identities remain pending. Existing
 * insufficient_data results (including source failures) keep that status.
 */
export function buildMainboardRunLedger(universe, entries = []) {
  if (!plain(universe) || universe.available !== true || universe.manifest_version !== MAINBOARD_UNIVERSE_VERSION ||
      !/^[a-f0-9]{64}$/.test(universe.manifest_hash ?? '') || !Array.isArray(universe.items) ||
      universe.rules?.version !== 'swing-daily-v1' || !plain(universe.rules.thresholds) ||
      Object.keys(universe.rules.thresholds).length !== Object.keys(SWING_DEFAULTS).length ||
      Object.entries(SWING_DEFAULTS).some(([key, value]) => universe.rules.thresholds[key] !== value) ||
      !Array.isArray(entries)) throw Error('MAINBOARD_RUN_INVALID_UNIVERSE');
  const eligible = new Set();
  for (const row of universe.items) {
    if (!plain(row) || row.classification !== 'eligible_mainboard_non_st' || eligible.has(row.symbol) || typeof row.symbol !== 'string') {
      throw Error('MAINBOARD_RUN_INVALID_UNIVERSE');
    }
    eligible.add(row.symbol);
  }
  if (universe.coverage?.eligible_mainboard_non_st !== eligible.size) throw Error('MAINBOARD_RUN_INVALID_UNIVERSE');
  const received = new Map();
  for (const entry of entries) {
    if (!plain(entry) || !eligible.has(entry.symbol) || received.has(entry.symbol) || !MAINBOARD_RUN_STATUSES.includes(entry.status)) {
      throw Error('MAINBOARD_RUN_INVALID_RESULT_IDENTITY_OR_STATUS');
    }
    // Existing unavailableSwing source-failure rows have a null/unknown expected
    // date. They are real insufficient_data results, not mixed-cutoff evidence.
    if (entry.freshness?.expected_session_date !== undefined && entry.freshness.expected_session_date !== null &&
        entry.freshness.expected_session_date !== universe.expected_session_date) {
      throw Error('MAINBOARD_RUN_MIXED_EXPECTED_SESSION');
    }
    received.set(entry.symbol, entry.status);
  }
  const rows = universe.items.map(row => ({symbol: row.symbol, status: received.get(row.symbol) ?? 'pending'}));
  const coverage = {eligible_mainboard_non_st: eligible.size, ...Object.fromEntries(MAINBOARD_RUN_STATUSES.map(status => [status, 0]))};
  for (const row of rows) coverage[row.status]++;
  validateMainboardRunCoverage(coverage);
  return {manifest_version: universe.manifest_version, manifest_hash: universe.manifest_hash,
    snapshot_timestamp: universe.snapshot_timestamp, expected_session_date: universe.expected_session_date,
    rules_version: universe.rules.version, coverage: {...coverage, partition_valid: true},
    complete: coverage.pending === 0, complete_exchange_universe: false, entries: rows};
}

// The active public route uses this builder. The older provider builder above is
// retained only as a pure compatibility/audit function; it performs no I/O.
export const PUBLIC_MAINBOARD_UNIVERSE_VERSION='mainboard-public-directory-v1';
const publicWarnings=['PUBLIC_OFFICIAL_CURRENT_MAINBOARD_LISTS_ONLY','PUBLIC_SOURCES_NOT_ATOMIC_OR_HISTORICAL_MEMBERSHIP','DISPLAY_NAME_ST_FILTER_IS_NOT_OFFICIAL_ST_STATUS','SOURCE_EFFECTIVE_TIME_NOT_COMMON_OR_CERTIFIED','LEGACY_HITHINK_COUNTS_ARE_A_DIFFERENT_POOL_NOT_SUBSTITUTABLE','FIXED_PRODUCT_RULES_ONLY_NO_PRIVATE_STRATEGY_UPLOADED'];
export async function buildPublicMainboardUniverse(directory,{now=Date.now(),cryptoImpl=globalThis.crypto}={}){
 const base={read_only:true,scope:'sh_sz_mainboard_excluding_st_names',universe_version:PUBLIC_MAINBOARD_UNIVERSE_VERSION,manifest_version:PUBLIC_MAINBOARD_UNIVERSE_VERSION,manifest_hash_algorithm:'SHA-256',source:'sse_szse_public',source_endpoint:null,credential_required:false,credential_reads:false,cloud_bridge_requests:false,expected_session_date:expectedSwingSession(now),rules:fixedRules()};
 const fail=reason=>({...base,available:false,data_status:'public_source_unavailable',reason_codes:[reason],items:[],coverage:null,manifest_hash:null,snapshot_timestamp:null,source_timestamp:null,fetched_at:null,sources:[],diagnostics:directory?.diagnostics??null,cache:directory?.cache??null,served_at:directory?.served_at??null,warnings:[...publicWarnings,'NO_PARTIAL_PUBLIC_UNIVERSE_AND_NO_CREDENTIAL_FALLBACK']});
 try{
  if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))return fail('MAINBOARD_INVALID_NOW');
  if(directory?.available===false)return fail('PUBLIC_DIRECTORY_UNAVAILABLE');
  const d=directory,c=d?.coverage;
  if(!plain(d)||d.available!==true||d.data_status!=='ready'||d.source!=='sse_szse_public'||d.directory_version!=='sse-szse-public-v1'||d.asset_type!=='a-share'||d.read_only!==true||d.credential_required!==false||d.credential_reads!==false||d.cloud_bridge_requests!==false||!Array.isArray(d.items)||d.items.length<1||d.items.length>10000||!stamp(d.snapshot_timestamp)||d.snapshot_timestamp>now+5000||d.snapshot_timestamp_semantics!=='local_combined_directory_receipt_identifier_not_membership_effective_time'||d.source_timestamp!==null||d.source_timestamp_semantics!=='no_certified_common_source_effective_timestamp'||!validISO(d.fetched_at)||Date.parse(d.fetched_at)!==d.snapshot_timestamp||!Array.isArray(d.sources)||d.sources.length!==2||!plain(c)||c.scope!=='two_public_official_current_mainboard_lists'||c.source_response_count!==3||c.returned_count!==d.items.length||c.total!==d.items.length||c.complete_universe!==false||c.complete_exchange_universe!==false||c.source_counts_reconciled!==true||c.ordering_and_atomicity!=='not_atomic')return fail('MAINBOARD_PUBLIC_DIRECTORY_INVALID');
  const sse=d.sources.find(s=>s?.id==='sse_public_mainboard'),szse=d.sources.find(s=>s?.id==='szse_public_mainboard');
  if(!sse||!szse||sse.host!=='query.sse.com.cn'||szse.host!=='www.szse.cn'||!count(sse.rows)||!count(szse.rows)||!sse.rows||!szse.rows||sse.rows+szse.rows!==d.items.length||sse.total_reported!==sse.rows||szse.total_reported!==szse.rows||sse.source_effective_date!==null||!validDate(szse.source_effective_date)||szse.source_effective_date===null||!validISO(sse.fetched_at)||!validISO(szse.fetched_at)||!validISO(szse.metadata_fetched_at)||[sse.fetched_at,szse.fetched_at,szse.metadata_fetched_at].some(t=>Date.parse(t)>now+5000))return fail('MAINBOARD_PUBLIC_SOURCE_METADATA_INVALID');
  const seen=new Set(),rows=d.items.map(item=>{if(!['SH','SZ'].includes(item?.market)||item.official_board_label!=='mainboard'||item.source_id!==(item.market==='SH'?'sse_public_mainboard':'szse_public_mainboard'))throw Error('MAINBOARD_PUBLIC_IDENTITY_SCOPE_INVALID');const row={...classifyMainboardItem(item),official_board_label:'mainboard',source_id:item.source_id};if(seen.has(row.symbol))throw Error('MAINBOARD_DIRECTORY_DUPLICATE_IDENTITY');seen.add(row.symbol);return row;}).sort(compareSymbol);
  if(rows.filter(r=>r.market==='SH').length!==sse.rows||rows.filter(r=>r.market==='SZ').length!==szse.rows)return fail('MAINBOARD_PUBLIC_SOURCE_COUNTS_INVALID');
  const partition=Object.fromEntries(MAINBOARD_CLASSIFICATIONS.map(label=>[label,0]));for(const row of rows)partition[row.classification]++;
  const sourceBasis=d.sources.map(({fetched_at,metadata_fetched_at,...basis})=>basis).sort((a,b)=>a.id.localeCompare(b.id));
  const manifest={version:PUBLIC_MAINBOARD_UNIVERSE_VERSION,classification_rules:MAINBOARD_CLASSIFICATION_RULES,source:d.source,directory_version:d.directory_version,sources:sourceBasis,provider_rows:rows.length,partition,complete_exchange_universe:false,ordering_and_atomicity:'not_atomic',items:rows};
  const hash=await hashMainboardManifest(manifest,{cryptoImpl});if(!hash)return fail('MAINBOARD_MANIFEST_HASH_UNAVAILABLE');
  return {...base,available:true,data_status:'ready',directory_version:d.directory_version,manifest_hash:hash,manifest,items:rows.filter(r=>r.classification==='eligible_mainboard_non_st'),classifications:rows,snapshot_timestamp:d.snapshot_timestamp,snapshot_timestamp_semantics:d.snapshot_timestamp_semantics,source_timestamp:null,source_timestamp_semantics:d.source_timestamp_semantics,fetched_at:d.fetched_at,served_at:d.served_at??d.fetched_at,sources:structuredClone(d.sources),source_endpoints:d.source_endpoints,cache:d.cache??null,diagnostics:d.diagnostics??null,coverage:{scope:c.scope,provider_rows:rows.length,...partition,partition_valid:true,source_response_count:3,source_counts_reconciled:true,total:rows.length,total_semantics:c.total_semantics,complete_universe:false,complete_exchange_universe:false,exchange_directory_completeness:'current_source_counts_reconciled_not_historical_or_atomic_membership',ordering_and_atomicity:'not_atomic',source_directory_response_classification_complete:true,source_breakdown:d.sources.map(s=>({source_id:s.id,rows:s.rows,source_effective_date:s.source_effective_date,eligible_mainboard_non_st:rows.filter(r=>r.source_id===s.id&&r.classification==='eligible_mainboard_non_st').length,excluded_st_name:rows.filter(r=>r.source_id===s.id&&r.classification==='excluded_st_name').length}))},warnings:[...publicWarnings,...(d.warnings??[])]};
 }catch{return fail('MAINBOARD_PUBLIC_DIRECTORY_INVALID');}
}
