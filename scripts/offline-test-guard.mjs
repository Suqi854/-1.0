// Test-process egress guard. Mocked fetch remains usable; only real loopback
// sockets are allowed for the existing standalone-runtime tests.
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
let blocked=0;
const local=host=>['127.0.0.1','::1','[::1]'].includes(host);
function deny(){blocked++;throw Error('OFFLINE_TEST_EGRESS_BLOCKED');}
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,options){
 let url;try{url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);}catch{return deny();}
 if(!local(url.hostname))return deny();
 return originalFetch(input,options);
};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const options=Array.isArray(args[0])?args[0][0]:args[0];
 const host=options&&typeof options==='object'?options.host:typeof args[1]==='string'?args[1]:null;
 if(!local(host))return deny();
 return connect.apply(this,args);
};
const tlsConnect=tls.connect;
tls.connect=function(...args){
 const options=args.find(a=>a&&typeof a==='object'&&!Array.isArray(a));
 if(!local(options?.host))return deny();
 return tlsConnect.apply(this,args);
};
syncBuiltinESMExports();
process.on('exit',()=>{if(blocked){process.stderr.write('Offline test guard blocked '+blocked+' attempted real outbound request(s).\n');process.exitCode=1;}});
