// Pure local evidence bridge. No source request, credential, DB, timer or strategy.
import {readJSONInput} from '../modules/condition-screen/src/json-input.js';
import {isoClock} from '../modules/condition-screen/src/provenance.js';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const iso=x=>isoClock(x)!==null;
const cn=x=>new Date(Date.parse(x)+28800000).toISOString().slice(0,10),copy=x=>structuredClone(x);
async function sha(x){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const error=code=>({valid:false,error_codes:[code]});
export async function buildLocalNameObservations(input){
 const decoded=readJSONInput(input);if(!decoded.valid)return error('NAME_OBSERVATION_JSON_INVALID');input=decoded.value;
 try{
  if(!obj(input)||Object.keys(input).some(k=>!['directory','quotes','target_session'].includes(k))||!date(input.target_session)||!obj(input.directory)||!Array.isArray(input.directory.entries)||input.directory.entries.length<1||input.directory.entries.length>10000||!hash(input.directory.researchIdentity?.research_universe_hash)||!Array.isArray(input.quotes)||input.quotes.length>10000)return error('NAME_OBSERVATION_INPUT_INVALID');
  const entries=input.directory.entries;if(entries.some(e=>!obj(e)||typeof e.symbol!=='string'||!/^(SH|SZ)\d{6}$/.test(e.symbol)||typeof e.name!=='string')||new Set(entries.map(e=>e.symbol)).size!==entries.length)return error('NAME_OBSERVATION_POOL_INVALID');
  const quotes=new Map();for(const q of input.quotes){if(!obj(q)||typeof q.symbol!=='string')return error('NAME_OBSERVATION_QUOTE_INVALID');const symbol=q.symbol.toUpperCase();if(!entries.some(e=>e.symbol===symbol)||quotes.has(symbol))return error('NAME_OBSERVATION_QUOTE_SCOPE');quotes.set(symbol,q);}
  const rows=[],updated=[];let observed=0;
  for(const e of entries){const q=quotes.get(e.symbol),r=q?.observation_receipt;let state='missing_quote';let receipt=null,observedName=null;
   if(q&&!q.error){state='invalid_receipt';if(obj(r)&&['tencent','sina'].includes(q.source)&&r.source===q.source&&iso(q.source_timestamp)&&iso(r.request_started_at)&&iso(r.fetched_at)&&Date.parse(r.fetched_at)>=Date.parse(r.request_started_at)&&Date.parse(r.fetched_at)-Date.parse(r.request_started_at)<=6500&&cn(r.request_started_at)===input.target_session&&Date.parse(q.source_timestamp)<=Date.parse(r.fetched_at)+5000&&hash(r.raw_body_sha256)&&hash(r.quote_binding_sha256)&&typeof q.name==='string'&&q.name.length>0&&q.name.length<=80&&!/[\x00-\x1f\x7f]/.test(q.name)&&await sha([q.symbol,q.name,q.source,q.source_timestamp])===r.quote_binding_sha256){receipt={source:r.source,source_timestamp:q.source_timestamp,request_started_at:r.request_started_at,fetched_at:r.fetched_at,raw_body_sha256:r.raw_body_sha256,quote_binding_sha256:r.quote_binding_sha256};observedName=q.name.normalize('NFKC').trim();state=cn(q.source_timestamp)!==input.target_session||cn(r.fetched_at)!==input.target_session?'stale_quote':/^\*?ST/i.test(observedName)?'observed_st_name':observedName!==e.name.normalize('NFKC').trim()?'name_changed':'fresh_name';if(state!=='stale_quote')observed++;}}
   const observedAt=receipt?new Date(Date.parse(receipt.fetched_at)+28800000).toISOString().replace('Z','+08:00'):null;
   const row={symbol:e.symbol,approved_name:e.name,observed_name:observedName,state,receipt,official_st_status:e.stStatus??'unknown',official_tradability:'unknown',actionable:false};rows.push(row);
   const entry=copy(e);if(state==='fresh_name'){entry.nameObservation={asOf:input.target_session,observedAt,provider:q.source,stPrefixObserved:false,receipt};}else if(state==='observed_st_name'){entry.name=observedName;entry.nameObservation={asOf:input.target_session,observedAt,provider:q.source,stPrefixObserved:true,receipt};}else{delete entry.nameObservation;}
   // Never turn a name hint into an official status or silently delete a member.
   updated.push(entry);
  }
  const counts={total:entries.length,fresh_name:0,observed_st_name:0,name_changed:0,missing_quote:0,stale_quote:0,invalid_receipt:0};for(const r of rows)counts[r.state]++;
  const proof={version:'local-name-observation-v1',target_session:input.target_session,research_universe_hash:input.directory.researchIdentity.research_universe_hash,rows};const identity_observation_hash=await sha(proof);
  const directory=copy(input.directory);directory.entries=updated;if(observed)directory.asOf=input.target_session;directory.sourceNotes=(directory.sourceNotes??'')+'; approved research membership unchanged; local name observation hash '+identity_observation_hash+'; official status/finality unknown';
  return {valid:true,...proof,identity_observation_hash,counts,condition_directory:directory,research_membership_unchanged:true,official_directory_verified:false,source_finality:'unknown',point_in_time:false};
 }catch{return error('NAME_OBSERVATION_INPUT_INVALID');}
}
