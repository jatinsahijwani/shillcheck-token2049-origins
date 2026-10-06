import {RULES} from './config.mjs';
import {estimateRealViews,fairPrice,rankKols,round,splitBudget,summarizeOutcomes,verdict} from './analysis.mjs';
import {regionFit} from './region.mjs';
const lc=h=>String(h).toLowerCase();
// Merge a follow-up onto the stored constraints. Earlier constraints stay unless the new value replaces them.
export function mergeConstraints(prior={},update={}){
 const pick=k=>update[k]!==undefined&&update[k]!==null&&update[k]!==''?update[k]:prior[k];
 const quoted={};
 for(const src of [prior.quoted_fees,update.quoted_fees])for(const [h,v] of Object.entries(src??{}))if(Number.isFinite(Number(v)))quoted[lc(h).replace(/^@/,'')]=Number(v);
 const exclude=[...new Set([...(prior.exclude_handles??[]),...(update.exclude_handles??[])].map(h=>lc(h).replace(/^@/,'')))].sort();
 return {budget_usd:pick('budget_usd'),goal:pick('goal'),niche:pick('niche'),region:pick('region'),cpm_usd:pick('cpm_usd'),max_fee_usd:pick('max_fee_usd'),quoted_fees:quoted,exclude_handles:exclude};
}
// Pure decision layer: facts + constraints in, fair price / verdict / ranking / budget out. No network.
export function decide(kols,constraints){
 const cpm=Number(constraints.cpm_usd)>0?Number(constraints.cpm_usd):RULES.defaultCpmUsd;
 const maxFee=Number(constraints.max_fee_usd)>0?Number(constraints.max_fee_usd):null;
 const excludeSet=new Set(constraints.exclude_handles??[]);
 const decisions=kols.map(k=>{
  const key=lc(k.handle);
  if(k.status!=='ok')return {handle:k.handle,excluded:excludeSet.has(key)?'excluded by request':null,verdict:{label:'Not rated',reasons:[],reason:k.status==='not_found'?'handle not found on X':k.status==='invalid'?'not a valid X handle':`data could not be retrieved${k.error?` (${k.error})`:''}`},estRealViews:null,fair:null};
  const outcomes=summarizeOutcomes(k.promos);
  const botShare=k.replies.share??null;
  const avgViews=k.posts.viewsAvailable?k.posts.avgViews:null;
  const estRealViews=avgViews===null?null:estimateRealViews(avgViews,botShare);
  const fair=estRealViews===null?null:fairPrice({estRealViews,cpmUsd:cpm,median30:outcomes.median30});
  const quotedFee=constraints.quoted_fees?.[key]??null;
  const v=verdict({botShare,outcomes,engagementRate:k.posts.engagementRate,undisclosedContractPromos:k.promos.filter(p=>p.via==='contract'&&!p.disclosed).length,quotedFee,fairUsd:fair?.usd});
  const fit=regionFit(constraints.region,k.profile.location);
  let excluded=null;
  if(excludeSet.has(key))excluded='excluded by request';
  else if(maxFee!==null&&quotedFee!==null&&quotedFee>maxFee)excluded=`quoted fee $${Math.round(quotedFee)} is above the $${Math.round(maxFee)} cap`;
  return {handle:k.handle,excluded,verdict:v,estRealViews,botShare,outcomes,fair,quotedFee,regionFit:fit,regionOrder:fit==='match'?0:fit==='unknown'||fit==='n/a'?1:2};
 });
 const active=decisions.filter(d=>!d.excluded);
 const ranked=rankKols(active.map(d=>({...d})));
 let budget=null;
 if(Number(constraints.budget_usd)>0){
  const total=Number(constraints.budget_usd);
  const candidates=active.filter(d=>['Hire','Negotiate'].includes(d.verdict.label)&&d.fair&&d.regionFit!=='mismatch').map(d=>({handle:d.handle,verdict:d.verdict.label,weight:d.fair.usd,cap:Math.min(d.fair.usd,maxFee??Infinity)}));
  const split=splitBudget({budget:total,candidates});
  budget={total,cpm,maxFee,...split,allocated:round(total-split.unallocated)};
 }
 return {cpm,maxFee,decisions,ranked:ranked.map(d=>d.handle),excluded:decisions.filter(d=>d.excluded).map(d=>({handle:d.handle,reason:d.excluded})),budget};
}
