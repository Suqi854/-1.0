/**
 * Pure research-only import. This module never reads files, follows source URLs,
 * loads prices, prepares/advances an updater, or certifies trading eligibility.
 *
 * importResearchUniverse(input, { expected_file_sha256 } = {}) accepts bounded
 * JSON text or, in Node, plain JSON objects. Both arguments pass through the
 * existing getter/Proxy-safe JSON boundary. Browser callers use JSON text.
 * Duplicate text keys are rejected, including escaped aliases, so JSON.parse
 * cannot hide a private/extra field inside a superseded object value.
 * The optional file digest applies only to the exact UTF-8 input text, including
 * its whitespace; supplying it with an object is rejected. No source URL is read.
 *
 * Failure is always {valid:false,error_codes:[one finite code],path}. Paths are
 * bounded and never contain input values. Codes are the literal codes below;
 * arbitrary exception messages, credentials, and caller hooks are never used.
 * Success returns detached copies: mutating any output cannot change the input
 * or another output. Research/content, selected-pool, evidence, and file hashes
 * have separate meanings. None is an official directory identity.
 */
import { readJSONInput } from '../modules/condition-screen/src/json-input.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 10_000;
const TOP = ['schema_version', 'version', 'evidence_revision', 'evidence_sha256',
  'admission_scope', 'identity_basis', 'official_directory_verified',
  'directory_identity_hash', 'name_observation_session', 'point_in_time',
  'pool_hash', 'items', 'research_universe_hash'];
const ITEM = ['symbol', 'name', 'market', 'board', 'primary_sector', 'theme_tags',
  'admission_tier', 'source_date', 'source_date_precision', 'primary_source_url',
  'name_observation', 'official_status'];
const BASIS = 'public_company_research_and_name_observation';
const HASH = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const PRIVATE_URL_WORD = /token|apikey|secret|password|passwd|authorization|credential|signature|email|owner|accesskey/;
const error = (code, path = '$') => ({ valid: false, error_codes: [code], path: path.slice(0, 256) });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, expected, optional = false) => object(value)
  && Object.keys(value).every(key => expected.includes(key))
  && (optional || expected.every(key => Object.hasOwn(value, key)));
