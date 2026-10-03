import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quotesForStockQueries,parseSuggestions} from '../src/stock-search.mjs';
import {symbol,callData} from '../src/worker.mjs';

const wrap=value=>'v_hint='+JSON.stringify(value)+';';
const row=(symbol,name)=>`${symbol.slice(0,2)}~${symbol.slice(2)}~${name}~ignored~GP-A`;
const names={sh600522:'中天科技',sh600584:'长电科技',sz000001:'平安银行'};
const success=symbols=>({quotes:symbols.map(symbol=>({symbol,name:names[symbol]??'测试名称',price:10})),cache:{used:false},routing:{mode:'parallel',providers:['tencent','sina'],deadline_ms:6500,elapsed_ms:0},warnings:['EXISTING_WARNING']});
function dependencies(overrides={}){
 const calls={search:[],quotes:[]};
 return {calls,options:{normalize:symbol,
  fetchText:async(url,options)=>{calls.search.push({url,options});return wrap(row('sh600522','中天科技'));},
  fetchQuotes:async(symbols,book,options)=>{calls.quotes.push({symbols,book,options});return success(symbols);},
  ...overrides}};
}

test('code-only normalization and unique batch output preserve the existing result contract',async()=>{
 const expected=success(['sh600522','sz000001']);
 const {calls,options}=dependencies({fetchQuotes:async(symbols,book,options)=>{calls.quotes.push({symbols,book,options});return expected;}});
 const actual=await quotesForStockQueries([' 600522.SH ','SH600522','000001','sz000001'],false,options);
 assert.equal(actual,expected);assert.equal(calls.search.length,0);assert.deepEqual(calls.quotes[0].symbols,['sh600522','sz000001']);assert.equal(calls.quotes[0].book,false);assert.equal(calls.quotes[0].options.deadlineMs,6500);
});

test('invalid code-like, pinyin, non-string and unsafe values reject before any request',async()=>{
 for(const bad of ['000001.SH','sh000001','hk00700','6000000','510300','600522,sz000001','https://evil.test/中天',null,600522,'ZTkj','中天\n科技','中天'+'a'.repeat(40),'中天<script>']){
  const {calls,options}=dependencies();
  await assert.rejects(()=>quotesForStockQueries(['600522',bad],true,options));
  assert.equal(calls.search.length,0,String(bad));assert.equal(calls.quotes.length,0,String(bad));
 }
});

test('batch size remains bounded at twenty before any requests',async()=>{
 for(const values of [[],Array(21).fill('中天科技'),null,'中天科技']){
  const {calls,options}=dependencies();await assert.rejects(()=>quotesForStockQueries(values,true,options),/SYMBOLS_MUST_HAVE_1_TO_20_ITEMS/);assert.deepEqual(calls,{search:[],quotes:[]});
 }
 const {calls,options}=dependencies();await quotesForStockQueries(Array(20).fill('中天科技'),false,options);assert.equal(calls.search.length,1);assert.equal(calls.quotes.length,1);
});

test('exact Chinese name alone resolves through only the fixed encoded Tencent URL',async()=>{
 const {calls,options}=dependencies();const data=await quotesForStockQueries(['中天科技'],true,options);
 assert.equal(calls.search.length,1);assert.equal(calls.search[0].url,'https://smartbox.gtimg.cn/s3/?q=%E4%B8%AD%E5%A4%A9%E7%A7%91%E6%8A%80&t=all');
 assert.deepEqual(calls.quotes[0].symbols,['sh600522']);assert.equal(data.quotes[0].symbol,'sh600522');assert.equal(data.name_resolution.items[0].matched_name,'中天科技');assert.equal(data.name_resolution.policy,'exact_normalized_name_unique_symbol');assert.match(data.name_resolution.scope,/not a complete security directory/);
});

test('spaces, compatible width and Latin case normalize without stripping ST markers',async()=>{
 const {calls,options}=dependencies({fetchText:async(url,options)=>{calls.search.push({url,options});return wrap(row('sh600522','*ST 中天'));},fetchQuotes:async(symbols,book,options)=>{calls.quotes.push({symbols,book,options});return {...success(symbols),quotes:[{symbol:'sh600522',name:'*st中天',price:10}]};}});
 const data=await quotesForStockQueries([' ＊ｓｔ中天 ','*ST 中 天'],true,options);
 assert.equal(calls.search.length,1);assert.equal(calls.quotes.length,1);assert.equal(data.quotes.length,1);assert.equal(data.quotes[0].symbol,'sh600522');assert.equal(data.name_resolution.items.length,2);
 const other=dependencies({fetchText:async()=>wrap(row('sh600522','*ST中天'))});const no=await quotesForStockQueries(['中天'],false,other.options);assert.equal(no.quotes[0].error.code,'STOCK_NAME_NOT_FOUND');assert.equal(other.calls.quotes.length,0);
});

