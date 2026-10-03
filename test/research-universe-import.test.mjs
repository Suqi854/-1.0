import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as importer from '../portable/research-universe.mjs';
import { hashOHLCVPool } from '../portable/ohlcv-updater.mjs';

const { importResearchUniverse } = importer;
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function seal(manifest) {
  const pool = manifest.items.map(({ symbol, name }) => ({ symbol, name })).sort((a, b) => a.symbol.localeCompare(b.symbol));
  manifest.pool_hash = sha(JSON.stringify(pool));
  const { research_universe_hash, ...content } = manifest;
  manifest.research_universe_hash = sha(canonical(content));
  return manifest;
}
// Five invented companies in three invented sectors. No real company identities,
// source facts, price/volume windows, financial values or private preferences.
function fixture() {
  const symbols = ['sh600901', 'sh601901', 'sh603901', 'sz000901', 'sz004901'];
  return seal({
    schema_version: 'public-research-universe-v1', version: 'synthetic-research-v1',
    evidence_revision: 'synthetic-evidence-v1', evidence_sha256: 'a'.repeat(64),
    admission_scope: 'approved_research_default_only',
    identity_basis: 'public_company_research_and_name_observation',
    official_directory_verified: false, directory_identity_hash: null,
    name_observation_session: '2026-09-30', point_in_time: false,
    pool_hash: '', research_universe_hash: '',
    items: symbols.map((symbol, index) => ({
      symbol, name: `合成公司${String.fromCharCode(0x7532 + index)}`,
      market: symbol.startsWith('sh') ? 'SH' : 'SZ',
      board: `${symbol.slice(0, 2)}_mainboard`,
      primary_sector: { id: `synthetic_sector_${index % 3}`, name: `合成行业${index % 3}` },
      theme_tags: ['合成描述'], admission_tier: 'synthetic_bounded_research',
      source_date: '2026-08-20', source_date_precision: 'day',
      primary_source_url: `https://research.example.com/synthetic-company-${index}.pdf`,
      name_observation: {
        as_of: '2026-09-30T16:00:00+08:00', provider: index % 2 ? 'sina' : 'tencent', st_prefix_observed: false,
      },
      official_status: { st: 'unknown', suspension: 'unknown', tradability: 'unknown' },
    })),
  });
}
async function rejects(change, expected) {
  const manifest = fixture(); change(manifest);
  const result = await importResearchUniverse(manifest);
  assert.equal(result.valid, false);
  assert.deepEqual(result.error_codes, [expected]);
  assert.equal(typeof result.path, 'string');
  assert.ok(result.path.length <= 256);
  return result;
}

test('only the pure research importer is exported; projection retains unknown official status', async () => {
  assert.deepEqual(Object.keys(importer), ['importResearchUniverse']);
  const manifest = fixture(), result = await importResearchUniverse(manifest);
  assert.equal(result.valid, true);
  assert.deepEqual(result.manifest, manifest);
  assert.equal(result.identity_header.schema_version, 'research-identity-v1');
  assert.equal(result.identity_header.basis, manifest.identity_basis);
  assert.equal(result.identity_header.research_universe_hash, manifest.research_universe_hash);
  assert.equal(result.identity_header.pool_hash, await hashOHLCVPool(result.updater_input.items));
  assert.notEqual(result.identity_header.research_universe_hash, result.identity_header.pool_hash);
  assert.equal(result.identity_header.directory_identity_hash, null);
  assert.equal(result.identity_header.official_directory_verified, false);
  assert.deepEqual(result.updater_input, {
    items: manifest.items.map(({ symbol, name }) => ({ symbol, name })), manifest_hash: manifest.research_universe_hash,
  });
  const directory = result.condition_directory;
  assert.equal(directory.status, 'ready');
  assert.equal(directory.universe, 'CN_MAINBOARD_NON_ST_LEADERS');
  assert.equal(directory.universeVersion, manifest.version);
  assert.equal(directory.source, 'public_company_research');
  assert.equal(directory.sourceNotes, 'Independent reviewed company research; dated name observation only; official status unknown');
  assert.equal(directory.asOf, manifest.name_observation_session);
  assert.deepEqual(directory.researchIdentity, result.identity_header);
  assert.deepEqual(directory.entries, manifest.items.map(item => ({
    symbol: item.symbol.toUpperCase(), exchange: item.market, board: 'mainboard', name: item.name,
    stStatus: 'unknown', nameObservation: {
      asOf: item.name_observation.as_of.slice(0, 10), observedAt: item.name_observation.as_of, provider: item.name_observation.provider, stPrefixObserved: false,
    },
  })));
  assert.equal(manifest.point_in_time, false);
  assert.ok(manifest.items.every(item => Object.values(item.official_status).every(value => value === 'unknown')));
});

