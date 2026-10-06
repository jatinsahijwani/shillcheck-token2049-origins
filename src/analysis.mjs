import {RULES} from './config.mjs';
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
export const round=(n,d=2)=>Math.round(n*10**d)/10**d;
export function median(xs){
 if(!xs.length)return null;
 const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;
 return s.length%2?s[m]:(s[m-1]+s[m])/2;
}
// ---- reach -----------------------------------------------------------------
export function postStats(posts,followers){
 const sample=[...posts].sort((a,b)=>a.created_at<b.created_at?1:-1).slice(0,RULES.originalPostsForAverages);
 const avg=k=>mean(sample.map(p=>Number(p.metrics?.[k])||0));
 const out={n:sample.length,avgViews:avg('impression_count'),avgLikes:avg('like_count'),avgReposts:avg('retweet_count'),avgReplies:avg('reply_count'),avgQuotes:avg('quote_count')};
 const interactions=out.avgLikes+out.avgReposts+out.avgReplies+out.avgQuotes;
 out.engagementRate=followers>0?interactions/followers:null;
 out.viewRate=followers>0?out.avgViews/followers:null;
 out.viewsAvailable=sample.some(p=>Number(p.metrics?.impression_count)>0);
 out.from=sample.at(-1)?.created_at??null;out.to=sample[0]?.created_at??null;
 return out;
}
// ---- bot score ---------------------------------------------------------------
const GENERIC=new Set(['lfg','gm','gn','wagmi','bullish','moon','mooning','100x','1000x','lets','let','go','to','the','great','nice','wow','based','fire','gem','amazing','awesome','good','soon','huge','big','pump','send','it','this','is','so','love','king','legend','wen','ser','fam','yes','yess','yesss','up','only','bro','sir','cool','top','best','project','early','buy','buying','lfgg','lfggg','next','1000x']);
const normalizeText=t=>String(t??'').replace(/https?:\/\/\S+/g,' ').replace(/@\w+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
export function isGenericHype(text){
 const stripped=normalizeText(text);
 const words=stripped.split(/[^a-z0-9']+/).filter(Boolean);
 if(!words.length)return true; // emoji or punctuation only
 return words.length<=6&&words.every(w=>GENERIC.has(w));
}
export function botSignals(reply,duplicates,now){
 const u=reply.author;const signals=[];
 if(!u)return {signals:[],known:false};
 const ageDays=u.created_at?(now-Date.parse(u.created_at))/86400000:null;
 if(ageDays!==null&&ageDays<RULES.botAgeDays)signals.push('account age under 90 days');
 if(/default_profile_images/.test(u.profile_image_url??''))signals.push('default avatar');
 if((u.public_metrics?.followers_count??Infinity)<RULES.botFollowers)signals.push('fewer than 10 followers');
 if(isGenericHype(reply.text))signals.push('generic hype-only text');
 if(duplicates.has(normalizeText(reply.text))&&normalizeText(reply.text))signals.push('duplicate reply text');
 return {signals,known:true};
}
export function replyQuality(replies,now){
 const seen=new Set(),unique=[];
 for(const r of replies){const id=r.author?.id??r.id;if(seen.has(id))continue;seen.add(id);unique.push(r)}
 const sample=unique.slice(0,RULES.replySample);
 const counts=new Map();
 for(const r of sample){const k=normalizeText(r.text);counts.set(k,(counts.get(k)??0)+1)}
 const duplicates=new Set([...counts].filter(([,n])=>n>1).map(([k])=>k));
 const signalCounts={};let botLike=0;
 for(const r of sample){
  const {signals}=botSignals(r,duplicates,now);
  for(const s of signals)signalCounts[s]=(signalCounts[s]??0)+1;
  if(signals.length>=RULES.botSignalsNeeded)botLike++;
 }
 const checked=sample.length;
 return {checked,botLike,share:checked>=RULES.minReplySample?botLike/checked:null,signalCounts,sufficient:checked>=RULES.minReplySample};
}
export const estimateRealViews=(avgViews,botShare)=>avgViews*(1-(botShare??0));
// ---- promotion outcomes ---------------------------------------------------------
export function summarizeOutcomes(promos){
 const done=promos.map(p=>p.outcome?.pct30).filter(Number.isFinite);
 return {priced30:done.length,median30:median(done),worst30:done.length?Math.min(...done):null,dumped:done.filter(p=>p<RULES.dumpPct).length};
}
// ---- fair price -----------------------------------------------------------------
export function outcomeMultiplier(median30){
 if(median30===null||median30===undefined)return 1;
 if(median30<=RULES.avoidMedianPct)return 0.5;
 if(median30<=RULES.negotiateMedianPct)return 0.75;
 return 1;
}
export function fairPrice({estRealViews,cpmUsd,median30}){
 const multiplier=outcomeMultiplier(median30);
 return {usd:round(estRealViews/1000*cpmUsd*multiplier),baseUsd:round(estRealViews/1000*cpmUsd),cpmUsd,multiplier,estRealViews:Math.round(estRealViews),formula:`est. real views ÷ 1000 × CPM × outcome multiplier`};
}
// ---- verdict ---------------------------------------------------------------------
const signed=n=>`${n<0?'−':''}${Math.abs(round(n,0))}%`;
export const TIER={Hire:0,Negotiate:1,Avoid:2,'Not rated':3};
export function verdict({botShare,outcomes,engagementRate,undisclosedContractPromos,quotedFee,fairUsd}){
 const avoid=[],negotiate=[];
 const pct=x=>`${Math.round(x*100)}%`;
 if(botShare!==null&&botShare>=RULES.avoidBotShare)avoid.push(`${pct(botShare)} of sampled repliers show 2+ bot signals (threshold ${pct(RULES.avoidBotShare)})`);
 if(outcomes.dumped>=2)avoid.push(`${outcomes.dumped} promoted tokens were down more than 70% at 30 days`);
 if(outcomes.median30!==null&&outcomes.median30<=RULES.avoidMedianPct&&outcomes.priced30>=RULES.avoidMinPromos)avoid.push(`median 30-day price change ${signed(outcomes.median30)} across ${outcomes.priced30} promoted tokens`);
 if(avoid.length)return {label:'Avoid',reasons:avoid,reason:avoid[0]};
 if(botShare!==null&&botShare>=RULES.negotiateBotShare)negotiate.push(`${pct(botShare)} of sampled repliers show 2+ bot signals (range ${pct(RULES.negotiateBotShare)}-${pct(RULES.avoidBotShare)})`);
 if(engagementRate!==null&&engagementRate<RULES.lowEngagementRate)negotiate.push(`engagement is ${round(engagementRate*100,3)}% of followers (threshold ${RULES.lowEngagementRate*100}%)`);
 if(undisclosedContractPromos>0)negotiate.push(`${undisclosedContractPromos} contract-address promotion(s) without a disclosure word in the post`);
 if(outcomes.median30!==null&&outcomes.median30<=RULES.negotiateMedianPct)negotiate.push(`median 30-day price change ${signed(outcomes.median30)} across ${outcomes.priced30} promoted tokens`);
 if(Number.isFinite(quotedFee)&&Number.isFinite(fairUsd)&&quotedFee>fairUsd*RULES.negotiateFeeFactor)negotiate.push(`quoted fee $${Math.round(quotedFee)} is ${round(quotedFee/fairUsd,1)}x the fair price`);
 if(negotiate.length)return {label:'Negotiate',reasons:negotiate,reason:negotiate[0]};
 return {label:'Hire',reasons:[],reason:'No rule-based concern found in the sampled data'};
}
export function rankKols(kols){
 return [...kols].sort((a,b)=>TIER[a.verdict.label]-TIER[b.verdict.label]||(a.regionOrder??0)-(b.regionOrder??0)||(b.estRealViews??-1)-(a.estRealViews??-1)||(a.handle.toLowerCase()<b.handle.toLowerCase()?-1:1));
}
// ---- budget split ----------------------------------------------------------------
// Hire tier is funded first, then Negotiate. Within a tier, money is shared pro rata to fair price and capped at it.
export function splitBudget({budget,candidates}){
 const alloc=new Map(candidates.map(c=>[c.handle,0]));
 let left=budget;
 for(const label of ['Hire','Negotiate']){
  let tier=candidates.filter(c=>c.verdict===label&&c.cap>0);
  while(tier.length&&left>0.005){
   const weight=tier.reduce((n,c)=>n+c.weight,0);
   const room=c=>c.cap-alloc.get(c.handle);
   let spent=0;const next=[];
   for(const c of tier){
    const give=Math.min(room(c),left*c.weight/weight);
    alloc.set(c.handle,alloc.get(c.handle)+give);spent+=give;
    if(room(c)>0.005)next.push(c);
   }
   left-=spent;
   if(next.length===tier.length||spent<0.005)break;
   tier=next;
  }
 }
 return {allocations:Object.fromEntries([...alloc].map(([h,v])=>[h,round(v)])),unallocated:round(Math.max(0,left))};
}
