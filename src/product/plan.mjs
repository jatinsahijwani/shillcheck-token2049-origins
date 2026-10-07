import {randomBytes} from 'node:crypto';
import {parseProductBrief} from './input.mjs';
import {fetchImageDataUrl} from './image.mjs';
import {createJsonLlm} from './llm.mjs';
import {understandProduct} from './understand.mjs';
import {discoverCreators} from './discover.mjs';
import {planStrategy} from './strategy.mjs';
import {splitBudget} from './budget.mjs';
import {renderPlan} from './report.mjs';
import {createCache} from '../cache.mjs';
import {createLedger} from '../spend-ledger.mjs';
import {cacheDir,ledgerPath,isMock} from '../config.mjs';
export const NEED_DESCRIPTION='I could not read the product reliably. Reply with a short description (what it is, what category, who it is for) and an optional photo link, plus your budget, and I will make the plan.';
export const productModeEnabled=(env=process.env)=>env.PRODUCT_MODE_ENABLED==='true';
// Product campaign planner. Never throws for bad input; returns markdown. Only the language model being down throws.
export async function planProduct(input,{env=process.env,fetchImpl=fetch,imageFetch,llm,cache,ledger,now=Date.now(),resolve}={}){
 const brief=parseProductBrief(input);
 llm??=createJsonLlm({env,fetchImpl});
 cache??=createCache({dir:isMock(env)?undefined:cacheDir(env)});
 ledger??=createLedger({path:isMock(env)?undefined:ledgerPath(env)});
 const notes=[];
 let imageDataUrl=null;
 if(brief.imageUrl){
  try{imageDataUrl=await fetchImageDataUrl(brief.imageUrl,{fetchImpl:imageFetch??fetchImpl,...(resolve?{resolve}:{})})}
  catch(error){notes.push(`The photo could not be used (${String(error.message).slice(0,80)}).`)}
 }
 if(!imageDataUrl&&brief.description.length<12)return `${NEED_DESCRIPTION}${notes.length?`\n\n(${notes[0]})`:''}`;
 const product=await understandProduct({imageDataUrl,description:brief.description,region:brief.region},{llm});
 if(!product)return NEED_DESCRIPTION;
 const search=await discoverCreators({keywords:product.search_keywords,region:brief.region,competitors:product.likely_competitors},{env,fetchImpl,cache,ledger});
 if(search.status==='error'||search.status==='skipped')notes.push(`Creator search: ${search.reason}.`);
 const strategy=await planStrategy({product,creators:search.creators??[],budgetUsd:brief.budget_usd,region:brief.region},{llm}).catch(()=>null);
 if(!strategy)notes.push('The strategy section could not be generated reliably, so it is omitted.');
 const budgetRows=brief.budget_usd?splitBudget(brief.budget_usd,search.creators??[]):null;
 return renderPlan({id:`ppl_${randomBytes(6).toString('hex')}`,asOf:new Date(now).toISOString(),brief,product,hadImage:Boolean(imageDataUrl),search,strategy,budget:brief.budget_usd,budgetRows,notes});
}
// Short chat answer: product read and a budget split by tier, no X search (chat spends nothing on X), then the offer of the full Task.
export async function planProductChat(input,{env=process.env,fetchImpl=fetch,imageFetch,llm,resolve}={}){
 const brief=parseProductBrief(input);
 llm??=createJsonLlm({env,fetchImpl});
 let imageDataUrl=null;
 if(brief.imageUrl)try{imageDataUrl=await fetchImageDataUrl(brief.imageUrl,{fetchImpl:imageFetch??fetchImpl,...(resolve?{resolve}:{})})}catch{}
 const product=brief.description.length>=12||imageDataUrl?await understandProduct({imageDataUrl,description:brief.description,region:brief.region},{llm}):null;
 if(!product)return 'I can plan an influencer campaign for a product. Tell me what it is, who it is for, your budget and region (a photo link helps).';
 const rows=brief.budget_usd?splitBudget(brief.budget_usd,[]):null;
 const usd=n=>`$${Math.round(n).toLocaleString('en-US')}`;
 return [`**Quick read (AI):** ${product.product_type}, ${product.category}, ${product.price_tier_guess} tier. Audience: ${product.target_audience}.`,
  `Search terms I would use on X: ${product.search_keywords.slice(0,5).join(', ')}.`,
  rows?`Rough split of ${usd(brief.budget_usd)} (fee ranges are estimates): ${rows.filter(r=>r.posts!==null).map(r=>`${r.tier} ${usd(r.usd)}`).join(', ')}, plus ${usd(rows.at(-1).usd)} reserve.`:'Tell me your budget and I will sketch a split.',
  'For real creator handles from X, a 4-week plan and the full report, create a Task with the same brief (photo link, budget, region).'].join('\n\n');
}