test('four unavailable source dates stay null/unknown even when a URL contains a date', async () => {
  const manifest = fixture();
  for (const item of manifest.items.slice(0, 4)) {
    item.source_date = null; item.source_date_precision = 'unknown';
    item.primary_source_url = 'https://research.example.com/2026-08-20/synthetic.pdf';
  }
  manifest.items[4].source_date = '2026-08'; manifest.items[4].source_date_precision = 'month';
  seal(manifest);
  const result = await importResearchUniverse(JSON.stringify(manifest));
  assert.equal(result.valid, true);
  assert.equal(result.manifest.items.filter(item => item.source_date === null).length, 4);
  assert.ok(result.manifest.items.slice(0, 4).every(item => item.source_date_precision === 'unknown'));
  assert.equal(result.manifest.items[4].source_date, '2026-08');
  assert.equal(result.manifest.items[4].source_date_precision, 'month');
  for (const [date, precision] of [['2026-02-30', 'day'], ['2026-13', 'month'], ['2026-00', 'month'], [null, 'day'], ['2026-08', 'unknown'], [null, 'unavailable']]) {
    await rejects(m => { m.items[0].source_date = date; m.items[0].source_date_precision = precision; }, 'RESEARCH_SOURCE_DATE');
  }
});

test('sector and theme labels retain disclosed compatibility characters; only issuer names require NFKC', async () => {
  const manifest = fixture();
  for (const item of manifest.items.filter(item => item.primary_sector.id === 'synthetic_sector_0')) item.primary_sector.name = '合成分类Ⅲ';
  manifest.items[0].theme_tags = ['合成标签Ⅲ']; seal(manifest);
  const result = await importResearchUniverse(manifest);
  assert.equal(result.valid, true);
  assert.equal(result.manifest.items[0].primary_sector.name, '合成分类Ⅲ');
  assert.deepEqual(result.manifest.items[0].theme_tags, ['合成标签Ⅲ']);
  await rejects(m => { m.items[0].primary_sector.name = '＝合成公式'; }, 'RESEARCH_SECTOR_INVALID');
  await rejects(m => { m.items[0].theme_tags = ['＠合成公式']; }, 'RESEARCH_THEME_TAGS');
});

test('canonical research hash and sorted symbol/name pool hash use separate contracts', async () => {
  const manifest = fixture(); manifest.items.reverse(); seal(manifest);
  const reversed = await importResearchUniverse(manifest);
  assert.equal(reversed.valid, true);
  assert.equal(manifest.pool_hash, fixture().pool_hash);
  assert.notEqual(manifest.research_universe_hash, fixture().research_universe_hash);
  assert.equal(manifest.pool_hash, await hashOHLCVPool(manifest.items.map(({ symbol, name }) => ({ symbol, name }))));
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  assert.equal((await importResearchUniverse(JSON.stringify(reordered, null, 2))).valid, true);
  await rejects(m => { m.pool_hash = 'b'.repeat(64); }, 'RESEARCH_POOL_HASH_MISMATCH');
  await rejects(m => { m.research_universe_hash = 'b'.repeat(64); }, 'RESEARCH_CONTENT_HASH_MISMATCH');
  await rejects(m => { m.items[0].theme_tags = ['合成新描述']; }, 'RESEARCH_CONTENT_HASH_MISMATCH');
  await rejects(m => { m.items[0].name = '合成改名'; }, 'RESEARCH_POOL_HASH_MISMATCH');
  await rejects(m => { m.evidence_sha256 = 'z'.repeat(64); }, 'RESEARCH_HASH_FORMAT');
});

