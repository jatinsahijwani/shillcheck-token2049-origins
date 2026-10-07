// Pre-warm the X and price caches for well-known KOLs so most judge queries are instant and free.
//   node --env-file=.env scripts/prewarm.mjs --dry-run              estimate only, no X call
//   node --env-file=.env scripts/prewarm.mjs --max-usd 12           run, stopping before the estimated total passes 12
// Handles come from --handles a,b,c or the default list below. Handles already cached are skipped (free).
import {createDeps,vetKols} from '../src/pipeline.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {normalizeHandle,ttlFromEnv,handleCost,USER_COST} from '../src/x-client.mjs';
import {RULES} from '../src/config.mjs';
import {createCache} from '../src/cache.mjs';
import {cacheDir,dataDir,isMock} from '../src/config.mjs';
export const DEFAULT_HANDLES=['cobie','0xngmi','blknoiz06','CryptoHayes','inversebrah','HsakaTrades','CryptoKaleo','TheCryptoLark','IvanOnTech','MMCrypto','CryptoWendyO','scottmelker','DegenSpartan','VitalikButerin','cz_binance','jatinsahijwani1','Pentosh1','CryptoCapo_','DonAlt','MustStopMurad','thecryptodog','rektcapital','APompliano','BitBoy_Crypto','TheMoonCarl','AltcoinDailyio'];
// Per uncached handle: user lookup + RULES.postsRead posts (+ up to RULES.replyPosts reply searches of RULES.repliesPerPost posts).
// Low = no recent promo post to sample, high = both reply searches full.
export const EST_LOW=USER_COST+RULES.postsRead*0.005,EST_HIGH=handleCost();
// An entry counts as cached only if it will still be valid at validUntil (so the demo data cannot expire before the event).
export function isCached(cache,handle,ttl,validUntil=Date.now()){
 const slack=Math.max(0,validUntil-Date.now());
 const ok=key=>{const age=cache.age(key);return age!==undefined&&age+slack<ttl};
 const u=cache.get(`x:user:${handle.toLowerCase()}`);
 return Boolean(u&&ok(`x:user:${handle.toLowerCase()}`)&&(u.found===false||(u.user&&ok(`x:tweets:${u.user.id}`))));
}
export function plan(handles,cache,ttl,validUntil){
 const todo=[],cached=[];
 for(const raw of handles){const h=normalizeHandle(raw);if(!h)continue;(isCached(cache,h,ttl,validUntil)?cached:todo).push(h)}
 return {cached,todo,low:Math.round(todo.length*EST_LOW*100)/100,high:Math.round(todo.length*EST_HIGH*100)/100};
}
export async function run({handles,maxUsd,dryRun,validUntil=Date.now(),env=process.env,fetchImpl,now=Date.now(),log=console.log}){
 const cache=createCache({dir:isMock(env)?undefined:cacheDir(env)});
 const ttl=ttlFromEnv(env);
 const p=plan(handles,cache,ttl,validUntil);
 log(`already cached and valid until ${new Date(validUntil).toISOString().slice(0,16)}Z (free): ${p.cached.join(', ')||'none'}`);
 log(`to fetch (${p.todo.length}): ${p.todo.join(', ')||'none'}`);
 log(`estimated live X cost: $${p.low} to $${p.high}; cap $${maxUsd}`);
 if(dryRun)return {...p,spent:0,done:[]};
 // One deps object per handle: the per-report cost cap and call caps are per run, and each handle is its own run. Cache and ledger are shared.
 // Entries that would expire before validUntil are treated as stale by the client, so they are read again.
 const freshHours=Math.max(0.01,(ttl-Math.max(0,validUntil-Date.now()))/3600000);
 const first=createDeps({env:{...env,X_LIVE_ALLOWED:'true',X_SPEND_SOURCE:'prewarm',X_CACHE_TTL_HOURS:String(freshHours)},now,fetchImpl:fetchImpl??(isMock(env)?createMockFetch({now}):fetch),cache});
 const depsFor=()=>createDeps({env:{...env,X_LIVE_ALLOWED:'true',X_SPEND_SOURCE:'prewarm',X_CACHE_TTL_HOURS:String(freshHours)},now,fetchImpl:fetchImpl??(isMock(env)?createMockFetch({now}):fetch),cache,ledger:first.ledger});
 const done=[];let spent=0;
 for(const h of p.todo){
  if(spent+EST_HIGH>maxUsd){log(`stopping before @${h}: next worst case would pass the $${maxUsd} cap (spent $${spent.toFixed(2)})`);break}
  const deps=depsFor();
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
 const validUntil=val('--valid-until')?Date.parse(val('--valid-until')):Date.parse('2026-10-08T08:30:00Z'); // 8 Oct 16:30 SGT, after the prize ceremony
 const handles=(val('--handles')??DEFAULT_HANDLES.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
 await run({handles,maxUsd:Number(val('--max-usd')??12),dryRun:a.includes('--dry-run'),validUntil});
}