test('partial name returns candidate identities and does not fetch a guessed quote',async()=>{
 const {calls,options}=dependencies({fetchText:async()=>wrap(row('sh600522','中天科技')+'^'+row('sz002188','中天服务'))});
 const data=await quotesForStockQueries(['中天'],false,options);
 assert.equal(calls.quotes.length,0);assert.equal(data.quotes[0].error.code,'STOCK_NAME_NOT_FOUND');assert.deepEqual(data.quotes[0].candidates.map(item=>[item.symbol,item.name]),[['sh600522','中天科技'],['sz002188','中天服务']]);assert.equal(data.routing.mode,'name_resolution_only');assert.ok(data.warnings.includes('NO_QUOTES_REQUESTED_FOR_UNRESOLVED_NAMES'));
});

test('exact duplicate name on distinct symbols is ambiguous rather than first-candidate wins',async()=>{
 const {calls,options}=dependencies({fetchText:async()=>wrap(row('sh600522','同名公司')+'^'+row('sh600584','同名公司'))});
 const data=await quotesForStockQueries(['同名公司'],true,options);assert.equal(data.quotes[0].error.code,'STOCK_NAME_AMBIGUOUS');assert.equal(data.quotes[0].candidates.length,2);assert.equal(calls.quotes.length,0);
});

test('same-symbol conflicting names are not hidden by the browser suggestion deduplication',async()=>{
 const raw=wrap(row('sh600522','旧名称')+'^'+row('sh600522','中天科技'));
 assert.equal(parseSuggestions(raw,symbol).length,1);
 const {calls,options}=dependencies({fetchText:async()=>raw});const data=await quotesForStockQueries(['中天科技'],true,options);
 assert.equal(data.quotes[0].error.code,'STOCK_NAME_AMBIGUOUS');assert.equal(data.quotes[0].candidates.length,2);assert.equal(calls.quotes.length,0);
});

test('repeated identical identity rows do not manufacture ambiguity',async()=>{
 const {calls,options}=dependencies({fetchText:async()=>wrap(row('sh600522','中天科技')+'^'+row('sh600522','中 天科技'))});
 const data=await quotesForStockQueries(['中天科技'],false,options);assert.equal(data.quotes[0].symbol,'sh600522');assert.equal(calls.quotes.length,1);
});

test('non-A-share, invalid code, wrong exchange and malformed source rows never resolve',async()=>{
 const {calls,options}=dependencies({fetchText:async()=>wrap('hk~00700~测试名称~a~GP^sh~000001~测试名称~a~ZS^sz~600522~测试名称~a~GP-A^sh~999999~测试名称~a~GP-A^sh~600522~<测试名称>~a~GP-A')});
 const data=await quotesForStockQueries(['测试名称'],true,options);assert.equal(data.quotes[0].error.code,'STOCK_NAME_NOT_FOUND');assert.deepEqual(data.quotes[0].candidates,[]);assert.equal(calls.quotes.length,0);
});

test('empty results differ from failed or malformed search and never trigger quote requests',async()=>{
 for(const [fetchText,code] of [[async()=>wrap('N'),'STOCK_NAME_NOT_FOUND'],[async()=>{throw Error('private provider detail');},'STOCK_SEARCH_UNAVAILABLE'],[async()=>wrap('N')+'alert(1)','STOCK_SEARCH_UNAVAILABLE'],[async()=>'<html>error</html>','STOCK_SEARCH_UNAVAILABLE']]){
  const {calls,options}=dependencies({fetchText});const data=await quotesForStockQueries(['中天科技'],true,options);assert.equal(data.quotes[0].error.code,code);assert.equal(calls.quotes.length,0);assert.ok(!JSON.stringify(data).includes('private provider detail'));
 }
});

test('inspect candidates beyond the twenty displayed suggestions before unique resolution',async()=>{
 const many=Array.from({length:20},(_,i)=>row('sh'+String(600000+i),'其他名称'+i));
 const {calls,options}=dependencies({fetchText:async()=>wrap([...many,row('sh600522','中天科技'),row('sh600584','中天科技')].join('^'))});
 const data=await quotesForStockQueries(['中天科技'],false,options);assert.equal(data.quotes[0].error.code,'STOCK_NAME_AMBIGUOUS');assert.equal(data.quotes[0].candidates.length,20);assert.deepEqual(data.quotes[0].candidates.slice(0,2).map(item=>item.symbol),['sh600522','sh600584']);assert.equal(calls.quotes.length,0);
});