test('optional file hash verifies exact original UTF-8 JSON text, never a reserialized object', async () => {
  const manifest = fixture(), text = `${JSON.stringify(manifest, null, 2)}\n`;
  assert.equal((await importResearchUniverse(text, { expected_file_sha256: sha(text) })).valid, true);
  assert.equal((await importResearchUniverse(text, JSON.stringify({ expected_file_sha256: sha(text) }))).valid, true);
  assert.deepEqual((await importResearchUniverse(text, { expected_file_sha256: manifest.research_universe_hash })).error_codes, ['RESEARCH_FILE_HASH_MISMATCH']);
  assert.deepEqual((await importResearchUniverse(text, { expected_file_sha256: sha(JSON.stringify(manifest)) })).error_codes, ['RESEARCH_FILE_HASH_MISMATCH']);
  assert.deepEqual((await importResearchUniverse(manifest, { expected_file_sha256: sha(text) })).error_codes, ['RESEARCH_FILE_TEXT_REQUIRED']);
  assert.deepEqual((await importResearchUniverse(text, { expected_file_sha256: sha(text), owner: 'private' })).error_codes, ['RESEARCH_OPTIONS_INVALID']);
  assert.deepEqual((await importResearchUniverse(text, { expected_file_sha256: undefined })).error_codes, ['RESEARCH_JSON_REQUIRED']);
  assert.deepEqual((await importResearchUniverse(text, { expected_file_sha256: 'bad' })).error_codes, ['RESEARCH_OPTIONS_INVALID']);
});

test('private/extra fields are rejected at every allowed object boundary', async () => {
  await rejects(m => { m.position = 1; }, 'RESEARCH_TOP_FIELDS');
  await rejects(m => { m.items[0].watchlist = true; }, 'RESEARCH_ITEM_FIELDS');
  await rejects(m => { m.items[0].primary_sector.preference = 'private'; }, 'RESEARCH_SECTOR_INVALID');
  await rejects(m => { m.items[0].name_observation.price = 1; }, 'RESEARCH_NAME_OBSERVATION');
  await rejects(m => { m.items[0].official_status.condition = 'private'; }, 'RESEARCH_OFFICIAL_STATUS_UPGRADE');
  await rejects(m => { delete m.items[0].source_date; }, 'RESEARCH_ITEM_FIELDS');
});

test('duplicate JSON keys and escaped aliases cannot hide superseded private fields', async () => {
  const manifest = fixture(), text = JSON.stringify(manifest);
  const duplicateTop = `{"items":[{"position":1}],${text.slice(1)}`;
  assert.deepEqual((await importResearchUniverse(duplicateTop)).error_codes, ['RESEARCH_DUPLICATE_JSON_KEY']);
  const escapedTop = `{"\\u0069tems":[{"position":1}],${text.slice(1)}`;
  assert.deepEqual((await importResearchUniverse(escapedTop)).error_codes, ['RESEARCH_DUPLICATE_JSON_KEY']);
  const duplicateNested = text.replace('"st_prefix_observed":false', '"st_prefix_observed":true,"st_prefix_observed":false');
  assert.deepEqual((await importResearchUniverse(duplicateNested)).error_codes, ['RESEARCH_DUPLICATE_JSON_KEY']);
  const duplicateOptions = `{"expected_file_sha256":"bad","expected_file_sha256":"${sha(text)}"}`;
  assert.deepEqual((await importResearchUniverse(text, duplicateOptions)).error_codes, ['RESEARCH_DUPLICATE_JSON_KEY']);
  const braces = fixture(); braces.items[0].theme_tags = ['合成{标签}"标点']; seal(braces);
  assert.equal((await importResearchUniverse(JSON.stringify(braces))).valid, true);
});

