/** Pure mapper for the parent-provided local OHLCV dataset v1. No loader, store, or network. */
import { LIMITS } from './engine.js';
import { readJSONInput } from './json-input.js';
import { validGeneration, supportedCalendar, supportedPolicy, validReceipt, validDate } from './provenance.js';
import { validateDatasetQuality } from './quality.js';
export const PORTABLE_KEYS = Object.freeze(['1d:none', '1w:none', '1mo:none', '1d:qfq']);
const INTERVAL = { D: '1d', W: '1w', M: '1mo' };
const BASIS = 'verified_calendar_schedule_with_conservative_buffer';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const date = s => { const d = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s) : null; return d && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; };
function periodStart(tf, d) {
  if (!date(d)) return d;
  if (tf === 'D') return d;
  if (tf === 'M') return d.slice(0, 7) + '-01';
  const x = new Date(d); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); return x.toISOString().slice(0, 10);
}
export function adaptPortableDatasets(input) {
  const boundary = readJSONInput(input);
  if (!boundary.valid) return { valid: false, snapshot: null, diagnostics: [boundary.error], availableSeries: [] };
  input = boundary.value;
  const diagnostics = [];
  const error = (code, details={}) => { diagnostics.push({code,...details}); };
  if (!object(input) || Object.keys(input).some(k=>!['runId','synthetic','directory','frames','records','suspensionBySymbol','targetSession','calendarVersion','policyVersion'].includes(k)) || (input.synthetic!==undefined&&typeof input.synthetic!=='boolean') || (input.targetSession!==undefined&&!validDate(input.targetSession)) || ['calendarVersion','policyVersion'].some(k=>input[k]!==undefined&&(typeof input[k]!=='string'||!input[k])) || (input.suspensionBySymbol!==undefined&&!object(input.suspensionBySymbol)) || !validGeneration(input.runId, input.synthetic) || !object(input.directory) || !object(input.frames) || !Array.isArray(input.records) || input.records.length > LIMITS.maxSymbols * PORTABLE_KEYS.length) return { valid: false, snapshot: null, diagnostics: [{code:'ADAPTER_INPUT_INVALID'}], availableSeries: [] };
  const records = new Map(), availableSeries=[];
  for (const rec of input.records) {
    if (!object(rec) || Object.keys(rec).some(k=>!['symbol','key','result'].includes(k)) || typeof rec.symbol !== 'string' || !/^(SH|SZ)\d{6}$/i.test(rec.symbol) || !PORTABLE_KEYS.includes(rec.key) || !object(rec.result)) { return {valid:false,snapshot:null,diagnostics:[{code:'ADAPTER_RECORD_INVALID'}],availableSeries:[]}; }
    if(Object.keys(rec.result).some(k=>!['available','state','source_finality','dataset','error','error_code','message','reason'].includes(k))||typeof rec.result.available!=='boolean'||typeof rec.result.state!=='string'||!['ready','partial','pending_source','pending','failed_without_data','failed','error'].includes(rec.result.state)||(rec.result.available===true?rec.result.source_finality!=='unknown':rec.result.source_finality!==undefined&&rec.result.source_finality!=='unknown')) return {valid:false,snapshot:null,diagnostics:[{code:'ADAPTER_RESULT_INVALID'}],availableSeries:[]};
    const symbol=rec.symbol.toUpperCase(), key=`${symbol}/${rec.key}`;
    if(records.has(key)){ error('DUPLICATE_SERIES',{symbol,key:rec.key}); return {valid:false,snapshot:null,diagnostics,availableSeries:[]}; }
    records.set(key,rec.result);
  }
  const symbols=[...new Set(input.records.filter(x=>typeof x?.symbol==='string'&&/^(SH|SZ)\d{6}$/i.test(x.symbol)).map(x=>x.symbol.toUpperCase()))];
  const selectedKeys = new Set(Object.entries(input.frames).filter(([tf,context])=>Object.prototype.hasOwnProperty.call(INTERVAL,tf)&&object(context)&&(context.adjustment===undefined||typeof context.adjustment==='string')).map(([tf,context])=>`${INTERVAL[tf]}:${context.adjustment??'none'}`));
  const anchor = input.records.find(rec=>object(rec)&&selectedKeys.has(rec.key)&&rec.result?.available===true&&object(rec.result.dataset))?.result.dataset;
  const targetSession = input.targetSession ?? anchor?.target_session ?? Object.values(input.frames).find(object)?.cutoffDate;
  const calendarVersion = input.calendarVersion ?? anchor?.calendar_version ?? 'unknown';
  const policyVersion = input.policyVersion ?? anchor?.policy_version ?? 'unknown';
  const stocks=symbols.map(symbol=>{
    const series={};
    for(const [tf,context] of Object.entries(input.frames)){
      if(!Object.prototype.hasOwnProperty.call(INTERVAL,tf)||!object(context))continue;
      if (context.adjustment !== undefined && typeof context.adjustment !== 'string') { error('ADAPTER_FRAME_INVALID', {symbol,timeframe:tf}); continue; }
      const key=`${INTERVAL[tf]}:${context.adjustment ?? 'none'}`;
      const result=records.get(`${symbol}/${key}`);
      if(!PORTABLE_KEYS.includes(key)){ error('SERIES_NOT_IN_REGISTRY',{symbol,timeframe:tf,key});continue; }
      if(!result||result.available!==true){
        if(result&&['failed_without_data','failed','error'].includes(result.state))series[tf]={status:'error',errorCode:'UPSTREAM_FAILED_WITHOUT_DATA'};
        else error('SERIES_NOT_AVAILABLE',{symbol,timeframe:tf,key,state:result?.state??'not_supplied'});
        continue;
      }
      if (result.state !== 'ready') { error('AVAILABLE_STATE_CONTRADICTION', {symbol,timeframe:tf,key}); series[tf]={status:'error',errorCode:'AVAILABLE_STATE_CONTRADICTION'}; continue; }
      const d=result.dataset;
      const qualityErrors=validateDatasetQuality(d,{portable:true});
      if(qualityErrors.length){diagnostics.push(...qualityErrors.map(e=>({...e,symbol,timeframe:tf,key})));series[tf]={status:'error',errorCode:qualityErrors[0].code};continue;}
      const validIdentity=object(d)&&d.dataset_id===input.runId&&typeof d.symbol==='string'&&d.symbol.toUpperCase()===symbol&&d.interval===INTERVAL[tf]&&d.adjustment===key.split(':')[1]&&d.source==='tencent'&&date(d.target_session)&&d.target_session===context.cutoffDate&&typeof d.calendar_version==='string'&&!!d.calendar_version&&typeof d.policy_version==='string'&&!!d.policy_version&&typeof d.content_hash==='string'&&/^[0-9a-f]{64}$/.test(d.content_hash)&&typeof d.source_timestamp==='string'&&!!d.source_timestamp&&d.source_finality==='unknown'&&result.source_finality==='unknown'&&d.point_in_time===false&&d.cache?.used===true&&d.cache?.scope==='explicit_local_dataset'&&d.units?.price==='CNY'&&d.units?.volume==='shares; provider unadjusted reported volume'&&d.units?.amount==='unavailable=null'&&Array.isArray(d.bars)&&d.bars.length<=LIMITS.maxBarsPerFrame;
      if(!validIdentity){ error('DATASET_IDENTITY_OR_UNITS',{symbol,timeframe:tf,key});series[tf]={status:'error',errorCode:'DATASET_IDENTITY_OR_UNITS'};continue; }
      if (d.target_session !== targetSession || d.calendar_version !== calendarVersion || d.policy_version !== policyVersion) { error('DATASET_FREEZE_TUPLE_MISMATCH', {symbol,timeframe:tf,key}); series[tf]={status:'error',errorCode:'DATASET_FREEZE_TUPLE_MISMATCH'}; continue; }
      if (!supportedPolicy(d.policy_version, input.synthetic)) { error('POLICY_VERSION_UNSUPPORTED', {symbol,timeframe:tf,key}); series[tf]={status:'error',errorCode:'POLICY_VERSION_UNSUPPORTED'}; continue; }
      if (!validReceipt({requestStartedAt:d.request_started_at,completionCutoff:d.completion_cutoff,fetchedAt:d.fetched_at,targetSession:d.target_session})) { error('RECEIPT_CLOCK_INVALID', {symbol,timeframe:tf,key}); series[tf]={status:'error',errorCode:'RECEIPT_CLOCK_INVALID'}; continue; }
      const calendar = supportedCalendar(d.calendar_version);
      if (!calendar) error('CALENDAR_VERSION_UNSUPPORTED', {symbol,timeframe:tf,key,calendarVersion:d.calendar_version});
      if (d.bars.length && (d.bars.at(-1).date !== targetSession || d.coverage.first_date !== d.bars[0].date || d.coverage.last_date !== d.bars.at(-1).date)) { error('OBSERVATION_TARGET_MISMATCH', {symbol,timeframe:tf,key}); series[tf]={status:'error',errorCode:'OBSERVATION_TARGET_MISMATCH'}; continue; }
      series[tf]={status:'ready',sourceKey:d.source,adjustment:d.adjustment,currency:'CNY',volumeUnit:'shares',volumeBasis:'provider_unadjusted_reported_volume',completionEvidence:calendar?{kind:'calendar',...calendar}:{kind:'unknown'},datasetId:d.dataset_id,targetSession:d.target_session,contentHash:d.content_hash,sourceFinality:d.source_finality,pointInTime:d.point_in_time,requestStartedAt:d.request_started_at,fetchedAt:d.fetched_at,completionCutoff:d.completion_cutoff,sourceTimestamp:d.source_timestamp,calendarVersion:d.calendar_version,policyVersion:d.policy_version,coverage:d.coverage,cache:d.cache,
        bars:d.bars.map(b=>{
          const completion=!calendar||b.completion_basis!==BASIS?'unknown':b.complete===true&&b.calendar_completion===true?'complete':b.complete===false&&b.calendar_completion===false?'partial':'unknown';
          return {date:b.date,periodStart:periodStart(tf,b.date),periodEnd:b.period_end_session,completion,sourceKey:d.source,adjustment:d.adjustment,open:b.open,high:b.high,low:b.low,close:b.close,volume_shares:b.volume_shares,amount_cny:null,sourceTimestamp:b.source_timestamp,sourceFinality:b.source_finality,calendarCompletion:b.calendar_completion,completionBasis:b.completion_basis,observedLatest:b.observed_latest};
        })};
      availableSeries.push({symbol,key});
    }
    // Updater 'ready' and missing sessions do not prove tradability. Caller must supply a local attestation.
    return {symbol,status:'ready',suspension:input.suspensionBySymbol?.[symbol]??{state:'unknown'},series};
  });
  const directory=structuredClone(input.directory);
  // Do not promote updater's name-only ST filtering to an official non-ST attestation.
  if(Array.isArray(directory.entries))directory.entries=directory.entries.map(e=>({...e,symbol:typeof e.symbol==='string'?e.symbol.toUpperCase():e.symbol,stStatus:e.stStatus??'unknown'}));
  return {valid:true,snapshot:{version:1,synthetic:input.synthetic===true,generation:input.runId,targetSession,calendarVersion,policyVersion,directory,frames:structuredClone(input.frames),stocks},diagnostics,availableSeries};
}