test('oversized candidate sets cannot hide an unchecked second identity',async()=>{
 const raw=wrap([row('sh600522','中天科技'),...Array(99).fill(row('sh600584','其他名称')),row('sz000001','中天科技')].join('^'));
 const {calls,options}=dependencies({fetchText:async()=>raw});const data=await quotesForStockQueries(['中天科技'],false,options);assert.equal(data.quotes[0].error.code,'STOCK_SEARCH_TRUNCATED');assert.equal(calls.quotes.length,0);
});

test('separate searches with conflicting names for one code fail closed',async()=>{
 const {calls,options}=dependencies({fetchText:async url=>wrap(row('sh600522',new URL(url).searchParams.get('q')))});
 const data=await quotesForStockQueries(['中天科技','旧名称'],false,options);assert.deepEqual(data.quotes.map(quote=>quote.error.code),['STOCK_NAME_AMBIGUOUS','STOCK_NAME_AMBIGUOUS']);assert.equal(calls.quotes.length,0);
});

test('mixed code, resolved name and unresolved name retain independent partial results',async()=>{
 const {calls,options}=dependencies({fetchText:async url=>new URL(url).searchParams.get('q')==='长电科技'?wrap(row('sh600584','长电科技')):wrap(row('sh600522','中天科技'))});
 const data=await quotesForStockQueries(['000001','长电科技','中天'],false,options);
 assert.deepEqual(calls.quotes.map(call=>call.symbols),[['sz000001'],['sh600584']]);assert.deepEqual(data.quotes.map(quote=>quote.symbol??quote.query),['sz000001','sh600584','中天']);assert.equal(data.quotes[2].error.code,'STOCK_NAME_NOT_FOUND');assert.equal(data.routing.deadline_ms,6500);assert.equal(data.routing.quote_batches.length,2);assert.ok(data.warnings.includes('EXISTING_WARNING'));
});

test('code and matching name share their existing quote without refetching',async()=>{
 const {calls,options}=dependencies();const data=await quotesForStockQueries(['中天科技','600522','中天 科技'],true,options);
 assert.equal(calls.search.length,1);assert.equal(calls.quotes.length,1);assert.equal(data.quotes.length,1);assert.equal(data.name_resolution.items.length,3);
});

test('a differing returned quote name suppresses name-based quote output',async()=>{
 const {calls,options}=dependencies({fetchQuotes:async symbols=>({...success(symbols),quotes:[{symbol:'sh600522',name:'另一家公司',price:10}]})});
 const data=await quotesForStockQueries(['中天科技'],true,options);assert.equal(data.quotes[0].error.code,'STOCK_NAME_QUOTE_MISMATCH');assert.equal(data.quotes[0].price,undefined);assert.equal(data.name_resolution.items[0].status,'unresolved');assert.equal(calls.search.length,1);
});

test('name/quote mismatch does not suppress an explicitly requested valid stock code',async()=>{
 const {options}=dependencies({fetchQuotes:async symbols=>({...success(symbols),quotes:[{symbol:'sh600522',name:'另一家公司',price:10}]})});
 const data=await quotesForStockQueries(['中天科技','600522'],true,options);assert.equal(data.quotes[0].error.code,'STOCK_NAME_QUOTE_MISMATCH');assert.equal(data.quotes[1].symbol,'sh600522');assert.equal(data.quotes[1].price,10);
});

test('quote-stage deadline excludes the time consumed by name resolution',async()=>{
 let clock=1000;
 const {calls,options}=dependencies({now:()=>clock,fetchText:async(url,options)=>{calls.search.push({url,options});clock+=1200;return wrap(row('sh600522','中天科技'));}});
 const data=await quotesForStockQueries(['中天科技'],false,options);
 assert.equal(calls.search[0].options.timeoutMs,6500);assert.equal(calls.quotes[0].options.deadlineMs,5300);assert.equal(data.routing.elapsed_ms,1200);assert.equal(data.routing.deadline_ms,6500);
});

test('expired search budget starts no quote request',async()=>{
 let clock=1000;
 const {calls,options}=dependencies({now:()=>clock,deadlineMs:30,fetchText:async()=>{clock+=30;return wrap(row('sh600522','中天科技'));}});
 const data=await quotesForStockQueries(['中天科技'],false,options);assert.equal(data.quotes[0].error.code,'NAME_RESOLUTION_TIMEOUT');assert.equal(calls.quotes.length,0);
});

test('all name searches start concurrently and have bounded wall-clock duration',async()=>{
 const {calls,options}=dependencies({deadlineMs:25,fetchText:(url,options)=>{calls.search.push({url,options});return new Promise(()=>{});}});
 const began=Date.now(),pending=quotesForStockQueries(['中天科技','长电科技'],false,options);assert.equal(calls.search.length,2);
 const data=await pending;assert.ok(Date.now()-began<500);assert.deepEqual(data.quotes.map(quote=>quote.error.code),['NAME_RESOLUTION_TIMEOUT','NAME_RESOLUTION_TIMEOUT']);assert.equal(calls.quotes.length,0);
});