test('ST observation requires typed false and dated supported provider, with no status upgrade', async () => {
  for (const value of [true, null, 'false', 0]) await rejects(m => { m.items[0].name_observation.st_prefix_observed = value; }, 'RESEARCH_NAME_OBSERVATION');
  await rejects(m => { delete m.items[0].name_observation.st_prefix_observed; }, 'RESEARCH_NAME_OBSERVATION');
  for (const value of ['unsupported', null, 'SINA']) await rejects(m => { m.items[0].name_observation.provider = value; }, 'RESEARCH_NAME_OBSERVATION');
  for (const value of ['2026-09-29T16:00:00+08:00', '2026-09-30T25:00:00+08:00', '2026-09-30T16:00:00Z', '2026-09-30']) {
    await rejects(m => { m.items[0].name_observation.as_of = value; }, 'RESEARCH_NAME_OBSERVATION');
  }
  for (const [field, value] of [['st', 'non_st'], ['suspension', 'active'], ['tradability', true]]) {
    await rejects(m => { m.items[0].official_status[field] = value; }, 'RESEARCH_OFFICIAL_STATUS_UPGRADE');
  }
  await rejects(m => { m.official_directory_verified = true; }, 'RESEARCH_DIRECTORY_OR_PIT_UPGRADE');
  await rejects(m => { m.directory_identity_hash = m.research_universe_hash; }, 'RESEARCH_DIRECTORY_OR_PIT_UPGRADE');
  await rejects(m => { m.point_in_time = true; }, 'RESEARCH_DIRECTORY_OR_PIT_UPGRADE');
});

test('normalized names reject ST, formula prefixes, control characters and fake normalization', async () => {
  for (const name of ['ST合成', '*ST合成', 'st合成']) await rejects(m => { m.items[0].name = name; }, 'RESEARCH_ST_NAME');
  for (const name of ['ＳＴ合成', ' 合成 ', '合成\u0000', '合成\u007f', '=HYPERLINK("https://example.com")', '+合成', '@合成', '-合成', '\ud800']) {
    await rejects(m => { m.items[0].name = name; }, 'RESEARCH_NAME_INVALID');
  }
  await rejects(m => { m.items[0].theme_tags = ['=SUM(A1)']; }, 'RESEARCH_THEME_TAGS');
  await rejects(m => { m.items[0].theme_tags = ['合成描述', '合成描述']; }, 'RESEARCH_THEME_TAGS');
});

test('source URLs reject formulas, scripts, credentials, local endpoints and escaped controls without loading them', async () => {
  // A local URL object constructs an explicitly fake negative case; no credential exists or is transmitted.
  const syntheticUserInfo = new URL('https://research.example.com/'); syntheticUserInfo.username = 'synthetic-user'; syntheticUserInfo.password = 'synthetic-not-a-secret';
  await rejects(m => { m.items[0].primary_source_url = syntheticUserInfo.href; }, 'RESEARCH_PUBLIC_URL');
  const previous = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('NETWORK_FORBIDDEN'); };
  try {
    assert.equal((await importResearchUniverse(fixture())).valid, true);
    for (const url of ['=HYPERLINK("https://example.com")', 'javascript:alert(1)', 'data:text/plain,synthetic',
      'http://research.example.com/', 'https://research.example.com/\n',
      'https://research.example.com/%0a', 'https://research.example.com/%250a', 'https://research.example.com/%ZZ',
      'https://research.example.com\\path', 'https://localhost/', 'https://private.local/', 'https://127.0.0.1/',
      'https://192.168.1.1/', 'https://[::1]/', 'https://research.example.com:8080/']) {
      await rejects(m => { m.items[0].primary_source_url = url; }, 'RESEARCH_PUBLIC_URL');
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = previous; }
});

