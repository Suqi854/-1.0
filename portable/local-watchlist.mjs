// NodeSQLite-only private preference state. Imported only by the explicit loopback host.
import {isTrustedLocalDatabase} from './sqlite.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function db(env){if(!isTrustedLocalDatabase(env))throw Error('TRUSTED_LOCAL_SQLITE_REQUIRED');return env.DB;}
export async function listWatchlist(env,owner,after=''){
  const d=db(env),rows=(await d.prepare('SELECT symbol,name,verified_at FROM watchlist WHERE owner=? AND symbol>? ORDER BY symbol LIMIT 101').bind(owner,after).all()).results;
  const selected=await d.prepare('SELECT w.symbol,w.name,w.verified_at FROM watchlist_preferences p JOIN watchlist w ON w.owner=p.owner AND w.symbol=p.selected_symbol WHERE p.owner=?').bind(owner).first();
  const total=await d.prepare('SELECT COUNT(*) AS total FROM watchlist WHERE owner=?').bind(owner).first();
  return {items:rows.slice(0,100),selected:selected??null,total:total.total,has_more:rows.length>100,next_after:rows.length>100?rows[99].symbol:null};
}
export async function changeWatchlist(env,owner,action,s,verify){
  const d=db(env);
  if(action==='add'){
    const old=await d.prepare('SELECT symbol FROM watchlist WHERE owner=? AND symbol=?').bind(owner,s).first();
    if(!old){const q=await verify(s);if(q?.symbol!==s||typeof q.name!=='string'||!q.name.trim()||q.name.length>100||q.error)throw Error('未能从行情源核实此代码及名称，未添加；请检查代码或稍后重试');
      await d.prepare('INSERT INTO watchlist(owner,symbol,name,verified_at) VALUES(?,?,?,?) ON CONFLICT(owner,symbol) DO NOTHING').bind(owner,s,q.name.trim(),new Date().toISOString()).run();}
  }else if(action==='remove'){
    await d.batch([d.prepare('DELETE FROM watchlist WHERE owner=? AND symbol=?').bind(owner,s),d.prepare('UPDATE watchlist_preferences SET selected_symbol=NULL WHERE owner=? AND selected_symbol=?').bind(owner,s)]);
  }else if(action==='select'){
    await d.prepare('INSERT INTO watchlist_preferences(owner,selected_symbol) SELECT owner,symbol FROM watchlist WHERE owner=? AND symbol=? ON CONFLICT(owner) DO UPDATE SET selected_symbol=excluded.selected_symbol').bind(owner,s).run();
  }else throw Error('不支持的自选操作');
  const result=await listWatchlist(env,owner);if(action==='add')result.changed=await d.prepare('SELECT symbol,name,verified_at FROM watchlist WHERE owner=? AND symbol=?').bind(owner,s).first();return result;
}
export async function accountWatchlist(req,env,owner,dependencies){
  if(!isTrustedLocalDatabase(env))return json({error:{code:'TRUSTED_LOCAL_SQLITE_REQUIRED',message:'Private preferences require local SQLite'}},503);
  const {symbol,verify}=dependencies;
  const localURL=new URL(req.url);if(localURL.protocol!=='http:'||localURL.hostname!=='127.0.0.1')return json({error:{message:'LOCAL_LOOPBACK_REQUIRED'}},403);
  if(!owner)return json({error:{message:'请先登录此站点后重试'}},401);
  if(req.method!=='POST')return json({error:{message:'Method not allowed'}},405);
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:{message:'不允许跨站请求'}},403);
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:{message:'Expected application/json'}},415);
  let a;try{const t=await req.text();if(t.length>2000)throw Error();a=JSON.parse(t);if(!a||Array.isArray(a)||Object.keys(a).some(k=>!['action','symbol','after'].includes(k)))throw Error();if(!['list','add','remove','select'].includes(a.action))throw Error();if(a.action==='list'){if(a.symbol!==undefined)throw Error();if(a.after!==undefined&&a.after!=='')a.after=symbol(a.after);}else{if(a.after!==undefined)throw Error();a.symbol=symbol(a.symbol);}}catch{return json({error:{message:'代码或自选参数不正确，请输入支持的六位 A 股代码'}},400);}
  try{return json({data:a.action==='list'?await listWatchlist(env,owner,a.after):await changeWatchlist(env,owner,a.action,a.symbol,verify)});}catch(e){console.error('Watchlist request failed',e?.name);return json({error:{message:'自选操作未确认完成。可重新读取自选核对后重试；代码需由行情源核实。'}},503);}
}
