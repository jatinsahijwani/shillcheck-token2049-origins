import {appendFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
const utcDayStart=(now=Date.now())=>{const d=new Date(now);d.setUTCHours(0,0,0,0);return d.getTime()};
// Estimated live X spend, one JSON line per paid call, shared by every process on the host (append-only file).
// With no path the ledger lives in memory (tests, mock mode).
export function createLedger({path,now=Date.now}={}){
 const memory=[];
 if(path)mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const entries=()=>{
  if(!path)return memory;
  if(!existsSync(path))return [];
  return readFileSync(path,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
 };
 return {
  add(usd,src='task'){
   if(!(usd>0))return;
   const entry={t:now(),usd:Math.round(usd*10000)/10000,src};
   if(path)appendFileSync(path,JSON.stringify(entry)+'\n',{mode:0o600});else memory.push(entry);
  },
  // Spend since 00:00 UTC today, optionally for one source only.
  total(src){
   const since=utcDayStart(now());
   return entries().filter(e=>e.t>=since&&(!src||e.src===src)).reduce((n,e)=>n+e.usd,0);
  },
 };
}