test('public references reject private credential query names/values including double encoding', async () => {
  for (const query of ['token=synthetic', 'api_key=synthetic', 'secret=synthetic', 'password=synthetic',
    'Authorization=synthetic', 'email=synthetic', 'owner=synthetic', '%2574oken=synthetic',
    'ref=%2570assword%253Dsynthetic', 'ref=synthetic%2540private.example', 'X-Amz-Signature=synthetic']) {
    await rejects(m => { m.items[0].primary_source_url = `https://research.example.com/disclosure?${query}`; }, 'RESEARCH_PUBLIC_URL');
  }
  const manifest = fixture();
  manifest.items[0].primary_source_url = 'https://research.example.com/disclosure?orgId=synthetic-issuer&announcementId=synthetic-disclosure&stockCode=synthetic-code';
  seal(manifest); assert.equal((await importResearchUniverse(manifest)).valid, true);
});

test('mainboard bounds and market/board letter case reject conflicting identities', async () => {
  for (const symbol of ['SH600901', 'sz000000', 'sz001001', 'sz001199', 'sz005000', 'sh688901', 'sz300901', 'bj830901']) {
    await rejects(m => { m.items[0].symbol = symbol; }, 'RESEARCH_MAINBOARD_SYMBOL');
  }
  for (const [market, board] of [['sh', 'sh_mainboard'], ['SZ', 'sh_mainboard'], ['SH', 'SH_MAINBOARD'], ['SH', 'sz_mainboard']]) {
    await rejects(m => { m.items[0].market = market; m.items[0].board = board; }, 'RESEARCH_MARKET_BOARD_MISMATCH');
  }
  for (const symbol of ['sz000001', 'sz001000', 'sz001200', 'sz004999', 'sh605999']) {
    const manifest = fixture(); manifest.items[0].symbol = symbol;
    manifest.items[0].market = symbol.slice(0, 2).toUpperCase(); manifest.items[0].board = `${symbol.slice(0, 2)}_mainboard`;
    seal(manifest); assert.equal((await importResearchUniverse(manifest)).valid, true);
  }
  await rejects(m => { m.items[1].symbol = m.items[0].symbol; }, 'RESEARCH_DUPLICATE_SYMBOL');
});

test('sector identity is consistent and capped at five; malformed sixth member is rejected', async () => {
  const manifest = fixture(); for (const item of manifest.items) item.primary_sector = clone(manifest.items[0].primary_sector);
  seal(manifest); assert.equal((await importResearchUniverse(manifest)).valid, true);
  const sixth = clone(manifest.items[0]); sixth.symbol = 'sh605901'; sixth.name = '合成越界公司'; manifest.items.push(sixth);
  assert.deepEqual((await importResearchUniverse(manifest)).error_codes, ['RESEARCH_SECTOR_LIMIT']);
  await rejects(m => { m.items[3].primary_sector.name = '同ID异名'; }, 'RESEARCH_SECTOR_IDENTITY_CONFLICT');
  await rejects(m => { m.items[1].primary_sector.name = m.items[0].primary_sector.name; }, 'RESEARCH_SECTOR_IDENTITY_CONFLICT');
});

