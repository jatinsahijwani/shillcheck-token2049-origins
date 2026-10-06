import {priceOutcomes} from './prices.mjs';
import {coinUrl} from './coingecko.mjs';
import {buyPriceProof} from './purchase-client.mjs';
import {MAX_LOOKUPS} from '../priceproof/compute.mjs';
import {RULES} from './config.mjs';
const DAY_MS=86400000;
const key=item=>`${item.handle}|${item.promo.key}`;
const dateOf=item=>new Date(item.promo.firstPost.createdAt).toISOString();
// ONE PriceProof purchase per report. Any problem (timeout, hash mismatch, uncertain write, bad rows) falls back to the
// local CoinGecko/DefiLlama code, labeled "computed locally". The caller's deadline is respected with a safety margin.
export async function priceWithPriceProof(refs,{cg,llama,now,pp,deadline}){
 const local=[],lookups=[];
 for(const item of refs){
  const t0=Date.parse(item.promo.firstPost.createdAt);
  const age=(now-t0)/DAY_MS;
  if(!Number.isFinite(t0)||age>RULES.maxHistoryDays){local.push(item);continue}
  const ref=item.promo.ref;
  if(ref.kind==='cashtag'){
   let r;try{r=await cg.resolveTicker(ref.value)}catch{r=null}
   if(r?.status!=='ok'){local.push(item);continue}
   lookups.push({item,body:{coin_id:r.id,date:dateOf(item)},coin:{id:r.id,symbol:r.symbol,name:r.name,url:coinUrl(r.id)}});
  }else lookups.push({item,body:{contract:ref.value,chain:ref.kind==='solana'?'solana':'evm',date:dateOf(item)}});
 }
 const sent=lookups.slice(0,MAX_LOOKUPS);
 for(const extra of lookups.slice(MAX_LOOKUPS))local.push(extra.item);
 const info={enabled:true,used:false,lookups:sent.length,local:0};
 const outcomes=new Map();
 const computeLocally=async items=>{if(!items.length)return;for(const [k,v] of await priceOutcomes(items,{cg,llama,now}))outcomes.set(k,v)};
 let rows=null;
 if(sent.length){
  const timeoutMs=Math.min(pp.config.timeoutMs,deadline-Date.now()-30000);
  if(timeoutMs<60000)Object.assign(info,{reason:'not enough time left in this report run'});
  else{
   try{
    const bought=await buyPriceProof({lookups:sent.map(s=>s.body),config:{...pp.config,timeoutMs},deps:pp.deps});
    rows=bought.rows;info.used=true;info.evidence=bought.evidence;
   }catch(error){Object.assign(info,{reason:error.kind?`${error.kind} at ${error.stage}: ${error.message}`:'unexpected error',kind:error.kind??'error'})}
  }
 }
 const fallback=[];
 sent.forEach((s,i)=>{
  const row=rows?.[i];
  const usable=row&&(row.status==='pending'||row.status==='unverified'||(row.status==='ok'&&row.p0!==null&&row.p30!==null)||row.status==='out_of_range');
  if(!usable){fallback.push(s.item);return}
  const age=Math.floor((now-Date.parse(s.item.promo.firstPost.createdAt))/DAY_MS);
  const coinId=s.coin?.id??row.coinId;
  const coin=s.coin??(coinId?{id:coinId,symbol:coinId,name:coinId,url:coinUrl(coinId)}:undefined);
  outcomes.set(key(s.item),{ageDays:age,status:row.status,coin,source:row.source,p0:row.p0??undefined,p7:row.p7,p30:row.p30,pct7:row.pct7,pct30:row.pct30,reason:row.reason??undefined,viaPriceProof:true});
 });
 await computeLocally([...local,...fallback]);
 info.local=local.length+fallback.length;
 info.lookups=sent.length-fallback.length;
 info.used=Boolean(rows)&&info.lookups>0;
 if(rows&&!info.used)info.reason='no usable rows in the verified result';
 return {outcomes,info};
}
