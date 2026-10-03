import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const localDatabaseInstances=new WeakSet();
export function isTrustedLocalDatabase(value){return localDatabaseInstances.has(value);}
export function openLocalDatabase(path){
 const sql=new DatabaseSync(path,{timeout:5000});sql.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)');
 const localDDL=readFileSync(fileURLToPath(new URL('./manual-observations.sql',import.meta.url)),'utf8');
 sql.exec('BEGIN IMMEDIATE');try{sql.exec(localDDL);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');sql.close();throw e;}
 const prepare=query=>{const statement=sql.prepare(query);function bound(args){return {bind:(...a)=>bound(a),run:async()=>({success:true,meta:{changes:statement.run(...args).changes}}),first:async()=>statement.get(...args)??null,all:async()=>({results:statement.all(...args)}),_run:()=>statement.run(...args)}}return bound([])};
 const local={DB:{prepare,batch:async statements=>{sql.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>({success:true,meta:{changes:s._run().changes}}));sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e;}}},close:()=>{localDatabaseInstances.delete(local);sql.close();}};
 Object.freeze(local.DB);Object.freeze(local);localDatabaseInstances.add(local);return local;
}
