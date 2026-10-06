import {getJson} from './http.mjs';
const BASE='https://coins.llama.fi/prices/historical';
const EVM=['ethereum','base','bsc','arbitrum','polygon'];
// Free fallback for contract-address lookups CoinGecko cannot resolve. One call per timestamp, all chains at once.
export function createDefiLlama({fetchImpl=fetch,cache,sleep}){
 return {
  async priceAt(kind,address,tsSec){
   const key=`llama:${address.toLowerCase()}:${tsSec}`;
   const hit=cache?.get(key);if(hit!==undefined)return hit;
   const keys=(kind==='evm'?EVM:['solana']).map(chain=>`${chain}:${address}`).join(',');
   const body=await getJson({fetchImpl,sleep,label:'DefiLlama price',url:`${BASE}/${tsSec}/${keys}?searchWidth=12h`});
   const hits=Object.entries(body.coins??{}).filter(([,v])=>Number.isFinite(v?.price));
   const value=hits.length?{price:hits[0][1].price,chain:hits[0][0].split(':')[0],at:hits[0][1].timestamp}:null;
   return cache?cache.set(key,value):value;
  },
 };
}