test('a stalled name cannot erase or delay a completed explicit-code quote beyond the shared budget',async()=>{
 const {calls,options}=dependencies({deadlineMs:25,fetchText:()=>new Promise(()=>{})});
 const began=Date.now(),pending=quotesForStockQueries(['000001','中天科技'],false,options);assert.equal(calls.quotes.length,1);
 const data=await pending;assert.ok(Date.now()-began<500);assert.equal(data.quotes[0].symbol,'sz000001');assert.equal(data.quotes[0].price,10);assert.equal(data.quotes[1].error.code,'NAME_RESOLUTION_TIMEOUT');assert.equal(calls.quotes.length,1);
});

test('name-resolved quote failure remains a quote error rather than a name lookup failure',async()=>{
 const {options}=dependencies({fetchQuotes:async symbols=>({...success(symbols),quotes:symbols.map(symbol=>({symbol,error:{code:'QUOTE_UNAVAILABLE',message:'Both providers failed'}}))})});
 const data=await quotesForStockQueries(['中天科技'],false,options);assert.equal(data.quotes[0].error.code,'QUOTE_UNAVAILABLE');assert.equal(data.name_resolution.items[0].status,'resolved');
});

// These are local synthetic requests and historical fixtures, never live data.
// The public providers deliver GB18030, so passing UTF-8 Response text would
// corrupt names and accidentally exercise the mismatch branch instead.
function gb18030QuoteFixture(file){
 const line=readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8').split('\n')[0];
 const parts=line.split('合成测试A');assert.equal(parts.length,2);
 assert.ok(parts.every(part=>/^[\x00-\x7f]*$/.test(part)));
 return Buffer.concat([Buffer.from(parts[0],'ascii'),Buffer.from('bacfb3c9b2e2cad441','hex'),Buffer.from(parts[1],'ascii')]);
}
const asciiSearchFixture=rows=>wrap(rows).replace(/[\u0080-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));

test('worker get_quotes callData resolves an exact Chinese name with GB18030 fixtures and canonical provider URLs',async()=>{
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls.push(String(url));assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  if(String(url).startsWith('https://smartbox.gtimg.cn/s3/?'))return new Response(asciiSearchFixture(row('sh600522','合成测试A')));
  if(url==='https://qt.gtimg.cn/q=sh600522')return new Response(gb18030QuoteFixture('tencent_snapshot.txt'));
  if(url==='https://hq.sinajs.cn/list=sh600522')return new Response(gb18030QuoteFixture('sina_snapshot.txt'));
  throw Error('UNEXPECTED_TEST_URL');
 };
 try{
  const data=await callData({name:'get_quotes',arguments:{symbols:['合成测试A'],include_book:false}},{});
  assert.equal(data.quotes[0].error,undefined);assert.equal(data.quotes[0].symbol,'sh600522');assert.equal(data.quotes[0].name,'合成测试A');assert.equal(data.quotes[0].price,20);assert.equal(data.quotes[0].source,'tencent');
  assert.equal(data.name_resolution.items[0].status,'resolved');assert.equal(data.name_resolution.items[0].matched_name,'合成测试A');assert.ok(data.service.tool_names.includes('get_quotes'));
  assert.deepEqual(calls,['https://smartbox.gtimg.cn/s3/?q=%E5%90%88%E6%88%90%E6%B5%8B%E8%AF%95A&t=all','https://qt.gtimg.cn/q=sh600522','https://hq.sinajs.cn/list=sh600522']);
 }finally{globalThis.fetch=original;}
});

test('worker get_quotes callData retains ambiguity candidates without fetching any quote source',async()=>{
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async url=>{calls.push(String(url));assert.ok(String(url).startsWith('https://smartbox.gtimg.cn/s3/?'));return new Response(asciiSearchFixture(row('sh600522','同名公司')+'^'+row('sh600584','同名公司')));};
 try{
  const data=await callData({name:'get_quotes',arguments:{symbols:['同名公司']}},{});
  assert.equal(data.quotes[0].query,'同名公司');assert.equal(data.quotes[0].error.code,'STOCK_NAME_AMBIGUOUS');assert.equal(data.quotes[0].price,undefined);
  assert.deepEqual(data.quotes[0].candidates.map(item=>[item.symbol,item.name]),[['sh600522','同名公司'],['sh600584','同名公司']]);assert.equal(data.name_resolution.items[0].status,'unresolved');assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});
