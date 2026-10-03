// Best-effort isolate memory only. No persistent storage or background polling.
const dayCN=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const transient=e=>/UPSTREAM_HTTP_(429|500|502|503|504)|UPSTREAM_TIMEOUT|fetch failed|network/i.test(e.message);
export function createAuctionRouter({parse,fetchImpl=(...a)=>fetch(...a),now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=6000,cooldownMs=30000,maxCacheAgeMs=1200000}={}){
  const snapshots=new Map(),pending=new Map();let blockedUntil=0;
  function fallback(symbol,reason,started,attempts){const t=now(),d=snapshots.get(symbol),age=d?t-Date.parse(d.fetched_at):Infinity;
    if(!d||d.session_date!==dayCN(t)||age<0||age>maxCacheAgeMs)throw Error(reason);
    const sourceAge=Math.round((t-Date.parse(d.source_timestamp))/1000);
    return {...d,served_at:new Date(t).toISOString(),freshness:{...d.freshness,status:'cached_snapshot',age_seconds:sourceAge},request_latency_ms:t-started,cache:{used:true,scope:'worker_isolate_memory',reason,age_seconds:Math.round(age/1000),max_age_seconds:maxCacheAgeMs/1000,same_session_date_only:true},request:{attempts,circuit_open:blockedUntil>t,retry_after_seconds:Math.max(0,Math.ceil((blockedUntil-t)/1000))},warnings:[...d.warnings,'LAST_GOOD_SAME_DAY_SNAPSHOT_NOT_LIVE']};
  }
  async function run(symbol){const started=now();if(blockedUntil>started)return fallback(symbol,'AUCTION_SOURCE_COOLDOWN',started,0);let attempts=0;
    try{let raw;for(let i=0;i<2;i++){attempts++;const controller=new AbortController();let timer;try{
      raw=await Promise.race([(async()=>{const r=await fetchImpl('https://push2delay.eastmoney.com/api/qt/stock/trends2/get?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=1&iscca=0&secid='+(symbol.startsWith('sh')?'1.':'0.')+symbol.slice(2),{headers:{},redirect:'manual',signal:controller.signal,cache:'no-store'});if(r.status>=300&&r.status<400)throw Error('UPSTREAM_REDIRECT_REJECTED');if(!r.ok)throw Error('UPSTREAM_HTTP_'+r.status);const b=await r.arrayBuffer();if(b.byteLength>1000000)throw Error('UPSTREAM_RESPONSE_TOO_LARGE');return new TextDecoder().decode(b);})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('UPSTREAM_TIMEOUT'));},timeoutMs);})]);break;
    }catch(e){if(i===1||!transient(e)||/429/.test(e.message))throw e;await wait(250);}finally{clearTimeout(timer);}}
    const t=now(),d=parse(raw,symbol,t);if(d.points.length&&!d.points.some(p=>p.source_timestamp.slice(0,10)!==d.session_date)&&d.session_date===dayCN(t)&&Date.parse(d.source_timestamp)<=t+5000){snapshots.delete(symbol);snapshots.set(symbol,d);while(snapshots.size>64)snapshots.delete(snapshots.keys().next().value);}
    blockedUntil=0;return {...d,served_at:new Date(t).toISOString(),request_latency_ms:t-started,cache:{used:false},request:{attempts,circuit_open:false,retry_after_seconds:0}};
    }catch(e){if(transient(e))blockedUntil=now()+cooldownMs;return fallback(symbol,e.message,started,attempts);}}
  return symbol=>{if(pending.has(symbol))return pending.get(symbol);const p=run(symbol).finally(()=>pending.delete(symbol));pending.set(symbol,p);return p;};
}
