import {SINA_SECTORS,parseSinaSectors} from './sector-context.mjs';
export const stockPageUrl=s=>'https://finance.sina.com.cn/realstock/company/'+s+'/nc.shtml';
// Provider-owned stock page explicitly links its industry-comparison classification.
// This is Sina's taxonomy, not an inferred SW/CSRC/Eastmoney equivalent.
export function parseMembership(html,s,fetched=Date.now()){
 if(!/^(sh|sz|bj)\d{6}$/.test(s))throw Error('INVALID_MEMBERSHIP_SYMBOL');
 const identities=[...html.matchAll(/\bvar\s+papercode\s*=\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
 if(identities.length!==1||identities[0]!==s)throw Error('MEMBERSHIP_PAGE_IDENTITY_MISMATCH');
 const codes=[...html.matchAll(/href=["']https:\/\/finance\.sina\.com\.cn\/data\/index\.html#stock-schq-hsgs-xlhy\/(new_[a-z0-9]+)["'][^>]*>\s*行业对比\s*<\/a>/g)].map(m=>m[1]);
 if(codes.length!==1)throw Error('MEMBERSHIP_CLASSIFICATION_UNAVAILABLE');
 const code=codes[0],links=[...html.matchAll(/href=["']https?:\/\/vip\.stock\.finance\.sina\.com\.cn\/mkt\/#(new_[a-z0-9]+)["'][^>]*>([^<>]+)<\/a>/g)].filter(m=>m[1]===code);
 if(links.length!==1||!links[0][2].trim())throw Error('MEMBERSHIP_LABEL_UNAVAILABLE');
 return {code,name:links[0][2].trim(),source:'sina',taxonomy:'Sina industry-comparison classification; may contain legacy or thematic categories; not equivalent to SW, CSRC or Eastmoney',evidence_url:stockPageUrl(s),classification_url:'https://finance.sina.com.cn/data/index.html#stock-schq-hsgs-xlhy/'+code,verification:'Exact stock page identity and matching industry-comparison / classification links',effective_date:null,source_timestamp:null,fetched_at:new Date(fetched).toISOString(),freshness:{status:'unknown',reason:'Provider page supplies no classification effective date or update time'}};
}
export async function stockContext(s,fetchText,now=Date.now){
 const attempt=async(fn)=>{try{return {data:await fn()};}catch(e){return {error:String(e.message).slice(0,180)};}};
 const [m,c]=await Promise.all([attempt(async()=>parseMembership(await fetchText(stockPageUrl(s)),s,now())),attempt(async()=>parseSinaSectors(await fetchText(SINA_SECTORS),now()))]);
 let membership=m.data??null,sector=null,error=c.error??null;
 if(membership&&c.data){const selected=c.data.sectors.find(x=>x.code===membership.code);if(!selected)error='MEMBERSHIP_NOT_IN_SECTOR_UNIVERSE';else if(selected.name!==membership.name)error='MEMBERSHIP_SECTOR_LABEL_MISMATCH';else sector={...selected,rank_descending:c.data.sectors.length===49?1+c.data.sectors.filter(x=>x.change_percent>selected.change_percent).length:null,rank_method:c.data.sectors.length===49?'competition rank among 49 validated returned categories in one response; equal changes share rank; no exhaustive economic universe claim':'rank unavailable: returned classification count differs from validated 49-category baseline',universe_size:c.data.sectors.length,source_endpoint:SINA_SECTORS};}
 return {symbol:s,source:'sina',fetched_at:new Date(now()).toISOString(),membership,sector_context:sector,available:!!membership&&!!sector,errors:{membership:m.error??null,sector_context:error},history:{available:false,bars:[],reason:'No verified historical series for this exact Sina classification; stock history and other-provider industry indices cannot substitute'},security_status:{suspension_status:'unknown',reason:'No verified per-security halt/resume enum from this source; membership and sector data do not establish tradability'},warnings:['PROVIDER_CLASSIFICATION_NOT_ECONOMIC_INDUSTRY_INFERENCE','CLASSIFICATION_EFFECTIVE_DATE_AND_SECTOR_TIMESTAMP_UNKNOWN','FETCH_TIME_IS_NOT_SOURCE_TIME; do not call this realtime sector strength','NO_CROSS_PROVIDER_TAXONOMY_MAPPING_OR_STOCK_MINUS_SECTOR_RETURN','CLASSIFICATION_AND_SECTOR_REQUESTS_NOT_ATOMIC','NO_VERIFIED_SECTOR_HISTORY','PUBLIC_ENDPOINT_COVERAGE_AND_LICENSE_UNVERIFIED']};
}
