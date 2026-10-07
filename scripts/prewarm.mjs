// Pre-warm the X and price caches for well-known KOLs so most judge queries are instant and free.
//   node --env-file=.env scripts/prewarm.mjs --dry-run              estimate only, no X call
//   node --env-file=.env scripts/prewarm.mjs --max-usd 12           run, stopping before the estimated total passes 12
// Handles come from --handles a,b,c or the default list below. Handles already cached are skipped (free).
import {createDeps,vetKols} from '../src/pipeline.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {normalizeHandle,ttlFromEnv} from '../src/x-client.mjs';
import {createCache} from '../src/cache.mjs';
import {cacheDir,dataDir,isMock} from '../src/config.mjs';
export const DEFAULT_HANDLES=['cobie','0xngmi','blknoiz06','CryptoHayes','inversebrah','HsakaTrades','CryptoKaleo','TheCryptoLark','IvanOnTech','MMCrypto','CryptoWendyO','AltcoinGordon','DegenSpartan','VitalikButerin','cz_binance'];
// Worst case per uncached handle: user $0.01 + 100 posts $0.50 + up to 3 reply searches of 25 posts $0.375. Typical $0.5 to $0.9.
export const EST_LOW=0.51,EST_HIGH=0.885;
export function isCached(cache,handle,ttl){
 const u=cache.get(`x:user:${handle.toLowerCase()}`,ttl);
 return Boolean(u&&(u.found===false||(u.user&&cache.get(`x:tweets:${u.user.id}`,ttl)!==undefined)));
}
export function plan(handles,cache,ttl){
 const todo=[],cached=[];
 for(const raw of handles){const h=normalizeHandle(raw);if(!h)continue;(isCached(cache,h,ttl)?cached:todo).push(h)}
 return {cached,todo,low:Math.round(todo.length*EST_LOW*100)/100,high:Math.round(todo.length*EST_HIGH*100)/100};
}
export async function run({handles,maxUsd,dryRun,env=process.env,fetchImpl,now=Date.now(),log=console.log}){
 const cache=createCache({dir:isMock(env)?undefined:cacheDir(env)});
 const p=plan(handles,cache,ttlFromEnv(env));
 log(`already cached (free): ${p.cached.join(', ')||'none'}`);
 log(`to fetch (${p.todo.length}): ${p.todo.join(', ')||'none'}`);
 log(`estimated live X cost: $${p.low} to $${p.high}; cap $${maxUsd}`);
 if(dryRun)return {...p,spent:0,done:[]};
 const deps=createDeps({env:{...env,X_LIVE_ALLOWED:'true',X_SPEND_SOURCE:'prewarm'},now,fetchImpl:fetchImpl??(isMock(env)?createMockFetch({now}):fetch),cache});
 const done=[];let spent=0;
 for(const h of p.todo){
  if(spent+EST_HIGH>maxUsd){log(`stopping before @${h}: next worst case would pass the $${maxUsd} cap (spent $${spent.toFixed(2)})`);break}
  const before=deps.ledger.total('prewarm');
  const report=await vetKols({handles:[h]},{deps,dir:dataDir(env),sessionId:'prewarm'});
  const cost=deps.ledger.total('prewarm')-before;spent+=cost;
  const k=report.analyses[0];
  done.push({handle:h,status:k.status,cost});
  log(`@${h}: ${k.status==='ok'?report.decision.decisions[0].verdict.label:k.status+(k.error?' ('+k.error+')':'')} · cost $${cost.toFixed(2)} · total $${spent.toFixed(2)}`);
 }
 log(`done: ${done.filter(d=>d.status==='ok').length}/${done.length} ok, spent about $${spent.toFixed(2)}`);
 return {...p,spent,done};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const a=process.argv.slice(2);
 const val=n=>{const i=a.indexOf(n);return i>=0?a[i+1]:undefined};
 const handles=(val('--handles')??DEFAULT_HANDLES.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
 await run({handles,maxUsd:Number(val('--max-usd')??12),dryRun:a.includes('--dry-run')});
}