const label = (value, max = 80) => typeof value === 'string'
  && new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${max - 1}}$`).test(value);
const text = (value, max = 80, normalized = false) => typeof value === 'string' && value.length > 0
  && value.length <= max && value === value.trim()
  && (!normalized || value === value.normalize('NFKC'))
  && !CONTROL.test(value) && !LONE_SURROGATE.test(value) && !/^[=+@-]/.test(value.normalize('NFKC'));
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
function publicSymbol(value) {
  return typeof value === 'string'
    && /^(?:sh(?:600|601|603|605)\d{3}|sz(?:000|001|002|003|004)\d{3})$/.test(value)
    && value !== 'sz000000'
    && !(value.startsWith('sz') && Number(value.slice(2)) >= 1001 && Number(value.slice(2)) <= 1199);
}
function publicURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://')
    || /\s|\\/u.test(value) || CONTROL.test(value) || LONE_SURROGATE.test(value)) return false;
  try {
    const url = new URL(value), hostname = url.hostname.toLowerCase();
    // Public DNS references only. Reject credentials, IP/local references,
    // nonstandard ports, malformed percent escapes and encoded control bytes.
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
      || /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(hostname)) return false;
    const privatePart = part => PRIVATE_URL_WORD.test(part.normalize('NFKC').toLowerCase().replace(/[\s_.-]/g, ''))
      || /^["']?(?:auth|key|sig)["']?$/i.test(part) || part.includes('@') || /(?:^|\s)bearer\s+\S/i.test(part);
    let decoded = value;
    for (let pass = 0; pass < 4; pass++) {
      // Includes nested/encoded query names and values. Public disclosure keys
      // such as orgId, announcementId and stockCode remain allowed.
      const decodedURL = new URL(decoded);
      for (const [key, item] of decodedURL.searchParams) if (privatePart(key) || privatePart(item)) return false;
      if (decodedURL.hash.includes('=')) {
        for (const [key, item] of new URLSearchParams(decodedURL.hash.slice(1))) if (privatePart(key) || privatePart(item)) return false;
      }
      const next = decodeURIComponent(decoded);
      if (CONTROL.test(next) || LONE_SURROGATE.test(next)) return false;
      if (next === decoded) return true;
      decoded = next;
    }
    // Reject deeper encoding rather than leave an uninspected hidden query.
    return false;
  } catch { return false; }
}
function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!object(value)) return value;
  const out = Object.create(null);
  for (const key of Object.keys(value).sort()) out[key] = sortedObject(value[key]);
  return out;
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const clone = value => JSON.parse(JSON.stringify(value));

// Input is already syntactically valid JSON. Scan only its structural tokens;
// JSON.parse on isolated quoted keys safely resolves escaped key aliases.
function uniqueTextKeys(input) {
  const stack = [];
  for (let offset = 0; offset < input.length; offset++) {
    const token = input[offset];
    if (token === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (stack.at(-1)) stack.at(-1).expectingKey = true; }
    else if (token === '"') {
      const start = offset++;
      while (input[offset] !== '"') { if (input[offset] === '\\') offset++; offset++; }
      const frame = stack.at(-1);
      if (frame?.expectingKey) {
        const key = JSON.parse(input.slice(start, offset + 1));
        if (frame.keys.has(key)) return false;
        frame.keys.add(key); frame.expectingKey = false;
      }
    }
  }
  return true;
}

export async function importResearchUniverse(input, options) {
  if (typeof input === 'string' && input.length > MAX_BYTES) return error('RESEARCH_INPUT_BOUNDS');
  if (typeof options === 'string' && options.length > 1024) return error('RESEARCH_OPTIONS_INVALID', '$options');
  const parsedOptions = options === undefined
    ? { valid: true, value: Object.create(null) } : readJSONInput(options);
  if (!parsedOptions.valid) return error('RESEARCH_JSON_REQUIRED', '$options');
  if (typeof options === 'string' && !uniqueTextKeys(options)) return error('RESEARCH_DUPLICATE_JSON_KEY', '$options');
  const opts = parsedOptions.value;
  if (!fields(opts, ['expected_file_sha256'], true)
    || Object.hasOwn(opts, 'expected_file_sha256') && (typeof opts.expected_file_sha256 !== 'string' || !HASH.test(opts.expected_file_sha256))) {
    return error('RESEARCH_OPTIONS_INVALID', '$options');
  }
  if (Object.hasOwn(opts, 'expected_file_sha256') && typeof input !== 'string') return error('RESEARCH_FILE_TEXT_REQUIRED');
  const parsed = readJSONInput(input);
  if (!parsed.valid) return error(parsed.error.code === 'JSON_INPUT_BOUNDS' ? 'RESEARCH_INPUT_BOUNDS' : 'RESEARCH_JSON_REQUIRED');
  if (typeof input === 'string' && !uniqueTextKeys(input)) return error('RESEARCH_DUPLICATE_JSON_KEY');
  const manifest = parsed.value;
  if (!fields(manifest, TOP)) return error('RESEARCH_TOP_FIELDS');
  if (manifest.schema_version !== 'public-research-universe-v1'
    || manifest.admission_scope !== 'approved_research_default_only' || manifest.identity_basis !== BASIS) return error('RESEARCH_SCHEMA_OR_SCOPE');
  if (manifest.official_directory_verified !== false || manifest.directory_identity_hash !== null || manifest.point_in_time !== false) return error('RESEARCH_DIRECTORY_OR_PIT_UPGRADE');
  if (!label(manifest.version) || !label(manifest.evidence_revision)) return error('RESEARCH_REVISION_INVALID');
  if (['evidence_sha256', 'pool_hash', 'research_universe_hash'].some(key => typeof manifest[key] !== 'string' || !HASH.test(manifest[key]))) return error('RESEARCH_HASH_FORMAT');
  if (!day(manifest.name_observation_session)) return error('RESEARCH_OBSERVATION_SESSION');
  if (!Array.isArray(manifest.items) || !manifest.items.length || manifest.items.length > MAX_ITEMS) return error('RESEARCH_ITEM_BOUNDS');

  const symbols = new Set(), sectors = new Map(), sectorNames = new Map(), sectorIds = new Map();
  for (let index = 0; index < manifest.items.length; index++) {
    const item = manifest.items[index], path = `$.items[${index}]`;
    if (!fields(item, ITEM)) return error('RESEARCH_ITEM_FIELDS', path);
    if (!publicSymbol(item.symbol)) return error('RESEARCH_MAINBOARD_SYMBOL', path);
    if (!['SH', 'SZ'].includes(item.market) || item.symbol.slice(0, 2) !== item.market.toLowerCase()
      || item.board !== `${item.market.toLowerCase()}_mainboard`) return error('RESEARCH_MARKET_BOARD_MISMATCH', path);
    if (symbols.has(item.symbol)) return error('RESEARCH_DUPLICATE_SYMBOL', path);
    symbols.add(item.symbol);
    if (!text(item.name, 80, true)) return error('RESEARCH_NAME_INVALID', path);
    if (/^(?:\*?ST)/i.test(item.name)) return error('RESEARCH_ST_NAME', path);
    if (!fields(item.primary_sector, ['id', 'name']) || !label(item.primary_sector.id)
      || !text(item.primary_sector.name)) return error('RESEARCH_SECTOR_INVALID', path);
    const sector = item.primary_sector;
    if (sectorNames.has(sector.id) && sectorNames.get(sector.id) !== sector.name
      || sectorIds.has(sector.name) && sectorIds.get(sector.name) !== sector.id) return error('RESEARCH_SECTOR_IDENTITY_CONFLICT', path);
    sectorNames.set(sector.id, sector.name); sectorIds.set(sector.name, sector.id);
    sectors.set(sector.id, (sectors.get(sector.id) ?? 0) + 1);
    if (sectors.get(sector.id) > 5) return error('RESEARCH_SECTOR_LIMIT', path);
    if (!Array.isArray(item.theme_tags) || item.theme_tags.length > 32
      || item.theme_tags.some(tag => !text(tag))
      || item.theme_tags.some((tag, i) => i > 0 && item.theme_tags[i - 1] >= tag)) return error('RESEARCH_THEME_TAGS', path);
    if (!label(item.admission_tier, 160)) return error('RESEARCH_ADMISSION_TIER', path);
    const precision = item.source_date_precision, sourceDate = item.source_date;
    if (!(precision === 'unknown' && sourceDate === null
      || precision === 'day' && day(sourceDate)
      || precision === 'month' && typeof sourceDate === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(sourceDate))) return error('RESEARCH_SOURCE_DATE', path);
    if (!publicURL(item.primary_source_url)) return error('RESEARCH_PUBLIC_URL', path);
    const observation = item.name_observation;
    if (!fields(observation, ['as_of', 'provider', 'st_prefix_observed'])
      || observation.st_prefix_observed !== false || !['sina', 'tencent'].includes(observation.provider)
      || typeof observation.as_of !== 'string'
      || !new RegExp(`^${manifest.name_observation_session}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\+08:00$`).test(observation.as_of)) return error('RESEARCH_NAME_OBSERVATION', path);
    if (!fields(item.official_status, ['st', 'suspension', 'tradability'])
      || Object.values(item.official_status).some(value => value !== 'unknown')) return error('RESEARCH_OFFICIAL_STATUS_UPGRADE', path);
  }
  const serialized = JSON.stringify(manifest);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES
    || typeof input === 'string' && (LONE_SURROGATE.test(input) || new TextEncoder().encode(input).byteLength > MAX_BYTES)) return error('RESEARCH_INPUT_BOUNDS');
  try {
    if (Object.hasOwn(opts, 'expected_file_sha256') && await sha256(input) !== opts.expected_file_sha256) return error('RESEARCH_FILE_HASH_MISMATCH');
    // Matches hashOHLCVPool: sorted identities, key order symbol then name.
    const pool = manifest.items.map(({ symbol, name }) => ({ symbol, name })).sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (await sha256(JSON.stringify(pool)) !== manifest.pool_hash) return error('RESEARCH_POOL_HASH_MISMATCH');
    const content = Object.create(null);
    for (const key of TOP) if (key !== 'research_universe_hash') content[key] = manifest[key];
    if (await sha256(JSON.stringify(sortedObject(content))) !== manifest.research_universe_hash) return error('RESEARCH_CONTENT_HASH_MISMATCH');
  } catch { return error('RESEARCH_HASH_UNAVAILABLE'); }

  const identity = {
    schema_version: 'research-identity-v1', basis: BASIS,
    research_universe_hash: manifest.research_universe_hash, pool_hash: manifest.pool_hash,
    version: manifest.version, evidence_revision: manifest.evidence_revision,
    evidence_sha256: manifest.evidence_sha256, name_observation_session: manifest.name_observation_session,
    official_directory_verified: false, directory_identity_hash: null,
  };
  return {
    valid: true, manifest: clone(manifest), identity_header: clone(identity),
    updater_input: {
      items: manifest.items.map(({ symbol, name }) => ({ symbol, name })),
      manifest_hash: manifest.research_universe_hash,
    },
    condition_directory: {
      status: 'ready', universe: 'CN_MAINBOARD_NON_ST_LEADERS', universeVersion: manifest.version,
      source: 'public_company_research',
      sourceNotes: 'Independent reviewed company research; dated name observation only; official status unknown',
      asOf: manifest.name_observation_session,
      entries: manifest.items.map(item => ({
        symbol: item.symbol.toUpperCase(), exchange: item.market, board: 'mainboard', name: item.name,
        stStatus: 'unknown', nameObservation: {
          asOf: item.name_observation.as_of.slice(0, 10), observedAt: item.name_observation.as_of, provider: item.name_observation.provider, stPrefixObserved: false,
        },
      })),
      researchIdentity: clone(identity),
    },
  };
}
