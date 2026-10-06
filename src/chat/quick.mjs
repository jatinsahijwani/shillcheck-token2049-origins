import {RULES} from '../config.mjs';
import {round} from '../analysis.mjs';
const usd=n=>`$${n>=100?Math.round(n).toLocaleString('en-US'):Number(n).toFixed(2)}`;
const pct=(n,d=0)=>`${n>=0?'':'−'}${Math.abs(round(n,d))}%`;
const int=n=>Math.round(n).toLocaleString('en-US');
// Numbers only: this is what the chat model sees. It never contains post text, bios or other free text from X.
export function quickFacts(report,askedFee=null){
 const k=report.analyses[0],d=report.decision.decisions[0];
 const base={report_id:report.id,handle:k.handle,status:k.status};
 if(k.status!=='ok')return {...base,verdict:'Not rated',reason:d.verdict.reason,could_not_verify:[d.verdict.reason]};
 const o=d.outcomes;
 const fair=d.fair?.usd??null;
 return {...base,verdict:d.verdict.label,reasons:d.verdict.reasons,asked_fee_usd:askedFee,fair_price_usd:fair,fee_vs_fair:askedFee&&fair?round(askedFee/fair,2):null,
  followers:k.profile.followers,median_views:k.posts.medianViews??k.posts.avgViews,mean_views:Math.round(k.posts.avgViews),engagement_rate_pct:k.posts.engagementRate===null?null:round(k.posts.engagementRate*100,3),
  bot_share_pct:d.botShare===null||d.botShare===undefined?null:Math.round(d.botShare*100),est_real_views:d.estRealViews===null?null:Math.round(d.estRealViews),
  promoted_tokens_found:k.promos.length,promoted_priced_30d:o.priced30,median_30d_pct:o.median30===null?null:Math.round(o.median30),worst_30d_pct:o.worst30===null?null:Math.round(o.worst30),
  data:{live_x_reads:report.usage?.xCalls>0,as_of:report.asOf},could_not_verify:k.couldNotVerify.slice(0,6)};
}
// Short, deterministic verdict block for chat. Expanded from the marker, so the model never writes these numbers.
export function renderQuick(report,{askedFee=null}={}){
 const k=report.analyses[0],d=report.decision.decisions[0];
 const link=`https://x.com/${k.handle}`;
 if(k.status==='not_found')return `**@${k.handle}**: I could not find that handle on X. Check the spelling and try again.\n`;
 if(k.status==='invalid')return `"${k.handle}" is not a valid X handle. Send it like @name.\n`;
 if(k.status!=='ok')return `**@${k.handle}**: could not verify (${d.verdict.reason}). ${report.usage?.xCalls===0&&/not in cache/.test(k.error??'')?'This handle is not in my cache and live X reads are off to protect the budget.':''}\n`;
 const o=d.outcomes,fair=d.fair?.usd;
 const out=[];
 let headline=`@${k.handle}: ${d.verdict.label}`,feeNote='';
 if(askedFee&&fair!==undefined){
  const ratio=askedFee/fair;
  feeNote=ratio<=1?`${usd(askedFee)} is within the estimated fair price of ${usd(fair)}.`:ratio<=RULES.negotiateFeeFactor?`${usd(askedFee)} is ${Math.round((ratio-1)*100)}% above the estimated fair price of ${usd(fair)}. Worth negotiating down.`:`${usd(askedFee)} is ${round(ratio,1)}x the estimated fair price of ${usd(fair)}.${d.verdict.label==='Avoid'?'':' That alone puts them at Negotiate.'}`;
  headline=d.verdict.label==='Avoid'?`Not at ${usd(askedFee)}: @${k.handle} is rated Avoid`:d.verdict.label==='Hire'&&ratio<=1?`Yes, ${usd(askedFee)} is fair for @${k.handle}`:`Only at a lower price than ${usd(askedFee)}`;
 }
 out.push(`**${headline}.**`);
 out.push(`[@${k.handle}](${link}) is rated **${d.verdict.label}**: ${d.verdict.reason}.${feeNote?' '+feeNote:''}`);
 if(fair!==undefined)out.push(`- Fair price (estimate): **${usd(fair)}** = ${int(d.estRealViews)} est. real views per post ÷ 1000 × $${d.fair.cpmUsd} CPM × ${d.fair.multiplier} outcome multiplier.`);
 out.push(`- Reach: [${int(k.profile.followers)} followers](${link}), median ${int(k.posts.medianViews??k.posts.avgViews)} views per post, engagement ${round(k.posts.engagementRate*100,2)}% of followers.`);
 out.push(d.botShare===null||d.botShare===undefined?`- Bot check: could not verify (${k.replies.reason}). Views are not adjusted for bots.`:`- Bot check (estimate): ${Math.round(d.botShare*100)}% of ${k.replies.checked} sampled repliers show 2+ bot signals.`);
 out.push(o.priced30?`- Past promotions: ${o.priced30} priced at 30 days, median ${pct(o.median30)}, worst ${pct(o.worst30)}${o.dumped?` (${o.dumped} fell more than 70%)`:''}.`:k.promos.length?`- Past promotions: ${k.promos.length} found, none with a completed 30-day price yet.`:'- Past promotions: none found for non-major coins in the fetched posts.');
 const live=report.usage?.xCalls>0;
 out.push(`_Data: ${live?'live X read':'cached X read (up to 48h old)'}, prices from CoinGecko. Estimates, not statements about intent.${k.couldNotVerify.length?` Could not verify: ${k.couldNotVerify.length} item(s).`:''}_`);
 return out.filter(Boolean).join('\n')+'\n';
}
