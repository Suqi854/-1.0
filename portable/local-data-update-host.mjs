// Explicit Node host factory only. No schedule, store opening, personal key/list
// read or source call occurs merely by importing or constructing this wrapper.
import {types as nodeTypes} from 'node:util';
import {isTrustedLocalDatabase} from './sqlite.mjs';
import {isTrustedLocalOHLCVStore} from './ohlcv-store.mjs';
import {isTrustedLocalPublicLoaderForEnv} from './local-public-loader.mjs';
import {createLocalOHLCVUpdater} from './ohlcv-updater.mjs';
import {readJSONInput} from '../modules/condition-screen/src/json-input.js';
const activeByEnv=new WeakMap();
function options(value){if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('INVALID_LOCAL_DATA_HOST_OPTIONS');const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(!['store','loader','now'].includes(key)||!('value'in d)||!d.enumerable)throw Error('INVALID_LOCAL_DATA_HOST_OPTIONS');out[key]=d.value;}return out;}
export function createLocalDataUpdateHost(env,input){
 if(!isTrustedLocalDatabase(env))throw Error('TRUSTED_LOCAL_SQLITE_REQUIRED');
 const {store,loader,now=()=>Date.now()}=options(input);
 function trusted(){if(!isTrustedLocalDatabase(env)||!isTrustedLocalOHLCVStore(store)||!isTrustedLocalPublicLoaderForEnv(env,loader))throw Error('TRUSTED_LOCAL_DATA_HOST_REQUIRED');}
 trusted();if(typeof now!=='function')throw Error('INVALID_LOCAL_HOST_CLOCK');
 function guardedNow(){trusted();let value;try{value=now();}catch{trusted();throw Error('INVALID_LOCAL_HOST_CLOCK');}trusted();if(!Number.isSafeInteger(value)||value<0||value>8640000000000000-300000)throw Error('INVALID_LOCAL_HOST_CLOCK');return value;}
 const guardedStore=Object.freeze(Object.fromEntries(['prepare','read','acquire','commit','release','pause'].map(k=>[k,(...args)=>{trusted();return store[k](...args);}])));
 const base=createLocalOHLCVUpdater({runtime:'local',store:guardedStore,now:guardedNow,loadSeries:(...args)=>{trusted();return loader.loadSeries(...args);}});
 async function prepare(input,options){trusted();if(options!==undefined){const parsed=readJSONInput(options);if(!parsed.valid)throw Error('INVALID_LOCAL_PREPARE_OPTIONS');options=parsed.value;}return base.prepare(input,options);}
 async function advance(id,options){
  trusted();const parsed=readJSONInput(options??{});if(!parsed.valid||!parsed.value||typeof parsed.value!=='object'||Array.isArray(parsed.value)||Object.keys(parsed.value).some(k=>k!=='retry_failed'))throw Error('INVALID_LOCAL_ADVANCE_OPTIONS');options=parsed.value;if(activeByEnv.has(env))return {...await base.status(id),reason:'local_host_busy',request_count:0,actual_http_attempts:0,timer_registered:false};
  const control=new AbortController(),reservation={id,control};let failed=false,before;
  // Own admission before any caller clock runs, including loader.status().
  activeByEnv.set(env,reservation);
  // Reservation and construction can invoke the supplied clock. They belong
  // inside the cleanup boundary just like a pending request does.
  try{trusted();before=loader.status();trusted();loader.setPostcloseActive(true);
   const updater=createLocalOHLCVUpdater({runtime:'local',store:guardedStore,now:guardedNow,loadSeries:(symbol,opts)=>{trusted();return loader.loadSeries(symbol,{...opts,signal:AbortSignal.any([opts.signal,control.signal])});}});
   const result=await updater.advance(id,options);trusted();const after=loader.status();return {...result,source_budget:after,actual_http_attempts:after.http_attempts-before.http_attempts,actual_http_attempts_scope:'all shared source calls during this invocation; includes concurrent fast quotes',timer_registered:false};
  }catch(error){failed=true;throw error;}
  finally{control.abort();if(activeByEnv.get(env)===reservation){try{if(isTrustedLocalDatabase(env)&&isTrustedLocalPublicLoaderForEnv(env,loader))loader.setPostcloseActive(false);}catch(error){if(!failed)throw error;}finally{if(activeByEnv.get(env)===reservation)activeByEnv.delete(env);}}}
 }
 async function status(id){trusted();return {...await base.status(id),source_budget:loader.status(),timer_registered:false};}
 async function pause(id,paused=true){trusted();if(paused===true&&activeByEnv.get(env)?.id===id)activeByEnv.get(env).control.abort();return base.pause(id,paused);}
 async function readDataset(id,symbol,key){trusted();return base.readDataset(id,symbol,key);}
 return Object.freeze({prepare,advance,status,pause,readDataset});
}
