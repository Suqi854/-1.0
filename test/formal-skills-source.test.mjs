import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
const root=new URL('../plugins/ashare-analysis-companion/',import.meta.url);
const expected={
 '.codex-plugin/plugin.json':'98f79639a138c4e2b89749f4086fba857eec8eec804da3c013001ec3fb2ee644',
 'plugin.json':'39777ed03b11b13923c86546f4e8d6a268a210b698563b30cd1bfbaddaf0bf96',
 'skills/ashare-analysis/SKILL.md':'d9432fc36b7879bed64b757a9101a34a9c85ccba818c3a12bc7e6b71ee475436',
 'skills/ashare-analysis/references/data-coverage.md':'5f44926e52561cbee411acf3420075f48b9096b47b052288208e576dda22e4f1',
 'skills/ashare-fundamental-research/SKILL.md':'770fd95dd4b3eb42217c82fb7f832b37cf99f8f15c07f1988a896addcfe3f1b9',
 'skills/ashare-fundamental-research/references/business-evidence.md':'b4d96816fb847374c9b3fedfb95884ff74650c845c17c1f2923f776e3530e9bc',
 'skills/ashare-fundamental-research/references/sources-and-scope.md':'78f5be0acd1367f4eb4ccb05cd760ef7ecaa630fe6d9a82be3eade691fc01d34',
 'skills/ashare-fundamental-research/references/valuation-contract.md':'479983599dfc4112973750e9c54c871ad616b2565683228c56fead6bd6feed2f',
 'skills/ashare-strategy-validation/SKILL.md':'4214952950fd1cad335e1098151d999e3491aa17bddb29a9c382d072eadcc10a',
 'skills/ashare-strategy-validation/references/evidence-and-ashare-gates.md':'42042712be2522a744dd29b9fd02dfb62d67a969483c477ee79a86617227fcb4',
 'skills/ashare-strategy-validation/references/risk-models.md':'d1ba6ff1f7e301bc5d420150e42e3b12b6f65fb859db85b1e34a55b0f91ff3ff',
 'skills/ashare-strategy-validation/references/validation-protocol.md':'6f134a79f435798a6b5557cd71b2a984bba1b1dd314f5f5fcac8b975b58d82ce',
 'skills/ashare-swing-screen/SKILL.md':'ab04932f26dce748f5f2ed5077906a3fa2a62f0d1fde562ea87b777432dbbeda',
 'skills/ashare-swing-screen/references/screen-contract.md':'1957f0389d1ca7c34b7ede24c6c96499d1818a8e999ae66144b700e616f7c853'
};
function files(base=root,prefix=''){return readdirSync(base,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(new URL(x.name+'/',base),prefix+x.name+'/'):[prefix+x.name]);}
test('public skill variant has exact15 current hashes separately from14 formal release hashes',()=>{const manifest=JSON.parse(readFileSync(new URL('../docs/public-export-manifest.json',import.meta.url)));assert.deepEqual(manifest.formal_skill_source.original_file_sha256,expected);assert.equal(manifest.formal_skill_source.formal_release_republished,false);const hashes=manifest.formal_skill_source.source_variant_file_sha256;assert.equal(Object.keys(hashes).length,15);assert.deepEqual(files().sort(),Object.keys(hashes).sort());for(const[path,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),hash,path);});
test('canonical and compatibility manifests preserve one existing source identity and generic presentation',()=>{
 const source=JSON.parse(readFileSync(new URL('plugin.json',root))),overlay=JSON.parse(readFileSync(new URL('.codex-plugin/plugin.json',root)));
 assert.equal(source.name,'ashare-analysis-companion');assert.equal(source.name,overlay.name);assert.equal(source.version,'1.9.29-public.2');assert.equal(source.version,overlay.version);assert.deepEqual(source.extensions['com.openai'].interface,overlay.interface);assert.deepEqual(source.author,{name:'Plugin owner'});assert.deepEqual(source.author,overlay.author);assert.ok(source.extensions['com.openai'].interface.shortDescription.length<=30);assert.equal(overlay.skills,'./skills');
 for(const key of ['owner','publishBy','plugin_id','mcpServers','apps']){assert.equal(Object.hasOwn(source,key),false);assert.equal(Object.hasOwn(overlay,key),false);}
});
test('four skill frontmatters and every local Markdown reference resolve inside the existing package',()=>{
 const skillFiles=Object.keys(expected).filter(p=>p.endsWith('/SKILL.md'));assert.equal(skillFiles.length,4);
 for(const path of Object.keys(expected).filter(p=>p.endsWith('.md'))){const url=new URL(path,root),text=readFileSync(url,'utf8');if(path.endsWith('/SKILL.md')){assert.match(text,/^---\nname: /);assert.equal(/^name:\s*(.+)$/m.exec(text)[1].trim(),path.split('/')[1]);assert.match(text,/^description:\s*\S/m);}
  for(const link of text.matchAll(/\]\(([^)]+)\)/g)){const target=link[1].split('#')[0];if(!target||target.includes('://'))continue;const resolved=new URL(target,url);assert.ok(resolved.href.startsWith(root.href),target);assert.ok(readFileSync(resolved).length>0,target);}
 }
});
