/** No I/O, no storage, no eval. Trusted local adapters supply frozen snapshots. */
import { readJSONInput } from './json-input.js';
import { validGeneration, supportedCalendar, supportedPolicy, validReceipt } from './provenance.js';
import { validateDatasetQuality } from './quality.js';
export const LIMITS = Object.freeze({ maxDepth: 6, maxNodes: 100, maxWindow: 250, maxOffset: 250, maxSymbols: 6000, maxBarsPerFrame: 2000, maxEvaluations: 100000 });
export const AVAILABLE = Object.freeze(['open', 'high', 'low', 'close', 'volume_shares', 'ma', 'volume_ma', 'change_pct', 'prior_high', 'volume_ratio']);
export const DISABLED = Object.freeze({ amount_cny: '历史成交额缺失', turnover: '缺同日期可流通股本', market_cap: '缺同日期股本与口径', financials: '缺可追溯财报数据', capital_flow: '缺同口径资金流数据' });
const FRAMES = ['D', 'W', 'M'];
const FIELDS = ['open', 'high', 'low', 'close', 'volume_shares'];
const OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'cross_above', 'cross_below'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS = { open: 'CNY', high: 'CNY', low: 'CNY', close: 'CNY', volume_shares: 'shares' };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const textValue = x => typeof x === 'string' ? x : undefined;
const integer = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const date = s => { if (typeof s !== 'string' || !DATE.test(s)) return false; const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; };
function issue(code, message, details = {}) { return { code, message, ...details }; }
function keys(o, permitted, path, errors) {
  for (const k of Object.keys(o)) if (!permitted.includes(k)) errors.push(issue('UNSUPPORTED_PROPERTY', `${path}.${k} 不支持`, { path }));
}
function unit(e) {
  if (e.kind === 'constant') return 'constant';
  if (e.kind === 'change_pct') return 'percent';
  if (e.kind === 'volume_ratio') return 'ratio';
  if (e.kind === 'volume_ma') return 'shares';
  if (e.kind === 'prior_high') return 'CNY';
  return typeof e.field === 'string' && own(UNITS, e.field) ? UNITS[e.field] : undefined;
}
export function validateRule(rule) {
  const input = readJSONInput(rule);
  return input.valid ? validateRuleData(input.value) : { valid: false, errors: [input.error] };
}
function validateRuleData(rule) {
  const errors = []; const ids = new Set(); let nodes = 0;
  if (!object(rule)) return { valid: false, errors: [issue('INVALID_RULE', '规则必须为对象')] };
  keys(rule, ['version', 'root'], 'rule', errors);
  if (rule.version !== 1) errors.push(issue('RULE_VERSION', '规则版本必须为1'));
  function expr(e, path) {
    if (!object(e)) { errors.push(issue('INVALID_OPERAND', `${path} 必须为声明式操作数`)); return; }
    const allowed = { constant: ['kind', 'value'], field: ['kind', 'field', 'offset'], ma: ['kind', 'field', 'window', 'offset'], volume_ma: ['kind', 'window', 'offset'], change_pct: ['kind', 'window', 'offset'], prior_high: ['kind', 'window', 'offset'], volume_ratio: ['kind', 'window', 'offset'] };
    if (typeof e.kind !== 'string' || !own(allowed, e.kind)) { errors.push(issue('DISABLED_OR_UNKNOWN_INDICATOR', `${path}: 指标类型不可用`)); return; }
    keys(e, allowed[e.kind], path, errors);
    if (e.kind === 'constant') {
      if (!finite(e.value) || Math.abs(e.value) > 1e15) errors.push(issue('INVALID_THRESHOLD', `${path}: 阈值必须是有限数字且绝对值≤1e15`));
      return;
    }
    if (own(e, 'offset') && !integer(e.offset, 0, LIMITS.maxOffset)) errors.push(issue('INVALID_OFFSET', `${path}: 偏移必须为0..${LIMITS.maxOffset}`));
    if (['field', 'ma'].includes(e.kind) && !FIELDS.includes(e.field)) errors.push(issue('DISABLED_OR_UNKNOWN_FIELD', `${path}: 字段不可用`));
    if (e.kind === 'ma' && e.field === 'volume_shares') errors.push(issue('USE_VOLUME_MA', '成交量均线使用 volume_ma'));
    if (!['constant', 'field'].includes(e.kind) && !integer(e.window, 1, LIMITS.maxWindow)) errors.push(issue('INVALID_WINDOW', `${path}: 窗口必须为1..${LIMITS.maxWindow}`));
  }
  function visit(n, depth, path) {
    nodes++;
    if (nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) { errors.push(issue('RULE_BOUNDS', '规则节点或嵌套深度超过上限')); return; }
    if (!object(n)) { errors.push(issue('INVALID_NODE', `${path} 必须为对象`)); return; }
    if (n.type === 'group') {
      keys(n, ['type', 'op', 'children'], path, errors);
      if (!['AND', 'OR'].includes(n.op)) errors.push(issue('GROUP_OPERATOR', '分组仅支持AND/OR'));
      if (!Array.isArray(n.children) || n.children.length < 1 || n.children.length > LIMITS.maxNodes) { errors.push(issue('GROUP_CHILDREN', '分组必须有1..100个子节点')); return; }
      for (let i = 0; i < n.children.length; i++) visit(n.children[i], depth + 1, `${path}.children[${i}]`);
    } else if (n.type === 'condition') {
      keys(n, ['type', 'id', 'timeframe', 'left', 'op', 'right'], path, errors);
      if (typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(n.id) || ids.has(n.id)) errors.push(issue('CONDITION_ID', '条件id必须唯一且为1..64位字母数字下划线或连字符'));
      ids.add(n.id);
      if (!FRAMES.includes(n.timeframe)) errors.push(issue('TIMEFRAME', '条件周期仅支持D/W/M'));
      if (!OPS.includes(n.op)) errors.push(issue('COMPARISON', '不支持该比较符'));
      expr(n.left, `${path}.left`); expr(n.right, `${path}.right`);
      if (object(n.left) && object(n.right)) {
        const a = unit(n.left), b = unit(n.right);
        if (a && b && a !== 'constant' && b !== 'constant' && a !== b) errors.push(issue('UNIT_MISMATCH', '指标单位不一致，禁止比较价格/成交量/百分比/倍数'));
        if (n.left.kind === 'constant') errors.push(issue('LEFT_CONSTANT', '左操作数必须是字段或指标'));
      }
    } else errors.push(issue('INVALID_NODE_TYPE', '节点仅支持group/condition'));
  }
  visit(rule.root, 1, 'rule.root');
  return { valid: errors.length === 0, errors, nodes };
}

