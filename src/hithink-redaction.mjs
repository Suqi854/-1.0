// Internal safety check only. Never return credential-bearing source data or log it.
export function containsCredentialEcho(root,key){
 if(typeof key!=='string'||!key)return false;
 const pending=[root];
 while(pending.length){const part=pending.pop();if((typeof part==='string'||typeof part==='number')&&String(part).includes(key))return true;if(part&&typeof part==='object')for(const [field,value] of Object.entries(part)){if(field.includes(key))return true;pending.push(value);}}
 return false;
}
