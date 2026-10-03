// Copies a reviewed exact current-tree allowlist into a fresh directory.
// No Git, network, upload, credential/config lookup, database or deployment.
import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out'||!isAbsolute(args[1]))throw Error('Usage: node scripts/export-public-source.mjs --out <new-absolute-directory>');
const out=resolve(args[1]);if(out===root||out.startsWith(root+sep)||existsSync(out))throw Error('EXPORT_REQUIRES_NEW_DIRECTORY_OUTSIDE_SOURCE');
// A lexical destination can still traverse a symlink back into source/private
// storage. Every existing output ancestor must be a real directory.
for(let at=dirname(out);;at=dirname(at)){const entry=lstatSync(at);if(entry.isSymbolicLink()||!entry.isDirectory())throw Error('EXPORT_OUTPUT_ANCESTOR_FORBIDDEN');if(at===dirname(at))break;}
const realParent=realpathSync(dirname(out)),realRoot=realpathSync(root);if(realParent===realRoot||realParent.startsWith(realRoot+sep))throw Error('EXPORT_DESTINATION_INSIDE_SOURCE');
const manifest=JSON.parse(readFileSync(join(root,'docs/public-export-manifest.json'),'utf8'));
if(manifest.version!==1||manifest.copy_git_history!==false||manifest.requirements?.real_market_data_export!==false||manifest.requirements?.private_condition_export!==false||!Array.isArray(manifest.current_file_inventory)||!manifest.current_file_inventory.length)throw Error('REVIEWED_EXACT_EXPORT_INVENTORY_REQUIRED');
const forbiddenFiles=new Set(['cloudflare/wrangler.jsonc','cloudflare/01-cloudflare-login.cmd','cloudflare/02-cloudflare-deploy.cmd','cloudflare/部署说明.md','portable/本地运行说明.md','scripts/build-cloudflare.mjs','docs/background-collector-deployment.md','docs/cloud-bridge.md']);
function safePath(path){if(typeof path!=='string'||isAbsolute(path)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..')||/[\x00-\x1f]/.test(path)||forbiddenFiles.has(path)||/(^|\/)(?:\.git|\.env[^/]*|\.aws|\.codex|\.agents|\.sites-runtime|\.cloudflare-tools|node_modules|local-data|\.wrangler|outputs|work)(\/|$)/.test(path)||/\.(?:sqlite(?:-wal|-shm|-journal)?|db|pem|key)$/i.test(path))throw Error('UNSAFE_EXPORT_PATH');return path;}
function bytes(from){safePath(from);let at=root;for(const part of from.split('/')){at=join(at,part);if(lstatSync(at).isSymbolicLink())throw Error('EXPORT_SYMLINK_FORBIDDEN');}const value=readFileSync(at);if(value.length>2*1024*1024)throw Error('EXPORT_SOURCE_FILE_TOO_LARGE');return value;}
const files=new Map();for(const path of manifest.current_file_inventory){safePath(path);files.set(path,bytes(path));}
for(const map of manifest.mapped_files){safePath(map.to);if(files.has(map.to))throw Error('EXPORT_DESTINATION_COLLISION');files.set(map.to,bytes(map.from));}
for(const rewrite of manifest.path_rewrites){for(const target of rewrite.targets){if(!files.has(target))throw Error('EXPORT_REWRITE_TARGET_MISSING');files.set(target,Buffer.from(files.get(target).toString('utf8').split(rewrite.find).join(rewrite.replace)));}}
const sha=value=>createHash('sha256').update(value).digest('hex');
// Source hashes and hashed needles identify the reviewed private references.
// The public inventory contains neither their original URLs nor file IDs.
for(const transform of manifest.text_transforms??[]){
 const path=safePath(transform.target);if(!path.startsWith('plugins/ashare-analysis-companion/skills/')||!path.endsWith('.md')||!files.has(path)||!/^[a-f0-9]{64}$/.test(transform.source_sha256)||!/^[a-f0-9]{64}$/.test(transform.export_sha256)||transform.source_sha256===transform.export_sha256||!Array.isArray(transform.replacements)||!transform.replacements.length||transform.replacements.length>10)throw Error('EXPORT_TEXT_TRANSFORM_INVALID');
 for(const r of transform.replacements)if(r.expected_count!==1||!/^[a-f0-9]{64}$/.test(r.needle_sha256)||r.kind==='literal_url'&&r.replacement!=='https://your-private-site.example.invalid'||r.kind==='markdown_private_file'&&r.replacement!=='（私有学习资料引用，未随公开源码提供）'||!['literal_url','markdown_private_file'].includes(r.kind))throw Error('EXPORT_TEXT_TRANSFORM_INVALID');
 let value=files.get(path);if(sha(value)===transform.export_sha256)continue;if(sha(value)!==transform.source_sha256)throw Error('EXPORT_TRANSFORM_SOURCE_CHANGED');let text=value.toString('utf8');
 for(const replacement of transform.replacements){if(replacement.expected_count!==1||!/^[a-f0-9]{64}$/.test(replacement.needle_sha256))throw Error('EXPORT_TEXT_TRANSFORM_INVALID');
  const markdown=replacement.kind==='markdown_private_file',literal=replacement.kind==='literal_url';if(!markdown&&!literal||markdown&&replacement.replacement!=='（私有学习资料引用，未随公开源码提供）'||literal&&replacement.replacement!=='https://your-private-site.example.invalid')throw Error('EXPORT_TEXT_TRANSFORM_INVALID');
  const matches=[...text.matchAll(markdown?/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g:/https?:\/\/[^\s)]+/g)].filter(m=>sha(markdown?m[2]:m[0])===replacement.needle_sha256);if(matches.length!==1)throw Error('EXPORT_TRANSFORM_OCCURRENCE_CHANGED');const match=matches[0];text=text.slice(0,match.index)+(markdown?match[1]+replacement.replacement:replacement.replacement)+text.slice(match.index+match[0].length);
 }
 value=Buffer.from(text);if(sha(value)!==transform.export_sha256)throw Error('EXPORT_TRANSFORM_RESULT_CHANGED');files.set(path,value);
}
// The public tree is itself the next source of truth. Its inventory references
// the sanitized destinations directly; do not reapply legacy path mappings.
const publicManifest={...manifest,export_profile:'sanitized_public_tree',current_file_inventory:[...files.keys()].sort(),mapped_files:[],path_rewrites:[]};
files.set('docs/public-export-manifest.json',Buffer.from(JSON.stringify(publicManifest,null,2)+'\n'));
for(const[path,value]of files){
 const text=value.toString('utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|AKIA[A-Z0-9]{16})\b|https?:\/\/[^\s/"']+:[^\s/@"']+@/.test(text))throw Error('EXPORT_SECRET_VALUE_SCAN_REJECTED: '+path);
 const emails=text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)??[];if(emails.some(e=>!/@(?:[^@]*\.)?(?:example\.com|example\.invalid|test|invalid)$/i.test(e)))throw Error('EXPORT_PERSONAL_EMAIL_SCAN_REJECTED: '+path);
 if(path==='cloudflare/wrangler.example.jsonc'&&!text.includes('"COLLECTOR_ALLOWED": "false"'))throw Error('EXPORT_CLOUD_EXAMPLE_NOT_DISABLED');
 if(path.startsWith('test/support/legacy-cloudflare/')&&!text.includes('OFFLINE TEST SUPPORT ONLY'))files.set(path,Buffer.from(path.endsWith('.mjs')?'// OFFLINE TEST SUPPORT ONLY. Not a deployment or recovery entry.\n'+text:'-- OFFLINE TEST SUPPORT ONLY. No runtime data.\n'+text));
}
mkdirSync(out,{recursive:false});
const report={manifest_version:manifest.version,policy:manifest.policy,source_history_copied:false,uploaded:false,deployed:false,real_market_export:false,private_condition_export:false,files:[]};
for(const[path,value]of [...files].sort(([a],[b])=>a.localeCompare(b))){const target=join(out,path);if(relative(out,target).startsWith('..'))throw Error('EXPORT_DESTINATION_ESCAPE');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value,{flag:'wx'});report.files.push({path,bytes:value.length,sha256:createHash('sha256').update(value).digest('hex')});}
writeFileSync(join(out,'export-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,file_count:report.files.length,bytes:report.files.reduce((n,f)=>n+f.bytes,0),uploaded:false,deployed:false,secret_value_scan:'passed'}));
