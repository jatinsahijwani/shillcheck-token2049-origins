import {getJson,SourceError,createBudget} from './http.mjs';
const BASE='https://api.coingecko.com/api/v3';
const DAY=86400;
const EVM_PLATFORMS=['ethereum','base','binance-smart-chain','arbitrum-one','polygon-pos'];
export const coinUrl=id=>`https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`;
export function createLimiter(ratePerMin,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 const gap=60000/ratePerMin;let next=0;
 return async()=>{const wait=Math.max(0,next-now());next=Math.max(next,now())+gap;if(wait>0)await sleep(wait)};
}
export function nearestPoint(points,targetMs,toleranceMs){
 let best=null;
 for(const [t,price] of points){const d=Math.abs(t-targetMs);if(d<=toleranceMs&&(!best||d<best.d))best={t,price,d};}
 return best?{t:best.t,price:best.price}:null;
}
// Ticker resolution needs an exact symbol match. Several matches: best market_cap_rank wins; none ranked = ambiguous.
export function pickByTicker(symbol,coins){
 const exact=(coins??[]).filter(c=>String(c.symbol).toUpperCase()===symbol.toUpperCase());
 if(!exact.length)return {status:'not_found'};
 if(exact.length===1)return {status:'ok',coin:exact[0]};
 const ranked=exact.filter(c=>Number.isInteger(c.market_cap_rank)).sort((a,b)=>a.market_cap_rank-b.market_cap_rank);
 if(!ranked.length||(ranked.length>1&&ranked[0].market_cap_rank===ranked[1].market_cap_rank))return {status:'ambiguous',candidates:exact.length};
 return {status:'ok',coin:ranked[0],chosenBy:'market_cap_rank'};
}
export function createCoinGecko({apiKey,fetchImpl=fetch,cache,budget=createBudget({max:150,label:'CoinGecko'}),ratePerMin=28,sleep,now=Date.now}){
 const limit=createLimiter(ratePerMin,{sleep,now});
 const call=async(path,params,label)=>{await limit();return getJson({fetchImpl,budget,sleep,label,url:`${BASE}${path}${params?`?${new URLSearchParams(params)}`:''}`,headers:{'x-cg-demo-api-key':apiKey,accept:'application/json'}})};
 // CoinGecko answers are kept permanently, including "not found", so a rerun never spends a call twice.
 const permanent=async(key,load)=>{const hit=cache?.get(key);if(hit!==undefined)return hit;const value=await load();return cache?cache.set(key,value):value};
 return {
  budget,
  resolveTicker:symbol=>permanent(`cg:ticker:${symbol.toUpperCase()}`,async()=>{
   const body=await call('/search',{query:symbol},'CoinGecko search');
   const pick=pickByTicker(symbol,body.coins);
   return pick.status==='ok'?{status:'ok',id:pick.coin.id,symbol:pick.coin.symbol,name:pick.coin.name,chosenBy:pick.chosenBy??'only exact symbol match'}:pick;
  }),
  resolveContract:(kind,address)=>permanent(`cg:contract:${address.toLowerCase()}`,async()=>{
   for(const platform of kind==='evm'?EVM_PLATFORMS:['solana']){
    try{
     const body=await call(`/coins/${platform}/contract/${address}`,undefined,'CoinGecko contract lookup');
     if(body.id)return {status:'ok',id:body.id,symbol:body.symbol,name:body.name,platform};
    }catch(error){if(error.kind!=='not_found')throw error}
   }
   return {status:'not_found'};
  }),
  // One call per coin covers every promo date. Daily points are cached by window.
  priceRange:(id,fromSec,toSec)=>permanent(`cg:range:${id}:${fromSec}:${toSec}`,async()=>{
   const body=await call(`/coins/${encodeURIComponent(id)}/market_chart/range`,{vs_currency:'usd',from:String(fromSec),to:String(toSec)},'CoinGecko price history');
   return (body.prices??[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[1]));
  }),
 };
}
export const day=DAY;
export {SourceError};
