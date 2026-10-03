export async function contextFetchText(url,{fetchImpl=fetch,timeoutMs=6500}={}){
 const controller=new AbortController();let timer;
 try{return await Promise.race([(async()=>{const r=await fetchImpl(url,{headers:{Referer:'https://finance.sina.com.cn','User-Agent':'Mozilla/5.0'},redirect:'manual',cache:'no-store',signal:controller.signal});if(r.status>=300&&r.status<400)throw Error('UPSTREAM_REDIRECT_REJECTED');if(!r.ok)throw Error('UPSTREAM_HTTP_'+r.status);const b=await r.arrayBuffer();if(b.byteLength>1000000)throw Error('UPSTREAM_RESPONSE_TOO_LARGE');return new TextDecoder('gb18030').decode(b);})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('UPSTREAM_TIMEOUT'));},timeoutMs);})]);}finally{clearTimeout(timer);}
}
