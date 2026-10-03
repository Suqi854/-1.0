import {containsCredentialEcho} from './hithink-redaction.mjs';
// Official provider contract; this is a code-table page, never a quotation or screen.
export const DIRECTORY_CONTRACT='https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/meta/tickers-list.md';
export const DIRECTORY_ENDPOINT='https://fuyao.aicubes.cn/api/meta/tickers/list';
export const DIRECTORY_LIMITS=Object.freeze({default:100,max:10000,browser_max:200,max_offset:1000000,body_bytes:8*1024*1024,paged_body_bytes:300000,timeout_ms:15000});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const codePattern=/^(sh(600|601|603|605|688|689)\d{3}|sz(000|001|002|003|004|300|301)\d{3}|bj[489]\d{5})$/;
export function directoryArguments(a={}){
 if(!plain(a)||Object.keys(a).some(k=>!['offset','limit','expected_snapshot_timestamp'].includes(k)))throw Error('INVALID_DIRECTORY_ARGUMENTS');
 const offset=a.offset===undefined?0:a.offset,limit=a.limit===undefined?DIRECTORY_LIMITS.default:a.limit;
 if(!Number.isSafeInteger(offset)||offset<0||offset>DIRECTORY_LIMITS.max_offset||!Number.isSafeInteger(limit)||limit<1||limit>DIRECTORY_LIMITS.max)throw Error('INVALID_DIRECTORY_PAGINATION');
 if(a.expected_snapshot_timestamp!==undefined&&(!Number.isSafeInteger(a.expected_snapshot_timestamp)||a.expected_snapshot_timestamp<=0))throw Error('INVALID_DIRECTORY_SNAPSHOT');
 return {offset,limit,...(a.expected_snapshot_timestamp!==undefined?{expected_snapshot_timestamp:a.expected_snapshot_timestamp}:{})};
}
function date(v){
 if(v===undefined||v===null)return null;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('DIRECTORY_INVALID_DATE');
 return v;
}
const warnings=['SOURCE_PAGE_ONLY_NOT_A_SCREEN_OR_COMPLETE_UNIVERSE','TOTAL_AND_HISTORICAL_MEMBERSHIP_UNVERIFIED','LISTING_SUSPENSION_DELISTING_ST_AND_TRADABILITY_UNKNOWN','ST_NAME_HINT_IS_NOT_OFFICIAL_STATUS','END_DATE_IS_CONTRACT_EXPIRY_NOT_DELISTING','SNAPSHOT_LOAD_TIME_IS_NOT_QUOTE_OR_EXCHANGE_TIME','OFFSET_PAGINATION_ORDER_AND_ATOMIC_SNAPSHOT_NOT_GUARANTEED'];
function metadata(a){return {source:'hithink',source_endpoint:DIRECTORY_ENDPOINT,contract:DIRECTORY_CONTRACT,asset_type:'a-share',request:{offset:a.offset,limit:a.limit,expected_snapshot_timestamp:a.expected_snapshot_timestamp??null},read_only:true,cloud_bridge_requests:false};}
export function unavailableDirectory(a,status,diagnostics=null){return {...metadata(a),available:false,data_status:status,items:[],source_timestamp:null,snapshot_timestamp:null,fetched_at:null,coverage:null,...(diagnostics?{diagnostics}:{}),warnings:[...warnings,status==='not_configured'?'ACCOUNT_CREDENTIAL_REQUIRED':status==='settings_unavailable'?'ACCOUNT_SETTINGS_UNAVAILABLE':'DIRECTORY_REQUEST_FAILED_NO_PARTIAL_RESULTS']};}
export function parseStockDirectory(root,args={},now=Date.now()){
 const a=directoryArguments(args);
 if(!plain(root)||root.code!==0)throw Error('DIRECTORY_BUSINESS_ERROR');
 const d=root.data;
 if(!plain(d)||!Array.isArray(d.item)||d.item.length>a.limit||!Number.isSafeInteger(d.timestamp)||d.timestamp<=0||d.timestamp>now+5000)throw Error('DIRECTORY_INVALID_RESPONSE');
 if(a.expected_snapshot_timestamp!==undefined&&a.expected_snapshot_timestamp!==d.timestamp)throw Error('DIRECTORY_SNAPSHOT_CHANGED');
 const seen=new Set();
 const items=d.item.map(r=>{
  if(!plain(r)||r.asset_type!=='a-share'||!['SH','SZ','BJ'].includes(r.exchange)||typeof r.ticker!=='string'||!/^\d{6}$/.test(r.ticker)||r.thscode!==r.ticker+'.'+r.exchange)throw Error('DIRECTORY_IDENTITY_MISMATCH');
  const symbol=r.exchange.toLowerCase()+r.ticker;
  if(seen.has(symbol))throw Error('DIRECTORY_DUPLICATE_IDENTITY');seen.add(symbol);
  if(typeof r.name!=='string'||!r.name.trim()||r.name.length>80||/[\u0000-\u001f\u007f]/.test(r.name))throw Error('DIRECTORY_INVALID_NAME');
  if(r.currency!==undefined&&r.currency!=='CNY')throw Error('DIRECTORY_INVALID_CURRENCY');
  return {symbol,market_data_supported:codePattern.test(symbol),warnings:codePattern.test(symbol)?[]:['MARKET_DATA_SYMBOL_SYNTAX_UNSUPPORTED'],thscode:r.thscode,ticker:r.ticker,market:r.exchange,name:r.name.trim(),asset_type:'a-share',list_date:date(r.list_date),end_date:date(r.end_date),last_trade_date:date(r.last_trade_date),last_delivery_date:date(r.last_delivery_date),status:{listing:'unknown',delisting:'unknown',suspension:'unknown',st:'unknown',tradability:'unknown'},name_hints:{st_prefix:/^\*?ST/i.test(r.name.trim()),evidence:'display_name_only_not_official_status'}};
 });
 const full=items.length===a.limit,supported=items.filter(r=>r.market_data_supported).length;
 return {...metadata(a),available:true,data_status:'ready',items,snapshot_timestamp:d.timestamp,source_timestamp:new Date(d.timestamp).toISOString(),source_timestamp_semantics:'upstream_code_table_snapshot_load_time',fetched_at:new Date(now).toISOString(),freshness:{status:'unknown',reason:'Provider documents upstream snapshot loading time; table update cadence and constituent effective dates are unverified',snapshot_load_age_seconds:(now-d.timestamp)/1000},coverage:{scope:'single_source_page',retrieval_mode:a.limit>DIRECTORY_LIMITS.browser_max?'bounded_bulk':'bounded_page',source_response_count:1,provider_directory_end_from_start_observed:a.offset===0&&!full,exchange_directory_completeness:'unverified',requested_offset:a.offset,requested_limit:a.limit,returned_count:items.length,market_data_supported_count:supported,market_data_unsupported_count:items.length-supported,source_page_end_observed:!full,next_offset:full&&a.offset+a.limit<=DIRECTORY_LIMITS.max_offset?a.offset+a.limit:null,more_pages:'unknown',continuation_within_bound:!full||a.offset+a.limit<=DIRECTORY_LIMITS.max_offset,total:null,total_status:'not_provided_by_documented_contract',complete_universe:false,snapshot_match:a.expected_snapshot_timestamp===undefined?'not_checked':'matches_requested_timestamp',cross_page_uniqueness:'not_checked',ordering_and_atomicity:'unverified'},field_semantics:{market_data_supported:'local_quote_and_screen_symbol_syntax_only_not_source_availability_or_listing_status',end_date:'contract_expiry_date_not_delisting_date',last_trade_date:'provider_last_trade_date_not_verified_delisting_or_current_tradability'},warnings:[...warnings,...(supported<items.length?['SOURCE_IDENTITIES_RETAINED_WITH_UNSUPPORTED_MARKET_DATA_SYNTAX']:[]),...(!full?['SHORT_PAGE_IS_PROVIDER_END_CONDITION_NOT_PROOF_OF_MARKET_COMPLETENESS']:[]),...(full&&a.offset+a.limit>DIRECTORY_LIMITS.max_offset?['CONTINUATION_REQUIRES_OFFSET_BEYOND_LOCAL_BOUND']:[])]};
}
const errorKinds=new Set(['DIRECTORY_REDIRECT','DIRECTORY_RATE_LIMIT','DIRECTORY_HTTP_ERROR','DIRECTORY_NON_JSON','DIRECTORY_TIMEOUT','DIRECTORY_BUSINESS_ERROR','DIRECTORY_INVALID_RESPONSE','DIRECTORY_SNAPSHOT_CHANGED','DIRECTORY_IDENTITY_MISMATCH','DIRECTORY_UNSUPPORTED_IDENTITY','DIRECTORY_DUPLICATE_IDENTITY','DIRECTORY_INVALID_NAME','DIRECTORY_INVALID_DATE','DIRECTORY_INVALID_CURRENCY','DIRECTORY_RESPONSE_TOO_LARGE','DIRECTORY_SENSITIVE_RESPONSE']);
// Credential-bearing source invocation is excluded from this public profile.
