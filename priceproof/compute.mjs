import {priceOutcomes} from '../src/prices.mjs';
import {coinUrl} from '../src/coingecko.mjs';
export const MAX_LOOKUPS=40;
export const CHAINS=['evm','ethereum','base','bsc','arbitrum','polygon','solana'];
export const SCHEMA={input_data:[{id:'lookups',type:'string',name:'Price lookups',data:{description:`JSON array of up to ${MAX_LOOKUPS} lookups. Each is {"coin_id":"<coingecko id>","date":"YYYY-MM-DD"} or {"contract":"<address>","chain":"evm|ethereum|base|bsc|arbitrum|polygon|solana","date":"YYYY-MM-DD"}. Returns the USD price at the date, +7 days and +30 days, the percentage changes and source URLs. Deterministic, no AI.`},validations:[{validation:'min',value:'2'},{validation:'max',value:'8000'}]}]};
const COIN_RE=/^[a-z0-9][a-z0-9-]{0,99}$/;
const EVM_RE=/^0x[a-fA-F0-9]{40}$/;
const SOL_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/;
export function parseLookups(text){
 if(typeof text!=='string'||text.length>8000)throw new Error('lookups must be a JSON string of at most 8000 characters');
 let list;try{list=JSON.parse(text)}catch{throw new Error('lookups is not valid JSON')}
 if(!Array.isArray(list)||!list.length)throw new Error('lookups must be a non-empty array');
 if(list.length>MAX_LOOKUPS)throw new Error(`at most ${MAX_LOOKUPS} lookups per job`);
 return list.map((x,i)=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw new Error(`lookup ${i}: must be an object`);
  const allowed=new Set(['coin_id','contract','chain','date']);
  if(Object.keys(x).some(k=>!allowed.has(k)))throw new Error(`lookup ${i}: unknown field`);
  if(typeof x.date!=='string'||!DATE_RE.test(x.date)||!Number.isFinite(Date.parse(x.date)))throw new Error(`lookup ${i}: date must be YYYY-MM-DD or ISO UTC`);
  if(x.coin_id!==undefined){
   if(x.contract!==undefined||x.chain!==undefined)throw new Error(`lookup ${i}: use coin_id or contract+chain, not both`);
   if(typeof x.coin_id!=='string'||!COIN_RE.test(x.coin_id))throw new Error(`lookup ${i}: invalid coin_id`);
   return {coin_id:x.coin_id,date:x.date};
  }
  if(!CHAINS.includes(x.chain))throw new Error(`lookup ${i}: chain must be one of ${CHAINS.join(', ')}`);
  const sol=x.chain==='solana';
  if(typeof x.contract!=='string'||!(sol?SOL_RE:EVM_RE).test(x.contract))throw new Error(`lookup ${i}: invalid contract for chain`);
  return {contract:x.contract,chain:x.chain,date:x.date};
 });
}
export function validate(data){try{parseLookups(data.lookups);return null}catch(e){return e.message}}
const sourcesFor=(lookup,outcome)=>{
 const out=[];
 if(outcome.coin?.id)out.push(coinUrl(outcome.coin.id),`${coinUrl(outcome.coin.id)}/historical_data`);
 if(outcome.source==='defillama'){
  const ts=Math.floor(Date.parse(lookup.date)/1000);
  const chain=outcome.chain??(lookup.chain==='solana'?'solana':'ethereum');
  out.push(`https://coins.llama.fi/prices/historical/${ts}/${chain}:${lookup.contract}`);
 }
 return out;
};
// Deterministic: same lookups and same price data give the same JSON. No model, no free text from outside the lookups.
export async function computePriceProof(lookups,{cg,llama,now}){
 const refs=lookups.map((l,i)=>({handle:'pp',promo:{key:String(i),ref:l.coin_id?{kind:'coin_id',value:l.coin_id}:{kind:l.chain==='solana'?'solana':'evm',value:l.contract},firstPost:{createdAt:l.date.length===10?`${l.date}T00:00:00.000Z`:l.date}}}));
 const outcomes=await priceOutcomes(refs,{cg,llama,now});
 const results=lookups.map((l,i)=>{
  const o=outcomes.get(`pp|${i}`)??{status:'unverified',reason:'no result'};
  const num=v=>Number.isFinite(v)?v:null;
  return {index:i,input:l,status:o.status,price_at:num(o.p0),price_7d:num(o.p7),price_30d:num(o.p30),pct_7d:num(o.pct7),pct_30d:num(o.pct30),source:o.source??null,coin_id:o.coin?.id??l.coin_id??null,reason:o.reason??null,sources:sourcesFor(l,o)};
 });
 return JSON.stringify({version:'priceproof/1',as_of:new Date(now).toISOString().slice(0,10),results});
}
export const execute=(deps)=>async(data)=>computePriceProof(parseLookups(data.lookups),deps);
