/** Shared typed quality contract. Call only after the public safe-JSON boundary. */
import { validDate, isoClock } from './provenance.js';
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const finiteOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v));
const integer = v => Number.isInteger(v) && v >= 0 && v <= 2000;
const unknown = v => v === 'unknown';
const noPIT = v => v === false;
const label = v => validDate(v) || isoClock(v) !== null;
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const COVERAGE = {
  requested:v=>integer(v)&&v>0, returned:integer, first_date:validDate, last_date:validDate,
  full_history:noPIT, calendar_unverified_rows:integer,
  missing_scheduled_session_dates:v=>Array.isArray(v)&&v.length<=2000&&v.every(validDate)&&new Set(v).size===v.length,
  calendar_gaps_unverified:v=>typeof v==='boolean', missing_session_note:str
};
const CACHE = {used:v=>v===true,scope:v=>v==='explicit_local_dataset'};
const RAW_BAR = {date:validDate,source_timestamp:label,open:finiteOrNull,high:finiteOrNull,low:finiteOrNull,close:finiteOrNull,volume_shares:finiteOrNull,amount_cny:v=>v===null,complete:v=>typeof v==='boolean',calendar_completion:v=>v===null||typeof v==='boolean',completion_basis:str,period_end_session:validDate,observed_latest:v=>v===null||typeof v==='boolean',source_finality:unknown};
const BAR = {date:validDate,periodStart:validDate,periodEnd:validDate,completion:v=>['complete','partial','unknown'].includes(v),sourceKey:str,adjustment:v=>typeof v==='string',open:finiteOrNull,high:finiteOrNull,low:finiteOrNull,close:finiteOrNull,volume_shares:finiteOrNull,amount_cny:v=>v===null,sourceTimestamp:label,sourceFinality:unknown,calendarCompletion:v=>v===null||typeof v==='boolean',completionBasis:str,observedLatest:v=>v===null||typeof v==='boolean'};
const SERIES = {status:v=>v==='ready',datasetId:str,targetSession:validDate,calendarVersion:str,policyVersion:str,requestStartedAt:v=>isoClock(v)!==null,completionCutoff:v=>isoClock(v)!==null,fetchedAt:v=>isoClock(v)!==null,sourceTimestamp:label,sourceKey:str,adjustment:v=>typeof v==='string',currency:v=>typeof v==='string',volumeUnit:v=>typeof v==='string',volumeBasis:v=>v==='provider_unadjusted_reported_volume',contentHash:hash,sourceFinality:unknown,pointInTime:noPIT,bars:v=>Array.isArray(v)&&v.length<=2000,coverage:object,completionEvidence:object,cache:object};
const RAW = {dataset_id:str,symbol:v=>typeof v==='string'&&/^(sh|sz)\d{6}$/i.test(v),source:str,interval:v=>['1d','1w','1mo'].includes(v),adjustment:v=>['none','qfq'].includes(v),target_session:validDate,calendar_version:str,policy_version:str,content_hash:hash,request_started_at:v=>isoClock(v)!==null,completion_cutoff:v=>isoClock(v)!==null,fetched_at:v=>isoClock(v)!==null,source_timestamp:label,bars:v=>Array.isArray(v)&&v.length<=2000,coverage:object,units:object,source_finality:unknown,point_in_time:noPIT,cache:object,warnings:v=>Array.isArray(v)&&v.length<=64&&v.every(str)};
function check(value,spec,path,errors,partial,optional=[]) {
  if(!object(value)){errors.push({code:'QUALITY_OBJECT_REQUIRED',path,message:`${path}须为对象`,failure:true});return false;}
  for(const key of Object.keys(value))if(!own(spec,key))errors.push({code:'QUALITY_UNKNOWN_FIELD',path:`${path}.${key}`,message:`${path}.${key}不在质量白名单`,failure:true});
  for(const [key,valid] of Object.entries(spec)){
    if(!own(value,key)){if(!partial&&!optional.includes(key))errors.push({code:'QUALITY_MISSING_FIELD',path:`${path}.${key}`,message:`缺质量字段${path}.${key}`,failure:true});}
    else if(!valid(value[key]))errors.push({code:'QUALITY_INVALID_FIELD',path:`${path}.${key}`,message:`质量字段${path}.${key}类型或值非法`,failure:true});
  }
  return true;
}
function proof(value,errors,partial) {
  if(!object(value)){errors.push({code:'QUALITY_OBJECT_REQUIRED',path:'series.completionEvidence',message:'缺完成证据对象',failure:true});return;}
  const spec=value.kind==='calendar'?{kind:v=>v==='calendar',verifiedFrom:validDate,verifiedThrough:validDate}:{kind:v=>['synthetic','unknown'].includes(v)};
  check(value,spec,'series.completionEvidence',errors,partial);
  if(value.kind==='calendar'&&validDate(value.verifiedFrom)&&validDate(value.verifiedThrough)&&value.verifiedFrom>value.verifiedThrough)errors.push({code:'QUALITY_RANGE_INVALID',path:'series.completionEvidence',message:'完成证据范围倒置',failure:true});
}
export function validateDatasetQuality(value,{portable=false,partial=false}={}) {
  const errors=[],root=portable?'dataset':'series',spec=portable?RAW:SERIES;
  if(!object(value))return [{code:'QUALITY_OBJECT_REQUIRED',path:root,message:'数据质量对象缺失',failure:true}];
  if(!portable&&value.status==='error') {check(value,{status:v=>v==='error',errorCode:str},root,errors,partial);return errors;}
  check(value,spec,root,errors,partial,portable?['warnings']:['cache']);
  if(own(value,'coverage')&&object(value.coverage))check(value.coverage,COVERAGE,`${root}.coverage`,errors,partial);
  if(own(value,'cache')&&object(value.cache))check(value.cache,CACHE,`${root}.cache`,errors,partial);
  if(portable&&own(value,'units')&&object(value.units))check(value.units,{price:v=>v==='CNY',volume:v=>v==='shares; provider unadjusted reported volume',amount:v=>v==='unavailable=null'},`${root}.units`,errors,partial);
  if(!portable&&own(value,'completionEvidence'))proof(value.completionEvidence,errors,partial);
  if(Array.isArray(value.bars))for(let i=0;i<value.bars.length;i++)check(value.bars[i],portable?RAW_BAR:BAR,`${root}.bars[${i}]`,errors,partial);
  if(!partial&&errors.length===0&&Array.isArray(value.bars)){
    let last='';
    for(const b of value.bars){
      if(b.date<=last){errors.push({code:'MALFORMED_BARS',path:`${root}.bars`,message:'K线日期须严格递增，不能重复',failure:true});break;}last=b.date;
      for(const key of ['open','high','low','close','volume_shares'])if(b[key]!==null&&(b[key]<0||(key!=='volume_shares'&&b[key]===0)))errors.push({code:'INVALID_FIELD',path:`${root}.bars.${key}`,message:'价格须正数、成交量不能为负',failure:true});
      if(['open','high','low','close'].every(k=>typeof b[k]==='number')&&(b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low>b.high))errors.push({code:'INVALID_OHLC',path:`${root}.bars`,message:'OHLC上下界关系非法',failure:true});
    }
    const c=value.coverage;
    if(c.returned!==value.bars.length||c.returned>c.requested||c.calendar_unverified_rows>c.returned||(value.bars.length&&(c.first_date!==value.bars[0].date||c.last_date!==value.bars.at(-1).date)))errors.push({code:'QUALITY_COVERAGE_CONTRADICTION',path:`${root}.coverage`,message:'返回根数/请求数/首末日期/未验证根数不一致',failure:true});
  }
  return errors;
}
export const QUALITY_FIELDS = Object.freeze({series:Object.keys(SERIES),portable:Object.keys(RAW),bar:Object.keys(BAR),portableBar:Object.keys(RAW_BAR),coverage:Object.keys(COVERAGE),cache:Object.keys(CACHE)});
