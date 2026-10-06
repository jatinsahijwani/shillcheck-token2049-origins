import {coinUrl,nearestPoint,day} from './coingecko.mjs';
import {RULES} from './config.mjs';
const DAY_MS=86400000;
const TOLERANCE_MS=36*3600*1000;
const pct=(from,to)=>from>0?(to/from-1)*100:null;
const floorDay=sec=>Math.floor(sec/day)*day;
const reasonOf=error=>error?.kind==='cap'?`${error.message}`:`price source error: ${error?.message??'unknown'}`;
// Resolves each promo to a coin, then prices it at t0, +7d and +30d. One CoinGecko range call per coin.
// Every failure becomes a labeled outcome, never an exception.
export async function priceOutcomes(promoRefs,{cg,llama,now}){
 const out=new Map(); // key -> outcome per promo key `${handle}|${promo.key}`
 const resolved=new Map();
 const resolve=async promo=>{
  const key=promo.key;
  if(resolved.has(key))return resolved.get(key);
  const task=(async()=>{
   try{
    if(promo.ref.kind==='cashtag')return await cg.resolveTicker(promo.ref.value);
    return await cg.resolveContract(promo.ref.kind,promo.ref.value);
   }catch(error){return {status:'error',reason:reasonOf(error)}}
  })();
  resolved.set(key,task);return task;
 };
 const live=[];
 for(const item of promoRefs){
  const {promo}=item;
  const t0=Date.parse(promo.firstPost.createdAt);
  const ageDays=(now-t0)/DAY_MS;
  const base={ageDays:Math.floor(ageDays)};
  const id=`${item.handle}|${promo.key}`;
  if(!Number.isFinite(t0)){out.set(id,{...base,status:'unverified',reason:'post date unavailable'});continue}
  if(ageDays>RULES.maxHistoryDays){out.set(id,{...base,status:'out_of_range',reason:'post is older than the 365-day price history window'});continue}
  const coin=await resolve(promo);
  item.resolution=coin;
  if(coin.status==='ok'){live.push({item,id,t0,ageDays,coin,base});continue}
  if(promo.ref.kind!=='cashtag'&&coin.status==='not_found'){live.push({item,id,t0,ageDays,coin:null,base});continue}
  const why=coin.status==='ambiguous'?`ticker $${promo.ref.value} matches ${coin.candidates} CoinGecko listings with no clear market-cap rank`:coin.status==='not_found'?`$${promo.ref.value} is not listed on CoinGecko by exact symbol`:coin.reason??'lookup failed';
  out.set(id,{...base,status:'unverified',reason:why});
 }
 // Group by coin id so each coin costs one history call covering all its promo dates.
 const groups=new Map();
 for(const entry of live.filter(e=>e.coin))(groups.get(entry.coin.id)??groups.set(entry.coin.id,[]).get(entry.coin.id)).push(entry);
 const nowSec=Math.floor(now/1000);
 for(const [coinId,entries] of groups){
  const t0s=entries.map(e=>e.t0/1000);
  const from=Math.max(floorDay(Math.min(...t0s)-2*day),floorDay(nowSec-RULES.maxHistoryDays*day)+day);
  const to=floorDay(Math.min(nowSec,Math.max(...t0s)+32*day));
  let points;let failure;
  try{points=await cg.priceRange(coinId,from,to)}catch(error){failure=reasonOf(error)}
  for(const e of entries){
   const coin={id:coinId,symbol:e.coin.symbol,name:e.coin.name,url:coinUrl(coinId)};
   if(failure){out.set(e.id,{...e.base,status:'unverified',coin,reason:failure});continue}
   out.set(e.id,evaluate({points,t0:e.t0,ageDays:e.ageDays,base:e.base,coin,source:'coingecko'}));
  }
 }
 for(const e of live.filter(x=>!x.coin)){
  try{
   const at=ms=>llama.priceAt(e.item.promo.ref.kind,e.item.promo.ref.value,Math.floor(ms/1000));
   const horizons=[0,7,30].filter(d=>d===0||e.ageDays>=d);
   const found=await Promise.all(horizons.map(d=>at(e.t0+d*DAY_MS)));
   const points=found.map((f,i)=>f?[e.t0+horizons[i]*DAY_MS,f.price]:null).filter(Boolean);
   const chain=found.find(Boolean)?.chain;
   const outcome=evaluate({points,t0:e.t0,ageDays:e.ageDays,base:e.base,coin:null,source:'defillama'});
   if(outcome.status!=='unverified')outcome.chain=chain;
   out.set(e.id,outcome.status==='unverified'&&!points.length?{...e.base,status:'unverified',reason:'contract address not found on CoinGecko or DefiLlama'}:outcome);
  }catch(error){out.set(e.id,{...e.base,status:'unverified',reason:reasonOf(error)})}
 }
 return out;
}
export function evaluate({points,t0,ageDays,base,coin,source}){
 const at=ms=>nearestPoint(points,ms,TOLERANCE_MS);
 const p0=at(t0);
 const result={...base,coin:coin??undefined,source};
 if(!p0)return {...result,status:'unverified',reason:'no price point near the post time'};
 const p7=ageDays>=7?at(t0+7*DAY_MS):null,p30=ageDays>=30?at(t0+30*DAY_MS):null;
 Object.assign(result,{p0:p0.price,p7:p7?.price??null,p30:p30?.price??null,pct7:p7?pct(p0.price,p7.price):null,pct30:p30?pct(p0.price,p30.price):null});
 if(ageDays<RULES.pendingDays)return {...result,status:'pending',reason:`post is ${base.ageDays} days old; 30-day outcome not yet available`};
 if(!p30)return {...result,status:'unverified',reason:'no price point near +30 days'};
 return {...result,status:'ok'};
}
