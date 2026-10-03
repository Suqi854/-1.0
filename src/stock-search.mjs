import {contextFetchText} from './context-fetch.mjs';
export function searchQuery(value){
 if(typeof value!=='string')throw Error('请输入股票名称或代码');
 const q=value.trim();
 if(!q||q.length>40||! /^[\p{Script=Han}A-Za-z0-9 *．.\-]+$/u.test(q))throw Error('请输入 1–40 字的股票名称或代码');
 return q;
}
function suggestionRows(text,normalize){
 const match=/^\s*v_hint\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/.exec(text);
 if(!match)throw Error('搜索来源格式变化，请稍后重试');
 const value=JSON.parse(match[1]);if(value==='N'||value==='')return {items:[],truncated:false};
 const rows=value.split('^'),result=[];
 for(const row of rows.slice(0,100)){
  const [exchange,code,name,,type]=row.split('~');
  if(type!=='GP-A'||!['sh','sz','bj'].includes(exchange)||!/^\d{6}$/.test(code??'')||!name||name.length>80||/[<>\x00-\x1f]/.test(name))continue;
  let s;try{s=normalize(exchange+code);}catch{continue;}
  if(s!==exchange+code)continue;
  result.push({symbol:s,name,exchange,source:'tencent'});
 }
 return {items:result,truncated:rows.length>100};
}
export function parseSuggestions(text,normalize){
 const seen=new Set();
 return suggestionRows(text,normalize).items.filter(item=>{if(seen.has(item.symbol))return false;seen.add(item.symbol);return true;}).slice(0,20);
}
export async function searchStocks(query,{normalize,fetchText=contextFetchText}={}){
 const q=searchQuery(query);
 const text=await fetchText('https://smartbox.gtimg.cn/s3/?q='+encodeURIComponent(q)+'&t=all',{timeoutMs:6500});
 return {query:q,items:parseSuggestions(text,normalize),source:'tencent',fetched_at:new Date().toISOString(),scope:'Provider suggestions only, maximum 20 A-share matches; not a complete security directory. No price or trading-status inference. Names and symbols rechecked on watchlist add.'};
}
// Used only by get_quotes: other tools keep their strict code-only contract.
// NFKC/case/space normalization preserves ST/*ST, A/B and punctuation markers.
const normalizedName=value=>value.normalize('NFKC').replace(/ /g,'').toUpperCase();
const resolutionScope='Exact normalized name and unique symbol among bounded Tencent A-share suggestions only; not a complete security directory, current listing status or trading-eligibility verification.';
const resolutionError=(entry,code,message,candidates=[])=>({...entry,status:'unresolved',error:{code,message},candidates});
const uniqueIdentities=items=>{
 const seen=new Set();
 return items.filter(item=>{const key=item.symbol+'|'+normalizedName(item.name);if(seen.has(key))return false;seen.add(key);return true;});
};
async function beforeDeadline(operation,remaining,code){
 if(remaining<=0)throw Error(code);
 let timer;
 try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),remaining);})]);}
 finally{clearTimeout(timer);}
}
function quoteInput(value,normalize){
 try{return {query:value,symbol:normalize(value),kind:'code',status:'resolved'};}
 catch(error){
  // Invalid codes, pinyin, arbitrary URLs and non-string values never become searches.
  if(typeof value!=='string'||!/[\p{Script=Han}]/u.test(value))throw error;
  const query=searchQuery(value.normalize('NFKC'));
  return {query:value.trim(),lookup_query:normalizedName(query),kind:'name'};
 }
}
async function resolveName(entry,{normalize,fetchText,deadline,now}){
 try{
  const remaining=deadline-now();
  const text=await beforeDeadline(()=>fetchText('https://smartbox.gtimg.cn/s3/?q='+encodeURIComponent(entry.lookup_query)+'&t=all',{timeoutMs:remaining}),remaining,'NAME_RESOLUTION_TIMEOUT');
  if(now()>=deadline)throw Error('NAME_RESOLUTION_TIMEOUT');
  const parsed=suggestionRows(text,normalize),identities=uniqueIdentities(parsed.items);
  const exact=identities.filter(item=>normalizedName(item.name)===entry.lookup_query);
  const candidates=[...exact,...identities.filter(item=>!exact.includes(item))].slice(0,20);
  if(parsed.truncated)return resolutionError(entry,'STOCK_SEARCH_TRUNCATED','Search response exceeds the checked candidate limit; provide an exact stock code.',candidates);
  if(!exact.length)return resolutionError(entry,'STOCK_NAME_NOT_FOUND','No exact stock-name match in returned suggestions; choose a candidate code or provide the full current name.',candidates);
  const symbols=new Set(exact.map(item=>item.symbol));
  if(symbols.size!==1||identities.some(item=>symbols.has(item.symbol)&&normalizedName(item.name)!==entry.lookup_query))return resolutionError(entry,'STOCK_NAME_AMBIGUOUS','Name or symbol identity is ambiguous in returned suggestions; choose an exact stock code.',candidates);
  return {...entry,status:'resolved',symbol:exact[0].symbol,matched_name:exact[0].name,source:'tencent',candidates};
 }catch(error){
  return resolutionError(entry,error?.message==='NAME_RESOLUTION_TIMEOUT'?'NAME_RESOLUTION_TIMEOUT':'STOCK_SEARCH_UNAVAILABLE','Stock-name search could not be verified within this request; retry or provide an exact stock code.');
 }
}

