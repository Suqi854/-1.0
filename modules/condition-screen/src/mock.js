/** Deterministic invented prices and dates. No market data or network. */
const SOURCE = 'SYNTHETIC_OHLCV_V1';
const GENERATION = 'synthetic-ohlcv-demo-v1';
const iso = d => d.toISOString().slice(0, 10);
function dates(tf, length) {
  const result = [];
  if (tf === 'M') {
    for (let i = length - 1; i >= 0; i--) result.push(iso(new Date(Date.UTC(2026, 8 - i, 0))));
  } else {
    const d = new Date(tf === 'D' ? '2026-09-28T00:00:00Z' : '2026-09-25T00:00:00Z');
    while (result.length < length) {
      if (tf === 'W' || ![0, 6].includes(d.getUTCDay())) result.unshift(iso(d));
      d.setUTCDate(d.getUTCDate() - (tf === 'W' ? 7 : 1));
    }
  }
  return result;
}
function series(tf, rising = true, length = tf === 'D' ? 90 : tf === 'W' ? 35 : 20) {
  const bars = dates(tf, length).map((date, i) => {
    const close = 10 + (rising ? i * 0.15 : (length - i) * 0.12);
    const periodStart = tf === 'D' ? date : tf === 'M' ? `${date.slice(0, 7)}-01` : iso(new Date(new Date(date).getTime() - 4 * 86400000));
    return { date, periodStart, periodEnd: date, completion: 'complete', sourceKey: SOURCE, adjustment: 'none', open: close - 0.02, high: close + 0.05, low: close - 0.1, close, volume_shares: i === length - 1 ? 200000 : 100000, amount_cny: null,sourceTimestamp:date+'T15:00:00+08:00',sourceFinality:'unknown',calendarCompletion:true,completionBasis:'synthetic',observedLatest:null };
  });
  if (tf !== 'D') bars.push({ ...bars.at(-1), date: '2026-09-28',sourceTimestamp:'2026-09-28T15:00:00+08:00', periodStart: tf === 'W' ? '2026-09-28' : '2026-09-01', periodEnd: tf === 'W' ? '2026-10-02' : '2026-09-30', completion: 'partial',calendarCompletion:false });
  return { status: 'ready', datasetId: GENERATION, targetSession: '2026-09-28', calendarVersion: 'synthetic-calendar-v1', policyVersion: 'synthetic-conditions-v1', requestStartedAt: '2026-09-28T10:00:00Z', completionCutoff: '2026-09-28T10:00:00Z', fetchedAt: '2026-09-28T10:00:01Z', sourceTimestamp:'2026-09-28T15:00:00+08:00',sourceFinality:'unknown',pointInTime:false,contentHash:({D:'d',W:'e',M:'f'})[tf].repeat(64),volumeBasis:'provider_unadjusted_reported_volume',sourceKey: SOURCE, adjustment: 'none', currency: 'CNY', volumeUnit: 'shares', completionEvidence: { kind: 'synthetic' },coverage:{requested:Math.max(250,bars.length),returned:bars.length,first_date:bars[0].date,last_date:bars.at(-1).date,full_history:false,calendar_unverified_rows:0,missing_scheduled_session_dates:[],calendar_gaps_unverified:false,missing_session_note:'Synthetic fixture only; absence does not imply suspension'}, bars };
}
export function createMockSnapshot() {
  const symbols = ['SH600001', 'SZ000001', 'SH600002', 'SZ000002', 'SH600003', 'SZ000003', 'SH600004', 'SH600005', 'SZ300001', 'SH600006'];
  const entries = symbols.map((symbol, i) => ({ symbol, exchange: symbol.slice(0, 2), board: i === 8 ? 'chinext' : 'mainboard', stStatus: i === 7 ? 'st' : i === 9 ? 'unknown' : 'non_st', name: i === 7 ? '*ST合成排除' : `合成样本${i + 1}` }));
  const stocks = symbols.slice(0, 9).map((symbol, i) => ({ symbol, status: 'ready', suspension: { state: 'active', verifiedThrough: '2026-09-28' }, series: { D: series('D', i !== 1), W: series('W', i !== 1), M: series('M', i !== 1) } }));
  stocks[2].series.D.bars = stocks[2].series.D.bars.slice(-8);
  stocks[3].series.D.bars.pop();
  for(const i of [2,3]){const s=stocks[i].series.D;s.coverage.returned=s.bars.length;s.coverage.first_date=s.bars[0].date;s.coverage.last_date=s.bars.at(-1).date;}
  stocks[4].status = 'error'; stocks[4].errorCode = 'SYNTHETIC_PROVIDER_ERROR';
  stocks[5].suspension.state = 'unknown';
  stocks[6].series.D.bars.at(-1).volume_shares = null;
  return {
    version: 1, synthetic: true, generation: GENERATION, targetSession: '2026-09-28', calendarVersion: 'synthetic-calendar-v1', policyVersion: 'synthetic-conditions-v1',
    directory: { status: 'ready', universe: 'CN_MAINBOARD_NON_ST', source: 'SYNTHETIC_DIRECTORY_V1', asOf: '2026-09-28', entries },
    frames: { D: { cutoffDate: '2026-09-28', expectedLastDate: '2026-09-28', mode: 'completed' }, W: { cutoffDate: '2026-09-28', expectedLastDate: '2026-09-25', mode: 'completed' }, M: { cutoffDate: '2026-09-28', expectedLastDate: '2026-08-31', mode: 'completed' } },
    stocks
  };
}
