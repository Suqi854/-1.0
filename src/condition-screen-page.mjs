import {conditionScreenAssets} from './condition-screen-assets.mjs';
const prefix='/condition-screen/';
export const conditionScreenPanel='<section class="card condition-entry"><div class="row"><h2>多条件编辑 · 合成验证</h2><a class="condition-link" href="/condition-screen/ui/index.html" target="_blank" rel="noopener noreferrer" aria-label="打开条件编辑器（新窗口，合成数据）">打开条件编辑器</a></div><p class="data-note">仅合成演示：真实行业龙头池与日 / 周 / 月数据尚未接入。可组合条件并逐条查看依据，规则在浏览器内运算、下载；真实池及私人条件留在本地。</p></section>';
export const CONDITION_CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
export function conditionScreenResponse(req){
 const path=new URL(req.url).pathname;if(path!=='/condition-screen'&&!path.startsWith(prefix))return null;
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','content-security-policy':CONDITION_CSP,'referrer-policy':'no-referrer'};
 if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
 if(path==='/condition-screen'||path===prefix)return new Response(null,{status:302,headers:{...headers,location:prefix+'ui/index.html'}});
 const key=path.slice(prefix.length);if(!Object.hasOwn(conditionScreenAssets,key))return new Response('Not found',{status:404,headers});
 const type=key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':'application/javascript';
 return new Response(req.method==='HEAD'?null:conditionScreenAssets[key],{headers:{...headers,'content-type':type+'; charset=utf-8'}});
}