/**
 * Retains existing quote batches and code-only behavior. Name lookups and any
 * explicit-code quote batch run concurrently; a second quote batch contains only
 * uniquely resolved names not already requested by code. Every stage shares the
 * original deadline, with no search/quote retries or arbitrary provider hosts.
 */
export async function quotesForStockQueries(inputs,includeBook,{normalize,fetchQuotes,fetchText=contextFetchText,now=Date.now,deadlineMs=6500}={}){
 if(!Array.isArray(inputs)||inputs.length<1||inputs.length>20)throw Error('SYMBOLS_MUST_HAVE_1_TO_20_ITEMS');
 if(!Number.isFinite(deadlineMs)||deadlineMs<1||deadlineMs>6500)throw Error('INVALID_QUOTE_DEADLINE');
 // Complete validation before starting any upstream request.
 const entries=inputs.map(value=>quoteInput(value,normalize));
 const codeSymbols=[...new Set(entries.filter(entry=>entry.kind==='code').map(entry=>entry.symbol))];
 if(entries.every(entry=>entry.kind==='code'))return fetchQuotes(codeSymbols,includeBook,{deadlineMs,now});
 const started=now(),deadline=started+deadlineMs;
 const quoteBatch=async symbols=>{
  if(!symbols.length)return null;
  const remaining=deadline-now();
  try{return await beforeDeadline(()=>fetchQuotes(symbols,includeBook,{deadlineMs:remaining,now}),remaining,'SHARED_DEADLINE_EXCEEDED');}
  catch{return {quotes:symbols.map(symbol=>({symbol,error:{code:'QUOTE_UNAVAILABLE',message:'Quote request did not complete within the shared request budget.'},fetched_at:new Date(now()).toISOString()})),cache:{used:false},warnings:[]};}
 };
 const codePending=quoteBatch(codeSymbols);
 const lookups=new Map();
 for(const entry of entries)if(entry.kind==='name'&&!lookups.has(entry.lookup_query))lookups.set(entry.lookup_query,resolveName(entry,{normalize,fetchText,deadline,now}));
 const resolved=await Promise.all([...lookups.values()]);
 // Conflicting identities across individual search responses also fail closed.
 for(const entry of resolved)if(entry.status==='resolved'&&resolved.some(other=>other.status==='resolved'&&other.symbol===entry.symbol&&other.lookup_query!==entry.lookup_query)){
  const candidates=uniqueIdentities(resolved.filter(other=>other.symbol===entry.symbol).flatMap(other=>other.candidates??[])).slice(0,20);
  // Mark in a separate pass below, so one failure cannot hide the next conflict.
  entry.conflicting_candidates=candidates;
 }
 for(let i=0;i<resolved.length;i++)if(resolved[i].conflicting_candidates){const {conflicting_candidates,...entry}=resolved[i];resolved[i]=resolutionError(entry,'STOCK_NAME_AMBIGUOUS','Separate name searches returned conflicting identities for one symbol; choose an exact stock code.',conflicting_candidates);}
 const codeSet=new Set(codeSymbols);
 const namedSymbols=[...new Set(resolved.filter(entry=>entry.status==='resolved'&&!codeSet.has(entry.symbol)).map(entry=>entry.symbol))];
 const [codeResult,nameResult]=await Promise.all([codePending,quoteBatch(namedSymbols)]);
 const allQuotes=[...(codeResult?.quotes??[]),...(nameResult?.quotes??[])];
 const quotesBySymbol=new Map(allQuotes.map(quote=>[quote.symbol,quote]));
 const resolvedByQuery=new Map(resolved.map(entry=>[entry.lookup_query,entry]));
 const quotes=[],seen=new Set(),resolutionItems=[];
 for(const input of entries){
  let entry=input.kind==='code'?input:{...resolvedByQuery.get(input.lookup_query),query:input.query};
  const quote=entry.status==='resolved'?quotesBySymbol.get(entry.symbol):null;
  // A search identity is never proof that a later quote still has that name.
  if(entry.kind==='name'&&entry.status==='resolved'&&quote&&!quote.error&&
    (typeof quote.name!=='string'||normalizedName(quote.name)!==entry.lookup_query)){
   entry=resolutionError(entry,'STOCK_NAME_QUOTE_MISMATCH','Returned quote name differs from the resolved name; verify the stock code before continuing.',entry.candidates);
  }
  resolutionItems.push(entry);
  const key=entry.status==='resolved'?'symbol:'+entry.symbol:'query:'+(entry.lookup_query??entry.query);
  if(seen.has(key))continue;seen.add(key);
  if(entry.status!=='resolved')quotes.push({query:entry.query,error:entry.error,candidates:entry.candidates,fetched_at:new Date(now()).toISOString()});
  else quotes.push(quote??{symbol:entry.symbol,error:{code:'QUOTE_UNAVAILABLE',message:'No verified quote returned for the resolved stock.'},fetched_at:new Date(now()).toISOString()});
 }
 const batches=[codeResult,nameResult].filter(Boolean);
 return {quotes,cache:{used:false},
  routing:{...(batches[0]?.routing??{mode:'name_resolution_only',providers:[]}),deadline_ms:deadlineMs,elapsed_ms:Math.max(0,now()-started),quote_batches:batches.map(batch=>batch.routing??{status:'unavailable'})},
  name_resolution:{source:'tencent',policy:'exact_normalized_name_unique_symbol',scope:resolutionScope,items:resolutionItems},
  warnings:[...new Set([...batches.flatMap(batch=>batch.warnings??[]),'STOCK_NAME_SEARCH_IS_BOUNDED; use exact stock codes if identity is uncertain',...(!batches.length?['NO_QUOTES_REQUESTED_FOR_UNRESOLVED_NAMES']:[])])]};
}

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function browserStockSearch(req,dependencies={}){return accountStockSearch(req,req.headers.get('oai-authenticated-user-id'),dependencies);}
export async function accountStockSearch(req,owner,{normalize,fetchText}={}){
 if(!owner)return json({error:{message:'请先登录此站点后重试'}},401);
 if(req.method!=='POST')return json({error:{message:'Method not allowed'}},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:{message:'不允许跨站请求'}},403);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:{message:'Expected application/json'}},415);
 let q;try{const t=await req.text();if(t.length>500)throw Error();const a=JSON.parse(t);if(!a||Array.isArray(a)||Object.keys(a).length!==1||!Object.hasOwn(a,'query'))throw Error();q=searchQuery(a.query);}catch{return json({error:{message:'请输入 1–40 字的股票名称或代码'}},400);}
 try{return json({data:await searchStocks(q,{normalize,fetchText})});}catch{return json({error:{message:'名称搜索来源暂不可用，请稍后重试，也可直接按代码添加'}},503);}
}