export function validateSnapshot(s) {
  const input = readJSONInput(s);
  return input.valid ? validateSnapshotData(input.value) : { valid: false, errors: [input.error] };
}
function validateSnapshotData(s) {
  const errors = [];
  if (!object(s) || s.version !== 1 || !object(s.directory) || !object(s.frames) || !Array.isArray(s.stocks)) return { valid: false, errors: [issue('SNAPSHOT_SHAPE', '缺version=1、directory、frames、stocks')] };
  if (!validGeneration(s.generation, s.synthetic)) errors.push(issue('GENERATION_INVALID', '缺合法冻结代：local-ohlcv-加64位小写十六进制；合成快照可用synthetic-标识'));
  if (!date(s.targetSession) || typeof s.calendarVersion !== 'string' || !s.calendarVersion || typeof s.policyVersion !== 'string' || !s.policyVersion) errors.push(issue('FREEZE_TUPLE_INVALID', '缺共同targetSession/calendarVersion/policyVersion冻结合同'));
  if (!['ready', 'unavailable'].includes(s.directory.status)) errors.push(issue('DIRECTORY_STATUS', '目录状态必须ready/unavailable'));
  if (!['CN_MAINBOARD_NON_ST','CN_MAINBOARD_NON_ST_LEADERS'].includes(s.directory.universe)) errors.push(issue('UNIVERSE', '股票池须为沪深主板非ST或其明确行业龙头子池'));
  if (s.directory.universe === 'CN_MAINBOARD_NON_ST_LEADERS' && s.directory.status === 'ready' && (typeof s.directory.universeVersion !== 'string' || !s.directory.universeVersion || typeof s.directory.sourceNotes !== 'string' || !s.directory.sourceNotes)) errors.push(issue('UNIVERSE_PROVENANCE', '行业龙头子池须有版本和来源说明；本模块不推断龙头'));
  if (s.directory.status === 'ready') {
    if (!date(s.directory.asOf) || typeof s.directory.source !== 'string' || !s.directory.source) errors.push(issue('DIRECTORY_PROVENANCE', '目录必须有日期和来源'));
    if (!Array.isArray(s.directory.entries) || s.directory.entries.length > LIMITS.maxSymbols) errors.push(issue('DIRECTORY_BOUNDS', '目录条目超界或缺失'));
    else {
      const ids = new Set();
      for (const e of s.directory.entries) {
        if (!object(e) || typeof e.symbol !== 'string' || !/^(SH|SZ)\d{6}$/.test(e.symbol) || ids.has(e.symbol) || !['SH', 'SZ'].includes(e.exchange) || e.symbol.slice(0, 2) !== e.exchange || typeof e.name !== 'string' || !['non_st', 'st', 'unknown'].includes(e.stStatus) || typeof e.board !== 'string') { errors.push(issue('DIRECTORY_ENTRY', '目录条目无效/重复')); break; }
        ids.add(e.symbol);
      }
    }
  }
  if (s.stocks.length > LIMITS.maxSymbols) errors.push(issue('STOCK_BOUNDS', '股票快照过多'));
  const ids = new Set();
  for (const st of s.stocks) {
    if (!object(st) || typeof st.symbol !== 'string' || ids.has(st.symbol)) { errors.push(issue('STOCK_ID', '股票快照标识缺失或重复')); break; }
    ids.add(st.symbol);
    if (object(st.series)) for (const f of FRAMES) if (Array.isArray(st.series[f]?.bars) && st.series[f].bars.length > LIMITS.maxBarsPerFrame) errors.push(issue('BAR_BOUNDS', `${st.symbol}/${f}超${LIMITS.maxBarsPerFrame}根K线`));
    if (object(st.series)) for (const f of FRAMES) if (object(st.series[f])) errors.push(...validateDatasetQuality(st.series[f],{partial:true}));
  }
  return { valid: errors.length === 0, errors };
}
function isMainboard(e) {
  return e.board === 'mainboard' && (e.exchange === 'SH' ? /^SH(600|601|603|605)\d{3}$/.test(e.symbol) : /^SZ(000|001|002|003)\d{3}$/.test(e.symbol));
}
function completionKnown(bar, series, synthetic) {
  const proof = series.completionEvidence;
  if (bar.calendarCompletion === null || (bar.completion === 'complete' && bar.calendarCompletion !== true) || (bar.completion === 'partial' && bar.calendarCompletion !== false)) return false;
  if (proof?.kind === 'synthetic') return synthetic === true && series.calendarVersion === 'synthetic-calendar-v1' && bar.completionBasis === 'synthetic';
  const supported = supportedCalendar(series.calendarVersion);
  // A range alone or an arbitrary version never upgrades historical certainty.
  if (!supported) return false;
  if (bar.completionBasis !== 'verified_calendar_schedule_with_conservative_buffer') return false;
  if (proof?.kind !== 'calendar' || !date(proof.verifiedFrom) || !date(proof.verifiedThrough)) return false;
  return bar.periodStart >= proof.verifiedFrom && bar.periodEnd <= proof.verifiedThrough && bar.periodStart >= supported.verifiedFrom && bar.periodEnd <= supported.verifiedThrough;
}
function prepare(st, tf, snapshot) {
  const context = snapshot.frames[tf];
  const series = st.series?.[tf];
  const base = { timeframe: tf, cutoffDate: textValue(context?.cutoffDate), expectedLastDate: textValue(context?.expectedLastDate), mode: textValue(context?.mode) ?? 'completed', sourceKey: textValue(series?.sourceKey), adjustment: textValue(series?.adjustment), datasetId: textValue(series?.datasetId), targetSession: textValue(series?.targetSession), calendarVersion: textValue(series?.calendarVersion), policyVersion: textValue(series?.policyVersion), sourceFinality: textValue(series?.sourceFinality) ?? 'unknown', requestStartedAt: textValue(series?.requestStartedAt), completionCutoff: textValue(series?.completionCutoff), fetchedAt: textValue(series?.fetchedAt), contentHash: textValue(series?.contentHash) };
  if (!object(context) || !date(context.cutoffDate) || !date(context.expectedLastDate) || context.expectedLastDate > context.cutoffDate || (own(context, 'mode') && !['completed', 'include_partial'].includes(context.mode))) return { ...base, error: issue('FRAME_CONTEXT', '周期缺有效冻结截止/预期末根/使用模式') };
  if (context.cutoffDate !== snapshot.targetSession) return { ...base, error: issue('FRAME_TARGET_MISMATCH', '周期观察截止必须属于共同冻结targetSession；周期expectedLastDate可分别不同', { failure: true }) };
  if (!object(series)) return { ...base, error: issue('MISSING_FRAME', '缺该周期OHLCV') };
  if (series.status === 'error') return { ...base, error: issue('DATA_FAILURE', typeof series.errorCode === 'string' ? series.errorCode : '上游数据失败', { failure: true }) };
  if (series.status !== 'ready' || !Array.isArray(series.bars)) return { ...base, error: issue('MISSING_FRAME', '周期未准备好') };
  if (!validGeneration(series.datasetId, snapshot.synthetic) || series.datasetId !== snapshot.generation) return { ...base, error: issue('DATASET_GENERATION_MISMATCH', '所用序列datasetId必须等于快照共同generation；不混冻结代', { failure: true, expectedGeneration: snapshot.generation, actualDatasetId: series.datasetId }) };
  if (series.targetSession !== snapshot.targetSession || series.calendarVersion !== snapshot.calendarVersion || series.policyVersion !== snapshot.policyVersion) return { ...base, error: issue('DATASET_FREEZE_TUPLE_MISMATCH', '所用序列targetSession/calendarVersion/policyVersion必须等于快照共同冻结tuple', { failure: true, expectedTuple: {targetSession:snapshot.targetSession,calendarVersion:snapshot.calendarVersion,policyVersion:snapshot.policyVersion}, actualTuple:{targetSession:series.targetSession,calendarVersion:series.calendarVersion,policyVersion:series.policyVersion} }) };
  if (!supportedPolicy(series.policyVersion, snapshot.synthetic)) return { ...base, error: issue('POLICY_VERSION_UNSUPPORTED', '未知policy version不能作为本合同完成验证依据', { failure: true }) };
  if (!validReceipt({ requestStartedAt: series.requestStartedAt, completionCutoff: series.completionCutoff, fetchedAt: series.fetchedAt, targetSession: series.targetSession })) return { ...base, error: issue('RECEIPT_CLOCK_INVALID', '收据时钟须严格ISO、cutoff与request为同一绝对时刻、fetched≥request且观察日达到目标；跨序列时钟可以不同', { failure: true }) };
  if (typeof series.sourceKey !== 'string' || !series.sourceKey || !['none', 'qfq', 'hfq'].includes(series.adjustment) || series.currency !== 'CNY' || series.volumeUnit !== 'shares') return { ...base, error: issue('PROVENANCE_UNITS', '缺来源/明确复权/价格CNY/成交量股口径', { failure: true }) };
  const qualityErrors = validateDatasetQuality(series);
  if (qualityErrors.length) return { ...base, error: qualityErrors[0] };
  const bars = []; let last = ''; let uncertainAtOrBeforeExpected = false;
  for (const b of series.bars) {
    if (!object(b) || !date(b.date) || !date(b.periodStart) || !date(b.periodEnd) || b.periodStart > b.date || b.date > b.periodEnd || b.date <= last || !['complete', 'partial', 'unknown'].includes(b.completion)) return { ...base, error: issue('MALFORMED_BARS', 'K线日期/周期/排序/完成标志无效', { failure: true }) };
    last = b.date;
    if (b.sourceKey !== series.sourceKey || b.adjustment !== series.adjustment) return { ...base, error: issue('MIXED_PROVENANCE', '单周期混用来源或复权', { failure: true }) };
    if (b.date > context.cutoffDate) continue;
    if (b.completion === 'complete' && b.periodEnd > context.cutoffDate) return { ...base, error: issue('COMPLETION_CONTRADICTION', '完整周期结束日期晚于冻结截止', { failure: true }) };
    const known = completionKnown(b, series, snapshot.synthetic);
    if (b.completion === 'unknown' || !known) { if (b.date === context.expectedLastDate) uncertainAtOrBeforeExpected = true; }
    if (base.mode === 'completed' && b.completion === 'partial') continue;
    bars.push({ ...b, _completionKnown: known });
  }
  if (uncertainAtOrBeforeExpected) return { ...base, error: issue('COMPLETION_UNKNOWN', '预期末根完成状态或日历版本无法验证；不可扩张2026历史日历证据') };
  if (!bars.length) return { ...base, error: issue('NO_ELIGIBLE_BARS', '截止日无可用周期') };
  const final = bars.at(-1);
  if (final.date < context.expectedLastDate) return { ...base, actualLastDate: final.date, error: issue('STALE_DATA', '末根早于该周期预期截止', { actualLastDate: final.date }) };
  if (final.date > context.expectedLastDate) return { ...base, actualLastDate: final.date, error: issue('FROZEN_DATE_MISMATCH', '末根晚于冻结预期末根，需适配器明确冻结', { failure: true }) };
  return { ...base, bars, sourceKey: series.sourceKey, adjustment: series.adjustment, coverage: series.coverage, volumeBasis: series.volumeBasis, pointInTime: series.pointInTime, sourceFinality: series.sourceFinality, datasetId: series.datasetId, targetSession: series.targetSession, calendarVersion: series.calendarVersion, policyVersion: series.policyVersion, requestStartedAt: series.requestStartedAt, completionCutoff: series.completionCutoff, contentHash: series.contentHash, fetchedAt: series.fetchedAt, actualLastDate: final.date, partialUsed: base.mode === 'include_partial' && final.completion === 'partial' };
}
function evaluateOperand(e, frame, crossOffset = 0) {
  if (e.kind === 'constant') return { value: e.value, unit: 'threshold', sample: null };
  const end = frame.bars.length - 1 - (e.offset ?? 0) - crossOffset;
  const lag = ['prior_high', 'volume_ratio'].includes(e.kind) ? 1 : 0;
  const start = e.kind === 'field' ? end : e.kind === 'change_pct' ? end - e.window : end - lag - e.window + 1;
  const rangeEnd = e.kind === 'prior_high' ? end - 1 : end;
  if (start < 0 || end < 0) return { error: issue('INSUFFICIENT_HISTORY', '真实窗口不足', { requiredBars: frame.bars.length - start, availableBars: frame.bars.length }) };
  const sampleBars = frame.bars.slice(start, rangeEnd + 1);
  const sample = { from: sampleBars[0].date, to: sampleBars.at(-1).date, bars: sampleBars.length, window: e.window ?? 1, offset: (e.offset ?? 0) + crossOffset, excludesCurrent: e.kind === 'prior_high', sourceKey: frame.sourceKey, adjustment: frame.adjustment, volumeBasis: frame.volumeBasis, pointInTime: frame.pointInTime, containsPartial: sampleBars.some(b => b.completion === 'partial') };
  if (e.kind === 'volume_ratio') sample.baseline = { from: sampleBars[0].date, to: sampleBars.at(-2).date, bars: e.window, excludesCurrent: true };
  if (frame.coverage) {
    const missing = frame.coverage.missing_scheduled_session_dates.filter(d => d >= sampleBars[0].periodStart && d <= frame.bars[end].date);
    sample.coverage = { fullHistory: false, observedWindowOnly: true, calendarGapsUnverified: frame.coverage.calendar_gaps_unverified, missingScheduledSessionDates: missing, missingSessionNote: frame.coverage.missing_session_note };
    if (frame.coverage.calendar_gaps_unverified === true) return { sample, error: issue('CALENDAR_GAPS_UNVERIFIED', '日历缺口检查未知，无法确认所需窗口；不推断停牌或来源失败') };
    if (missing.length) return { sample, error: issue('MISSING_SCHEDULED_SESSIONS', '所需窗口缺计划交易日；可能是上市期、停牌或覆盖限制，原因未判定', { missingSessionDates: missing }) };
  }
  if (sampleBars.some(b => b.completion === 'unknown' || !b._completionKnown || (frame.mode === 'completed' && b.completion !== 'complete'))) return { sample, error: issue('COMPLETION_UNKNOWN', '所需窗口含未经验证的完成周期') };
  const field = e.kind === 'volume_ma' || e.kind === 'volume_ratio' ? 'volume_shares' : e.kind === 'prior_high' ? 'high' : e.kind === 'change_pct' ? 'close' : e.field;
  for (const b of sampleBars) {
    for (const k of FIELDS) {
      if (!finite(b[k])) return { sample, error: issue('MISSING_FIELD', `OHLCV窗口缺${k}`, { date: b.date, field: k }) };
      if (b[k] < 0 || (k !== 'volume_shares' && b[k] === 0)) return { sample, error: issue('INVALID_FIELD', `窗口${k}数值无效`, { date: b.date, failure: true }) };
    }
    if (['open', 'high', 'low', 'close'].every(k => finite(b[k])) && (b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high)) return { sample, error: issue('INVALID_OHLC', 'OHLC关系无效', { date: b.date, failure: true }) };
  }
  const values = sampleBars.map(b => b[field]); let value;
  if (e.kind === 'field') value = values[0];
  if (e.kind === 'ma' || e.kind === 'volume_ma') value = values.reduce((a, b) => a + b, 0) / values.length;
  if (e.kind === 'prior_high') value = Math.max(...values);
  if (e.kind === 'change_pct') value = (values.at(-1) / values[0] - 1) * 100;
  if (e.kind === 'volume_ratio') {
    const mean = values.slice(0, -1).reduce((a, b) => a + b, 0) / e.window;
    if (mean === 0) return { sample, error: issue('ZERO_BASELINE', '前N根成交量均值为0，量比未定义') };
    value = values.at(-1) / mean;
  }
  if (!finite(value)) return { sample, error: issue('NONFINITE_RESULT', '指标结果非有限数', { failure: true }) };
  return { value, unit: unit(e), sample };
}
function compare(op, a, b) {
  switch (op) { case 'gt': return a > b; case 'gte': return a >= b; case 'lt': return a < b; case 'lte': return a <= b; case 'eq': return a === b; case 'neq': return a !== b; }
}
function evaluateTree(root, st, snapshot) {
  const frames = new Map();
  function condition(n) {
    if (!frames.has(n.timeframe)) frames.set(n.timeframe, prepare(st, n.timeframe, snapshot));
    const f = frames.get(n.timeframe);
    const metadata = { cutoffDate: f.cutoffDate, actualLastDate: f.actualLastDate, expectedLastDate: f.expectedLastDate, mode: f.mode, partialUsed: f.partialUsed ?? false, sourceKey: f.sourceKey, adjustment: f.adjustment, sourceFinality: f.sourceFinality ?? 'unknown', datasetId: f.datasetId, targetSession: f.targetSession, calendarVersion: f.calendarVersion, policyVersion: f.policyVersion, requestStartedAt: f.requestStartedAt, completionCutoff: f.completionCutoff, contentHash: f.contentHash, fetchedAt: f.fetchedAt };
    if (f.error) return { type: 'condition', id: n.id, timeframe: n.timeframe, state: f.error.failure ? 'failure' : 'insufficient', reasons: [f.error], ...metadata };
    const left = evaluateOperand(n.left, f), right = evaluateOperand(n.right, f);
    const cross = n.op.startsWith('cross_');
    const previous = cross ? { left: evaluateOperand(n.left, f, 1), right: evaluateOperand(n.right, f, 1) } : undefined;
    const errors = [left, right, ...(cross ? [previous.left, previous.right] : [])].filter(x => x.error).map(x => x.error);
    if (errors.length) return { type: 'condition', id: n.id, timeframe: n.timeframe, op: n.op, state: errors.some(e => e.failure) ? 'failure' : 'insufficient', left, right, previous, reasons: errors, ...metadata };
    const passed = cross ? n.op === 'cross_above' ? previous.left.value <= previous.right.value && left.value > right.value : previous.left.value >= previous.right.value && left.value < right.value : compare(n.op, left.value, right.value);
    return { type: 'condition', id: n.id, timeframe: n.timeframe, op: n.op, state: passed ? 'match' : 'no_match', passed, left, right, previous, reasons: [issue(passed ? 'CONDITION_MATCH' : 'CONDITION_NOT_MET', passed ? '满足条件' : '不满足条件')], ...metadata };
  }
  function visit(n) {
    if (n.type === 'condition') return condition(n);
    const children = n.children.map(visit);
    // Eager evaluation is intentional: never hide missing data behind boolean short circuit.
    let state;
    if (children.some(x => x.state === 'failure')) state = 'failure';
    else if (children.some(x => x.state === 'insufficient')) state = 'insufficient';
    else state = (n.op === 'AND' ? children.every(x => x.state === 'match') : children.some(x => x.state === 'match')) ? 'match' : 'no_match';
    return { type: 'group', op: n.op, state, children };
  }
  return visit(root);
}
function validateLimits(limits) {
  const errors = [];
  if (!object(limits)) return [issue('INVALID_LIMITS', 'limits必须为对象')];
  keys(limits, ['symbols', 'exchanges', 'maxProcessed'], 'limits', errors);
  if (own(limits, 'symbols') && (!Array.isArray(limits.symbols) || limits.symbols.length > LIMITS.maxSymbols || limits.symbols.some(x => typeof x !== 'string' || !/^(SH|SZ)\d{6}$/.test(x)) || new Set(limits.symbols).size !== limits.symbols.length)) errors.push(issue('INVALID_SYMBOL_LIMIT', 'symbol限制无效/重复/超界'));
  if (own(limits, 'exchanges') && (!Array.isArray(limits.exchanges) || limits.exchanges.some(x => !['SH', 'SZ'].includes(x)))) errors.push(issue('INVALID_EXCHANGE_LIMIT', '仅允许SH/SZ'));
  if (own(limits, 'maxProcessed') && !integer(limits.maxProcessed, 0, LIMITS.maxSymbols)) errors.push(issue('INVALID_PROCESS_BUDGET', '处理上限必须0..6000'));
  return errors;
}
function counts(rows) {
  const c = { total: rows.length, processed: 0, successful: 0, match: 0, no_match: 0, failure: 0, insufficient: 0, unprocessed: 0 };
  for (const r of rows) { c[r.state]++; if (r.state !== 'unprocessed') c.processed++; if (['match', 'no_match'].includes(r.state)) c.successful++; }
  return c;
}
export function screen(snapshot, rule, limits = '{}') {
  const snapshotInput = readJSONInput(snapshot), ruleInput = readJSONInput(rule), limitsInput = readJSONInput(limits);
  const boundaryErrors = [snapshotInput, ruleInput, limitsInput].filter(x => !x.valid).map(x => x.error);
  if (boundaryErrors.length) return { version: 1, synthetic: false, execution: 'pure_local_consumer', status: 'invalid', coverageKnown: false, counts: counts([]), rows: [], errors: boundaryErrors };
  snapshot = snapshotInput.value; rule = ruleInput.value; limits = limitsInput.value;
  const ruleCheck = validateRuleData(rule), snapshotCheck = validateSnapshotData(snapshot), limitErrors = validateLimits(limits);
  const errors = [...ruleCheck.errors, ...snapshotCheck.errors, ...limitErrors];
  const empty = { version: 1, synthetic: snapshot?.synthetic === true, execution: 'pure_local_consumer', counts: counts([]), rows: [], errors };
  if (errors.length) return { ...empty, status: 'invalid', coverageKnown: false };
  if (snapshot.directory.status !== 'ready') return { ...empty, status: 'blocked', coverageKnown: false, counts: null, errors: [issue(typeof snapshot.directory.errorCode === 'string' ? snapshot.directory.errorCode : 'DIRECTORY_UNAVAILABLE', '目录不可用，尚未开始；未知总数不记为0全池')] };
  const excluded = [], restrictionExcluded = [], candidates = [];
  for (const e of snapshot.directory.entries) {
    if (!isMainboard(e) || e.stStatus === 'st' || /(?:\*?ST|退)/i.test(e.name)) { excluded.push({ symbol: e.symbol, reason: 'OUTSIDE_MAINBOARD_NON_ST' }); continue; }
    if ((limits.symbols && !limits.symbols.includes(e.symbol)) || (limits.exchanges && !limits.exchanges.includes(e.exchange))) { restrictionExcluded.push(e.symbol); continue; }
    candidates.push(e);
  }
  const stocks = new Map(snapshot.stocks.map(st => [st.symbol, st]));
  const max = Math.min(limits.maxProcessed ?? LIMITS.maxSymbols, Math.floor(LIMITS.maxEvaluations / ruleCheck.nodes));
  const usedFrames = [...new Set(collectFrames(rule.root))];
  const requestedFrames = Object.fromEntries(usedFrames.map(tf => {
    const f = snapshot.frames[tf];
    return [tf, f ? {cutoffDate:textValue(f.cutoffDate),expectedLastDate:textValue(f.expectedLastDate),mode:textValue(f.mode),adjustment:textValue(f.adjustment)} : null];
  }));
  const requiredDates = usedFrames.map(f => snapshot.frames[f]?.cutoffDate);
  const rows = candidates.map((e, i) => {
    const base = { symbol: e.symbol, name: e.name, directoryAsOf: snapshot.directory.asOf, requestedFrames };
    if (i >= max) return { ...base, state: 'unprocessed', reasons: [issue('PROCESS_BUDGET', '到达有界处理预算')] };
    if (requiredDates.some(d => date(d) && snapshot.directory.asOf < d)) return { ...base, state: 'insufficient', reasons: [issue('DIRECTORY_STALE', '目录非ST身份日期早于所用冻结截止')] };
    if (e.stStatus !== 'non_st') return { ...base, state: 'insufficient', reasons: [issue('ST_STATUS_UNKNOWN', '无法确认非ST')] };
    const st = stocks.get(e.symbol);
    if (!st) return { ...base, state: 'insufficient', reasons: [issue('MISSING_STOCK', '目录存在但历史未准备好')] };
    if (st.status === 'error') return { ...base, state: 'failure', reasons: [issue('DATA_FAILURE', typeof st.errorCode === 'string' ? st.errorCode : '上游股票数据失败')] };
    if (st.status !== 'ready') return { ...base, state: 'insufficient', reasons: [issue('MISSING_STOCK', '股票快照未准备好')] };
    if (!object(st.suspension) || st.suspension.state !== 'active' || !date(st.suspension.verifiedThrough) || requiredDates.some(d => !date(d) || st.suspension.verifiedThrough < d)) return { ...base, state: 'insufficient', reasons: [issue(st.suspension?.state === 'suspended' ? 'SUSPENDED' : 'SUSPENSION_UNKNOWN', st.suspension?.state === 'suspended' ? '已停牌，本期不判定策略' : '截止日停牌状态未知')] };
    const bases = usedFrames.map(f => st.series?.[f]).filter(s => s?.status === 'ready' && typeof s.sourceKey === 'string' && typeof s.adjustment === 'string');
    if (new Set(bases.map(s => `${s.sourceKey}/${s.adjustment}`)).size > 1) return { ...base, state: 'failure', reasons: [issue('CROSS_FRAME_BASIS_MISMATCH', '所用多周期来源或复权不同，适配器需统一口径')] };
    const tree = evaluateTree(rule.root, st, snapshot);
    return { ...base, state: tree.state, tree };
  }).map(row => ({ ...row, decision: row.state === 'match' ? 'pass' : row.state === 'no_match' ? 'fail' : 'unknown', passed: row.state === 'match' ? true : row.state === 'no_match' ? false : null }));
  return { version: 1, status: 'completed', synthetic: snapshot.synthetic === true, execution: 'pure_local_consumer', coverageKnown: true, directory: { asOf: snapshot.directory.asOf, source: snapshot.directory.source, universe: snapshot.directory.universe, universeVersion: snapshot.directory.universeVersion ?? null, sourceNotes: snapshot.directory.sourceNotes ?? null, catalogTotal: snapshot.directory.entries.length, excludedTotal: excluded.length, restrictionExcludedTotal: restrictionExcluded.length }, frozenFrames: snapshot.frames, counts: counts(rows), rows, excluded, restrictionExcluded, requestedOutsideCatalog: (limits.symbols ?? []).filter(s => !snapshot.directory.entries.some(e => e.symbol === s)), errors: [], warnings: ['目录准备好不代表历史全池完成；successful仅表示可判定条件', 'source_finality未知时不声称来源最终值已获确认；计算仅针对输入冻结副本', '自定义规则和个人数据须在本地执行保存；本模块不抓取、不持久化、不交易'] };
}
function collectFrames(n) { return n.type === 'condition' ? [n.timeframe] : n.children.flatMap(collectFrames); }
