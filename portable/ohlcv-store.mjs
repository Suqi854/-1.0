// Explicitly opened local SQLite only; no server route, timer or default file.
import {DatabaseSync} from 'node:sqlite';
export function openLocalOHLCVStore(path){
 if(typeof path!=='string'||!path)throw Error('EXPLICIT_LOCAL_STORE_PATH_REQUIRED');
 const db=new DatabaseSync(path,{timeout:5000});
 db.exec('CREATE TABLE IF NOT EXISTS local_ohlcv_runs(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0,fence INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS local_ohlcv_items(run_id TEXT NOT NULL,symbol TEXT NOT NULL,entry TEXT NOT NULL,datasets TEXT NOT NULL,PRIMARY KEY(run_id,symbol))');
 const manifest=id=>{const row=db.prepare('SELECT manifest,paused FROM local_ohlcv_runs WHERE id=?').get(id);return row?{manifest:JSON.parse(row.manifest),paused:row.paused===1}:null;};
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 const store={
  prepare:async value=>{db.prepare('INSERT INTO local_ohlcv_runs(id,manifest) VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(value.run_id,JSON.stringify(value));},
  read:async(id,{symbols=[]}={})=>{const saved=manifest(id);if(!saved)return null;const rows=db.prepare('SELECT symbol,entry FROM local_ohlcv_items WHERE run_id=? ORDER BY symbol').all(id);const requested=[...new Set(symbols)];if(requested.length>20)throw Error('LOCAL_DATASET_READ_BOUND');const datasets=Object.fromEntries(requested.map(symbol=>{const row=db.prepare('SELECT datasets FROM local_ohlcv_items WHERE run_id=? AND symbol=?').get(id,symbol);return [symbol,row?JSON.parse(row.datasets):{}];}));return {...saved,items:rows.map(x=>JSON.parse(x.entry)),datasets};},
  acquire:async(id,now,until)=>transaction(()=>{const changed=db.prepare('UPDATE local_ohlcv_runs SET fence=fence+1,lease_until=? WHERE id=? AND paused=0 AND lease_until<=?').run(until,id,now).changes;if(!changed)return null;return db.prepare('SELECT fence FROM local_ohlcv_runs WHERE id=?').get(id).fence;}),
  commit:async(id,fence,symbol,entry,datasets,now)=>transaction(()=>{const live=db.prepare('SELECT manifest FROM local_ohlcv_runs WHERE id=? AND fence=? AND paused=0 AND lease_until>?').get(id,fence,now);if(!live)return false;if(!JSON.parse(live.manifest).items.some(x=>x.symbol===symbol))throw Error('LOCAL_ITEM_NOT_IN_MANIFEST');db.prepare('INSERT INTO local_ohlcv_items(run_id,symbol,entry,datasets) VALUES(?,?,?,?) ON CONFLICT(run_id,symbol) DO UPDATE SET entry=excluded.entry,datasets=excluded.datasets').run(id,symbol,JSON.stringify(entry),JSON.stringify(datasets));return true;}),
  release:async(id,fence)=>{db.prepare('UPDATE local_ohlcv_runs SET lease_until=0 WHERE id=? AND fence=?').run(id,fence);},
  pause:async(id,paused)=>{db.prepare('UPDATE local_ohlcv_runs SET paused=?,fence=fence+1,lease_until=0 WHERE id=?').run(paused?1:0,id);},
  close:()=>db.close()
 };
 return Object.freeze(store);
}
