import {randomBytes} from 'node:crypto';
import {RULES,isMock,limits} from './config.mjs';
import {createCache} from './cache.mjs';
import {createBudget} from './http.mjs';
import {createXClient,normalizeHandle,ttlFromEnv} from './x-client.mjs';
import {createCoinGecko} from './coingecko.mjs';
import {createDefiLlama} from './defillama.mjs';
import {detectPromos,postUrl} from './promo.mjs';
import {postStats,replyQuality} from './analysis.mjs';
import {priceOutcomes} from './prices.mjs';
import {priceWithPriceProof} from './priceproof-integration.mjs';
import {decide,mergeConstraints} from './decide.mjs';
import {renderReport} from './report.mjs';
import {saveReport,loadReport} from './store.mjs';
import {cacheDir,repoRoot,ledgerPath} from './config.mjs';
import {createLedger} from './spend-ledger.mjs';
import {join} from 'node:path';
const DAY_MS=86400000;
export function cleanHandles(raw){
 const seen=new Set(),valid=[],invalid=[];
 for(const item of raw??[]){
  const h=normalizeHandle(item);
  if(!h){invalid.push(String(item).slice(0,40));continue}
  if(!seen.has(h.toLowerCase())){seen.add(h.toLowerCase());valid.push(h)}
 }
 return {valid:valid.slice(0,RULES.maxHandles),invalid,dropped:Math.max(0,valid.length-RULES.maxHandles)};
}
async function pool(items,size,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));
 return out;
}
// Fetch facts for one KOL. Any failure is recorded on the KOL and never aborts the run.
async function collectKol(handle,{x,now,deadline}){
 const kol={handle,status:'ok',profile:null,posts:null,replies:null,promos:[],omittedPromos:0,couldNotVerify:[]};
 const profileUrl=`https://x.com/${handle}`;
 if(Date.now()>deadline){kol.status='error';kol.error='time budget for this report was used up';return kol}
 let user;
 try{
  const found=await x.getUser(handle);
  if(!found.found){kol.status='not_found';return kol}
  user=found.user;
 }catch(error){kol.status='error';kol.error=error.message;return kol}
 const m=user.public_metrics??{};
 kol.profile={id:user.id,name:user.name,url:profileUrl,createdAt:user.created_at,location:user.location??'',followers:m.followers_count??0,avatarDefault:/default_profile_images/.test(user.profile_image_url??'')};
 let tweets=[];
 try{tweets=await x.getTweets(user.id)}catch(error){kol.status='error';kol.error=`posts: ${error.message}`;return kol}
 if(!tweets.length){kol.status='error';kol.error='no original posts returned';return kol}
 kol.posts={...postStats(tweets,kol.profile.followers),sourceUrl:profileUrl};
 if(!kol.posts.viewsAvailable)kol.couldNotVerify.push('view counts were not returned for these posts, so estimated real views and fair price are unavailable');
 const found=detectPromos(tweets,handle);
 kol.promos=found.promos.map(p=>({key:p.key,ref:p.ref,via:p.via,postUrl:p.firstPost.url,postDate:p.firstPost.createdAt,postCount:p.postCount,disclosed:p.disclosed,firstPostDisclosed:p.firstPostDisclosed,hype:p.hype,firstPost:p.firstPost,coin:null,outcome:null}));
 kol.omittedPromos=found.omitted;
 if(found.omitted)kol.couldNotVerify.push(`${found.omitted} further promoted coin(s) were not priced (cap of ${RULES.maxPromoCoins} per KOL)`);
 // Reply sample: recent search reaches back 7 days only.
 const recent=tweets.filter(t=>now-Date.parse(t.created_at)<RULES.recentSearchDays*DAY_MS).sort((a,b)=>(b.metrics?.reply_count??0)-(a.metrics?.reply_count??0)||(a.id<b.id?-1:1));
 const replies=[],sampled=[];
 if(!recent.length)kol.replies={status:'unverified',reason:'no original posts within the 7-day search window, so reply quality could not be verified'};
 else{
  let failure;
  for(const t of recent.filter(t=>(t.metrics?.reply_count??1)>0).slice(0,3)){
   if(replies.length>=RULES.replySample)break;
   try{replies.push(...await x.getReplies(t.id,handle));sampled.push(postUrl(handle,t.id))}catch(error){failure=error.message;break}
  }
  const q=replyQuality(replies,now);
  if(q.sufficient)kol.replies={status:'ok',...q,sampledPosts:sampled};
  else kol.replies={status:'unverified',reason:failure?`reply search failed: ${failure}`:`only ${q.checked} repliers available (need ${RULES.minReplySample})`,checked:q.checked,sampledPosts:sampled};
 }
 if(kol.replies.status!=='ok')kol.couldNotVerify.push(`reply quality: ${kol.replies.reason}. Estimated real views are not adjusted for bot share`);
 return kol;
}
export function createDeps({env=process.env,fetchImpl=fetch,now=Date.now(),sleep,cache:sharedCache,priceProof,ledger:sharedLedger}={}){
 const mock=isMock(env),cap=limits(env);
 const cache=sharedCache??createCache({dir:mock?undefined:cacheDir(env)});
 const ledger=sharedLedger??createLedger({path:mock?undefined:ledgerPath(env)});
 const xBudget=createBudget({max:cap.maxXCalls,label:'X API'}),cgBudget=createBudget({max:cap.maxCoinGeckoCalls,label:'CoinGecko'});
 return {mock,now,cache,ledger,limits:cap,priceProof:priceProof??priceProofFromEnv(env,fetchImpl),
  x:createXClient({bearer:env.X_BEARER_TOKEN,fetchImpl,cache,budget:xBudget,sleep,maxCostUsd:cap.maxXCostUsd,ttlMs:ttlFromEnv(env),liveAllowed:env.X_LIVE_ALLOWED!=='false',ledger,dailyCapUsd:cap.xDailyCapUsd,source:env.X_SPEND_SOURCE||'task'}),
  cg:createCoinGecko({apiKey:env.COINGECKO_API_KEY,fetchImpl,cache,budget:cgBudget,ratePerMin:cap.coingeckoRatePerMin,sleep}),
  llama:createDefiLlama({fetchImpl,cache,sleep})};
}
export async function vetKols(params,{deps,dir,sessionId=null}={}){
 const {x,cg,llama,mock,limits:cap}=deps;const now=deps.now;
 const {valid,invalid,dropped}=cleanHandles(params.handles);
 if(!valid.length&&!invalid.length)throw new Error('At least one X handle is required');
 const deadline=Date.now()+cap.maxRunMs;
 const kols=await pool(valid,cap.concurrency,h=>collectKol(h,{x,now,deadline}));
 for(const bad of invalid)kols.push({handle:bad,status:'invalid',profile:null,posts:null,replies:null,promos:[],couldNotVerify:[]});
 const refs=kols.filter(k=>k.status==='ok').flatMap(k=>k.promos.map(promo=>({handle:k.handle,promo})));
 let outcomes,priceProof=null;
 if(Date.now()>deadline)outcomes=new Map();
 else if(deps.priceProof){const r=await priceWithPriceProof(refs,{cg,llama,now,pp:deps.priceProof,deadline});outcomes=r.outcomes;priceProof=r.info}
 else outcomes=await priceOutcomes(refs,{cg,llama,now});
 for(const k of kols)for(const p of k.promos){
  const o=outcomes.get(`${k.handle}|${p.key}`)??{status:'unverified',reason:'time budget for this report was used up'};
  p.outcome=o;p.coin=o.coin??null;
  if(o.status==='unverified'||o.status==='out_of_range')k.couldNotVerify.push(`${p.ref.kind==='cashtag'?'$'+p.ref.value:p.ref.value.slice(0,10)+'…'} promotion on ${p.postDate?.slice(0,10)}: ${o.reason}`);
 }
 const constraints=mergeConstraints({},{budget_usd:params.budget_usd,goal:params.goal,niche:params.niche,region:params.region,cpm_usd:params.cpm_usd,quoted_fees:params.quoted_fees});
 const notes=[];
 if(invalid.length)notes.push(`Ignored ${invalid.length} input(s) that are not valid X handles.`);
 if(dropped)notes.push(`Only the first ${RULES.maxHandles} handles were analysed; ${dropped} more were dropped.`);
 return finish({kols,constraints,notes,params:{handles:valid,invalid,dropped},mock,now,parentId:null,priceProof,deps,dir,sessionId,usage:{xCalls:x.budget.used,coinGeckoCalls:cg.budget.used,xUsersRead:x.stats.users,xPostsRead:x.stats.posts,estXCostUsd:Math.round((x.stats.users*0.01+x.stats.posts*0.005)*100)/100}});
}
function finish({kols,constraints,notes,params,mock,now,parentId,dir,sessionId,usage,priceProof}){
 const decision=decide(kols,constraints);
 const id=`rpt_${randomBytes(6).toString('hex')}`;
 const createdAt=new Date().toISOString();
 const report={id,createdAt,parentId,sessionId,mock,asOf:new Date(now).toISOString(),params,constraints,notes,usage,analyses:kols,decision};
 if(priceProof)report.priceProof=priceProof;
 report.markdown=renderReport(report);
 saveReport(dir,report);
 return report;
}
// Follow-up: merge new constraints onto the stored ones and recompute from stored facts. No X or CoinGecko calls.
export function rerankReport({reportId,update,dir,sessionId=null}){
 const prior=loadReport(dir,reportId);
 if(!prior)throw new Error('Report not found');
 const constraints=mergeConstraints(prior.constraints,update);
 const notes=[`Re-ranked from report ${prior.id} using stored data; no new X or CoinGecko reads.`,...prior.notes.filter(n=>!n.startsWith('Re-ranked from'))];
 return finish({kols:prior.analyses,constraints,notes,params:prior.params,mock:prior.mock,now:Date.parse(prior.asOf),parentId:prior.id,dir,sessionId,usage:{xCalls:0,coinGeckoCalls:0},priceProof:prior.priceProof});
}
// Compact numeric summary for the model. Never includes post text or profile bios.
export function summarize(report){
 const d=report.decision;
 const by=new Map(d.decisions.map(x=>[x.handle,x]));
 return {report_id:report.id,mock:report.mock,kols:report.analyses.length,
  ranked:d.ranked.map(h=>{const x=by.get(h);return {handle:h,verdict:x.verdict.label,est_real_views:x.estRealViews===null?null:Math.round(x.estRealViews),fair_price_usd:x.fair?.usd??null,bot_share_pct:x.botShare===null||x.botShare===undefined?null:Math.round(x.botShare*100),median_30d_pct:x.outcomes?.median30===null||x.outcomes?.median30===undefined?null:Math.round(x.outcomes.median30)}}),
  excluded:d.excluded,budget:d.budget?{total_usd:d.budget.total,allocated_usd:d.budget.allocated,unallocated_usd:d.budget.unallocated}:null,
  could_not_verify_items:report.analyses.reduce((n,k)=>n+k.couldNotVerify.length+(k.status==='ok'?0:1),0),
  constraints:{region:report.constraints.region??null,max_fee_usd:report.constraints.max_fee_usd??null,exclude_handles:report.constraints.exclude_handles,cpm_usd:d.cpm}};
}

// PriceProof is off unless PRICEPROOF_ENABLED=true; when off, nothing here runs and behaviour is identical to v1.
export function priceProofFromEnv(env,fetchImpl=fetch){
 if(env.PRICEPROOF_ENABLED!=='true')return null;
 const token=env.PRICEPROOF_PURCHASE_TOKEN;
 if(!token||!env.PRICEPROOF_AGENT_IDENTIFIER)return null;
 const mps=async(path,body)=>{
  const response=await fetchImpl(`${env.MPS_URL}/api/v1${path}`,{method:body?'POST':'GET',redirect:'error',headers:{token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok)throw new Error(`Payment service HTTP ${response.status}`);
  return data.data;
 };
 return {config:{url:env.PRICEPROOF_URL||'http://127.0.0.1:21960',agentIdentifier:env.PRICEPROOF_AGENT_IDENTIFIER,maxPriceAtomic:env.PRICEPROOF_MAX_PRICE_ATOMIC||'500000',timeoutMs:Number(env.PRICEPROOF_TIMEOUT_MS)||420000,journalDir:join(repoRoot,'.local','priceproof-purchases')},deps:{mps,fetchImpl}};
}