test('getters, Proxy traps, coercion hooks, inherited fields and non-JSON values never execute', async () => {
  let sideEffects = 0;
  const accessor = fixture(); Object.defineProperty(accessor, 'items', { enumerable: true, get() { sideEffects++; throw Error('GETTER_RAN'); } });
  const toJSON = fixture(); toJSON.toJSON = () => { sideEffects++; throw Error('TO_JSON_RAN'); };
  const nestedProxy = fixture(); nestedProxy.items[0] = new Proxy(nestedProxy.items[0], {
    get() { sideEffects++; throw Error('PROXY_RAN'); }, ownKeys() { sideEffects++; throw Error('PROXY_RAN'); },
    getPrototypeOf() { sideEffects++; throw Error('PROXY_RAN'); },
  });
  const proxy = new Proxy(fixture(), { get() { sideEffects++; throw Error('PROXY_RAN'); }, ownKeys() { sideEffects++; throw Error('PROXY_RAN'); }, getPrototypeOf() { sideEffects++; throw Error('PROXY_RAN'); } });
  const inherited = Object.assign(Object.create({ position: 1 }), fixture());
  const cyclic = fixture(); cyclic.items[0].cycle = cyclic;
  const hidden = fixture(); Object.defineProperty(hidden, 'private', { value: 1 });
  const notFinite = fixture(); notFinite.items[0].source_date = NaN;
  for (const input of [accessor, toJSON, nestedProxy, proxy, inherited, cyclic, hidden, notFinite, undefined, () => {}, '{broken']) {
    assert.deepEqual((await importResearchUniverse(input)).error_codes, ['RESEARCH_JSON_REQUIRED']);
  }
  const opts = {}; Object.defineProperty(opts, 'expected_file_sha256', { enumerable: true, get() { sideEffects++; throw Error('OPTIONS_GETTER_RAN'); } });
  assert.deepEqual((await importResearchUniverse(JSON.stringify(fixture()), opts)).error_codes, ['RESEARCH_JSON_REQUIRED']);
  const optionProxy = new Proxy({}, { ownKeys() { sideEffects++; throw Error('OPTIONS_PROXY_RAN'); }, get() { sideEffects++; throw Error('OPTIONS_PROXY_RAN'); } });
  assert.deepEqual((await importResearchUniverse(JSON.stringify(fixture()), optionProxy)).error_codes, ['RESEARCH_JSON_REQUIRED']);
  assert.equal(sideEffects, 0);
});

test('bounded inputs reject excess text, empty/oversized arrays and unusable labels', async () => {
  assert.deepEqual((await importResearchUniverse(' '.repeat(8 * 1024 * 1024 + 1))).error_codes, ['RESEARCH_INPUT_BOUNDS']);
  await rejects(m => { m.items = []; }, 'RESEARCH_ITEM_BOUNDS');
  await rejects(m => { m.items = Array(10001).fill(m.items[0]); }, 'RESEARCH_ITEM_BOUNDS');
  await rejects(m => { m.version = '=private'; }, 'RESEARCH_REVISION_INVALID');
  await rejects(m => { m.name_observation_session = '2026-02-30'; }, 'RESEARCH_OBSERVATION_SESSION');
  await rejects(m => { m.items[0].admission_tier = 'a'.repeat(161); }, 'RESEARCH_ADMISSION_TIER');
});

test('outputs and async import snapshot have no input or cross-output aliasing', async () => {
  const input = fixture(), original = clone(input), pending = importResearchUniverse(input);
  input.items[0].name = '输入后来改名'; input.items[0].name_observation.provider = 'unsupported';
  const result = await pending; assert.equal(result.valid, true); assert.deepEqual(result.manifest, original);
  result.manifest.items[0].name = '只改返回manifest'; result.manifest.items[0].name_observation.as_of = 'changed';
  result.manifest.items[0].primary_sector.name = 'changed'; result.manifest.items[0].theme_tags.push('changed');
  result.identity_header.version = 'changed';
  assert.equal(result.updater_input.items[0].name, original.items[0].name);
  assert.equal(result.condition_directory.entries[0].name, original.items[0].name);
  assert.equal(result.condition_directory.entries[0].nameObservation.asOf, original.items[0].name_observation.as_of.slice(0,10));
  assert.equal(result.condition_directory.entries[0].nameObservation.observedAt, original.items[0].name_observation.as_of);
  assert.equal(result.condition_directory.researchIdentity.version, original.version);
  result.updater_input.items[0].symbol = 'changed'; result.condition_directory.entries[0].name = 'changed';
  assert.equal(result.manifest.items[0].symbol, original.items[0].symbol);
  assert.equal(input.items[0].name, '输入后来改名');
  const next = await importResearchUniverse(fixture()); assert.equal(next.valid, true); assert.deepEqual(next.manifest, original);
});
