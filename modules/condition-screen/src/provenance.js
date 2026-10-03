/** One explicit shared contract; no invented identity or calendar proof. */
export const SUPPORTED_CALENDARS = Object.freeze({
  'exchange-announced-2026-v1': Object.freeze({ verifiedFrom: '2026-01-01', verifiedThrough: '2026-12-31' })
});
export const DATASET_ID_PATTERN = /^(?:local-ohlcv-[0-9a-f]{64}|synthetic-[A-Za-z0-9][A-Za-z0-9_-]{0,95})$/;
export function validGeneration(id, synthetic) {
  return typeof id === 'string' && DATASET_ID_PATTERN.test(id) && (!id.startsWith('synthetic-') || synthetic === true);
}
export function supportedCalendar(version) {
  return typeof version === 'string' && Object.prototype.hasOwnProperty.call(SUPPORTED_CALENDARS, version) ? SUPPORTED_CALENDARS[version] : null;
}
export function supportedPolicy(version, synthetic) {
  return version === 'local-ohlcv-v1' || (synthetic === true && version === 'synthetic-conditions-v1');
}
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isoClock(s) {
  if (typeof s !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  if (match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4, 6)) > 59)) return null;
  const ms = Date.parse(s); return Number.isFinite(ms) ? ms : null;
}
export function validReceipt({ requestStartedAt, completionCutoff, fetchedAt, targetSession }) {
  const started = isoClock(requestStartedAt), cutoff = isoClock(completionCutoff), fetched = isoClock(fetchedAt);
  // Portable v1 writes both receipt fields from the same per-series requestStart.
  if (started === null || cutoff === null || fetched === null || !validDate(targetSession) || cutoff !== started || fetched < started) return false;
  // China calendar day of the actual completion observation; no invented close-time buffer.
  return new Date(cutoff + 8 * 3600000).toISOString().slice(0, 10) >= targetSession;
}
