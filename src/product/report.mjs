import {TIERS} from './budget.mjs';
const usd=n=>`$${Math.round(n).toLocaleString('en-US')}`;
const int=n=>Math.round(n).toLocaleString('en-US');
const cell=s=>String(s).replace(/\|/g,'/').replace(/\s+/g,' ').trim();
export function renderPlan({id,asOf,brief,product,hadImage,imageNote,search,strategy,budget,budgetRows,notes=[]}){
 const L=[];
 L.push(`# ShillCheck product campaign plan ${id}`,'',`_BETA. Generated ${asOf.slice(0,10)}. Real creators come from a live X search; the product read and strategy are AI-written; every number in the budget table is computed by code._`,'');
 L.push('## Summary','');
 L.push(`- **Product:** ${cell(product.product_type)} (${cell(product.category)}), ${product.price_tier_guess} price tier (AI guess).`);
 L.push(`- **Budget:** ${budget?usd(budget):'not given'}${brief.region?`, region: ${brief.region}`:''}.`);
 L.push(`- **Creators found:** ${search.creators?.length??0} on X${search.status==='ok'?` (from ${search.postsRead} matching posts, ${search.fromCache?'cached search':`search cost about $${search.costUsd}`})`:''}. None are vetted yet.`,'');
 L.push('## Product read','',`${hadImage?'**AI read of your photo.**':'**AI read of your description (no photo was used).**'} Check it: if it is wrong, reply with a correction and the plan changes.`,'');
 L.push(`- Type: ${cell(product.product_type)}`,`- Category: ${cell(product.category)}`,`- Price tier (guess): ${product.price_tier_guess}`,`- Visual style: ${cell(product.visual_style)}`,`- Target audience: ${cell(product.target_audience)}`,`- Search keywords used: ${product.search_keywords.map(k=>`\`${cell(k)}\``).join(', ')}`,'');
 if(strategy){
  L.push('## Strategy','',`**Goal:** ${cell(strategy.campaign_goal)}`,'',`**Audience:** ${cell(strategy.audience)}`,'','**Content angles**','');
  strategy.content_angles.forEach((a,i)=>L.push(`${i+1}. **${cell(a.title)}**: ${cell(a.idea)}`));
  L.push('','**Platform mix**','','| Platform | Status |','|---|---|','| X | Live: creator discovery and this plan |','| Instagram | Coming soon |','| YouTube | Coming soon |','| TikTok | Coming soon |','','**4-week timeline**','','| Week | Focus | Actions |','|---|---|---|');
  strategy.timeline.forEach(w=>L.push(`| ${w.week} | ${cell(w.focus)} | ${cell(w.actions)} |`));
  L.push('');
 }
 L.push('## Budget','');
 if(budgetRows){
  L.push('| Creator tier | Followers | Est. fee per post | Budget | Share | Est. posts | Shortlisted |','|---|---|---|---|---|---|---|');
  for(const r of budgetRows)L.push(`| ${r.tier} | ${r.followers} | ${r.feeRange?`${usd(r.feeRange[0])} to ${usd(r.feeRange[1])}`:'n/a'} | ${usd(r.usd)} | ${r.sharePct}% | ${r.posts??'n/a'} | ${r.shortlisted??'n/a'} |`);
  L.push('',`Fee ranges are conservative **estimates**, not quotes; real fees vary by creator. Totals: ${usd(budgetRows.reduce((n,r)=>n+r.usd,0))} of ${usd(budget)}.`);
 }else{
  L.push('No budget was given, so there is no split. Conservative per-post fee **estimates** by tier:','','| Creator tier | Followers | Est. fee per post |','|---|---|---|');
  for(const t of TIERS)L.push(`| ${t.name} | ${int(t.min)}${Number.isFinite(t.max)?` to ${int(t.max)}`:'+'} | ${usd(t.fee[0])} to ${usd(t.fee[1])} |`);
 }
 L.push('','## Creator shortlist (X)','');
 if(search.creators?.length){
  L.push('| Creator | Followers | Matching post | Status |','|---|---|---|---|');
  for(const c of search.creators)L.push(`| [@${c.handle}](${c.url}) | ${int(c.followers)} | [post](${c.postUrl}) | Not yet vetted: run a full ShillCheck vet |`);
  L.push('','Ranked by followers and engagement on posts that match the keywords (at least 5,000 followers; obvious brand accounts removed). Handles come straight from X.');
 }else L.push(search.status==='ok'||search.status==='empty'?'The X search returned no creators that pass the filters (at least 5,000 followers, not a brand account). Nothing is shown rather than guessed.':`Creator search did not run: ${search.reason??'unavailable'}. Nothing is shown rather than guessed.`);
 L.push('','## Competitors (AI-suggested)','',product.likely_competitors.map(c=>`- ${cell(c)}`).join('\n'),'');
 if(strategy){L.push('**What to differentiate on**','');strategy.differentiate.forEach(d=>L.push(`- ${cell(d)}`));L.push('')}
 L.push('## What ShillCheck will add next','','- Vet every shortlisted creator with a full ShillCheck report: real versus bot reach, past promotion outcomes, red flags and a fair price.','- Audience fit scoring against your target audience.','- Pay on results: release payment only when agreed outcomes are met.','');
 const cnv=[...notes];
 if(!hadImage)cnv.push('No photo was used, so the product read rests on your description alone.');
 cnv.push('Creator audience fit, real reach and fees were not checked; shortlisted creators are unvetted.','Competitors and the product read are AI suggestions, not verified.','Instagram, YouTube and TikTok are not analysed yet.');
 L.push('## Could not verify','',...cnv.map(n=>`- ${n}`));
 return L.join('\n');
}
