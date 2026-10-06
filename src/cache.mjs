import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
// ttlMs omitted = permanent. Entries are plain JSON; the key is hashed so it is always a safe file name.
export function createCache({dir,now=Date.now}={}){
 const memory=new Map();
 if(dir)mkdirSync(dir,{recursive:true,mode:0o700});
 const file=key=>join(dir,createHash('sha256').update(key).digest('hex').slice(0,40)+'.json');
 const read=key=>{
  if(memory.has(key))return memory.get(key);
  if(!dir||!existsSync(file(key)))return undefined;
  try{const entry=JSON.parse(readFileSync(file(key),'utf8'));memory.set(key,entry);return entry}catch{return undefined}
 };
 return {
  get(key,ttlMs){const entry=read(key);if(!entry)return undefined;if(ttlMs!==undefined&&now()-entry.at>ttlMs)return undefined;return entry.value},
  set(key,value){
   const entry={at:now(),value};memory.set(key,entry);
   if(dir){const path=file(key);writeFileSync(path+'.tmp',JSON.stringify(entry),{mode:0o600});renameSync(path+'.tmp',path)}
   return value;
  },
 };
}
