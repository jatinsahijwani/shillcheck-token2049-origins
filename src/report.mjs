import {RULES} from './config.mjs';
import {round} from './analysis.mjs';
const L=(text,url)=>url?`[${text}](${url})`:String(text);
const avg=n=>n>=100?int(n):String(round(n,1));
const int=n=>Math.round(n).toLocaleString('en-US');
const usd=n=>`$${n>=100?int(n):n.toFixed(2)}`;
const pct=(n,d=0)=>`${n>=0?'':'−'}${Math.abs(round(n,d))}%`;
const share=n=>`${round(n*100,n<0.1?1:0)}%`;
const price=p=>p>=1?`$${p.toFixed(2)}`:`$${Number(p.toPrecision(3))}`;
const symbolOf=p=>p.coin?.symbol?String(p.coin.symbol).toUpperCase():p.ref.kind==='cashtag'?p.ref.value:`${p.ref.value.slice(0,6)}…${p.ref.value.slice(-4)}`;
const day=iso=>iso?.slice(0,10)??'n/a';
const cgPage=p=>p.coin?.url;
function priceCell(p,value,change){
 if(value===null||value===undefined)return '—';
 const text=`${price(value)}${change===null||change===undefined?'':` (${pct(change)})`}`;
 return L(text,cgPage(p)??(p.outcome?.source==='defillama'?'https://defillama.com/':undefined));
}
function outcomeRow(p){
 const o=p.outcome??{};
 const status=o.status==='ok'?'priced':o.status==='pending'?`pending (${o.ageDays}d old)`:o.status==='out_of_range'?'out of range (>365d)':`could not verify`;
 const coin=p.coin?L(`${symbolOf(p)}`,p.coin.url):`${symbolOf(p)}`;
 const t0=o.p0===undefined?'—':priceCell(p,o.p0,null);
 const d7=o.status==='unverified'||o.status==='out_of_range'?'—':o.p7===null||o.p7===undefined?'pending':priceCell(p,o.p7,o.pct7);
 const d30=o.status==='unverified'||o.status==='out_of_range'?'—':o.p30===null||o.p30===undefined?'pending':priceCell(p,o.p30,o.pct30);
 return `| ${coin} | ${p.via} | ${L(day(p.postDate),p.postUrl)}${p.postCount>1?` (+${p.postCount-1} more)`:''} | ${t0} | ${d7} | ${d30} | ${p.disclosed?'disclosure word present':'no disclosure word'}${p.hype?', hype wording':''} | ${status}${o.status==='unverified'&&o.reason?`: ${o.reason}`:''} |`;
}
function flags(k,d){
 const out=[];
 if(d.botShare!==null&&d.botShare!==undefined&&d.botShare>=RULES.negotiateBotShare)out.push(`${share(d.botShare)} of ${k.replies.checked} sampled repliers show 2 or more bot signals (estimate).`);
 for(const p of k.promos){const o=p.outcome;if(o?.pct30!==null&&o?.pct30!==undefined&&o.pct30<RULES.dumpPct)out.push(`${symbolOf(p)} fell ${pct(Math.abs(o.pct30))} within 30 days of the post (${L('post',p.postUrl)}, ${p.coin?L('CoinGecko',p.coin.url):'price source'}).`)}
 const und=k.promos.filter(p=>p.via==='contract'&&!p.disclosed);
 for(const p of und)out.push(`Contract-address post without a disclosure word: ${L(day(p.postDate),p.postUrl)}.`);
 if(k.posts.engagementRate!==null&&k.posts.engagementRate<RULES.lowEngagementRate)out.push(`Average engagement is ${round(k.posts.engagementRate*100,3)}% of followers, below the ${RULES.lowEngagementRate*100}% threshold (${L('profile',k.profile.url)}).`);
 if(d.quotedFee&&d.fair&&d.quotedFee>d.fair.usd*RULES.negotiateFeeFactor)out.push(`Quoted fee ${usd(d.quotedFee)} is ${round(d.quotedFee/d.fair.usd,1)}x the fair price below.`);
 return out;
}
function kolSection(k,d,rank,constraints){
 const link=k.profile.url;
 const s=[`### ${rank}. ${L('@'+k.handle,link)}: **${d.verdict.label}**`,`${d.verdict.reason}.`,''];
 const p=k.posts;
 s.push('**Real reach**');
 s.push(`- Followers: ${L(int(k.profile.followers),link)}${k.profile.location?` · self-reported location: ${k.profile.location}`:''}`);
 s.push(`- Averages over the last ${p.n} original posts (${day(p.from)} to ${day(p.to)}): views ${L(int(p.avgViews),link)}, likes ${L(avg(p.avgLikes),link)}, reposts ${L(avg(p.avgReposts),link)}, replies ${L(avg(p.avgReplies),link)}, quotes ${L(avg(p.avgQuotes),link)}`);
 s.push(`- Engagement rate: ${L(round(p.engagementRate*100,3)+'%',link)} of followers · view rate: ${L(round(p.viewRate*100,1)+'%',link)} of followers`);
 if(k.replies.status==='ok'){
  const sig=Object.entries(k.replies.signalCounts).sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)).map(([n,c])=>`${n}: ${c}`).join('; ')||'none';
  s.push(`- Reply sample: ${k.replies.checked} unique repliers across ${k.replies.sampledPosts.map(u=>L('post',u)).join(', ')}. Bot-like (2 or more signals): ${L(`${k.replies.botLike} (${share(k.replies.share)})`,k.replies.sampledPosts[0])}. Signals seen: ${sig}. **ESTIMATE**`);
 }else s.push(`- Reply sample: could not verify. ${k.replies.reason}.`);
 if(d.estRealViews!==null)s.push(`- Estimated real views per post (**ESTIMATE**): ${int(k.posts.avgViews)} × (1 − ${d.botShare===null?'0 (no bot adjustment)':round(d.botShare,2)}) = **${int(d.estRealViews)}**`);
 s.push('');
 s.push('**Promotion track record**');
 if(!k.promos.length)s.push(`No ticker, contract-address or promo-wording posts for non-major coins were found in the ${p.n} posts fetched.`);
 else{
  s.push('| Coin | Via | First post | Price at post | +7 days | +30 days | Wording | Status |','|---|---|---|---|---|---|---|---|');
  for(const row of k.promos)s.push(outcomeRow(row));
  const o=d.outcomes;
  s.push('',o.priced30?`Median 30-day change: **${pct(o.median30)}** · worst: **${pct(o.worst30)}** across ${o.priced30} token(s) with a 30-day price.`:'No promoted token has a completed 30-day price yet.');
 }
 s.push('');
 const f=flags(k,d);
 s.push('**Red flags (facts from the sampled data)**',...(f.length?f.map(x=>`- ${x}`):['- None found by the rules below.']),'');
 s.push('**Fair price (ESTIMATE)**');
 if(d.fair){
  const pr=d.fair;
  s.push(`- ${int(pr.estRealViews)} est. real views ÷ 1000 × $${pr.cpmUsd} CPM × ${pr.multiplier} outcome multiplier = **${usd(pr.usd)}**`);
  if(d.quotedFee)s.push(`- Quoted fee: ${usd(d.quotedFee)}`);
 }else s.push('- Could not verify: view counts were unavailable.');
 s.push('',`**Verdict: ${d.verdict.label}.** ${d.verdict.reasons.length>1?d.verdict.reasons.join('; ')+'.':d.verdict.reason+'.'}`,'');
 return s;
}
export function renderReport(report){
 const {analyses,decision,constraints}=report;
 const dec=new Map(decision.decisions.map(d=>[d.handle,d]));
 const kol=new Map(analyses.map(k=>[k.handle,k]));
 const o=[];
 o.push(`# ShillCheck report ${report.id}`);
 if(report.mock)o.push('','> **MOCK DATA.** Fixture accounts and prices. Nothing below describes real people or tokens.');
 o.push('',`Data as of ${report.asOf.slice(0,16).replace('T',' ')} UTC from X API v2, CoinGecko and DefiLlama. Figures are estimates from public data about past posts and prices; they are not statements about anyone's intent.`);
 const assumptions=[];
 assumptions.push(constraints.budget_usd?`Budget ${usd(Number(constraints.budget_usd))} (given).`:'Budget not given: fair prices only, no split.');
 assumptions.push(Number(constraints.cpm_usd)>0?`CPM $${constraints.cpm_usd} (given).`:`CPM $${RULES.defaultCpmUsd} per 1,000 real views (default).`);
 if(constraints.goal)assumptions.push(`Goal: ${constraints.goal}.`);
 if(constraints.niche)assumptions.push(`Niche/chain: ${constraints.niche}.`);
 if(constraints.region)assumptions.push(`Region focus: ${constraints.region}. Location is self-reported; blank means unknown.`);
 if(constraints.max_fee_usd)assumptions.push(`Fee cap: ${usd(Number(constraints.max_fee_usd))} per KOL.`);
 if(constraints.exclude_handles?.length)assumptions.push(`Excluded by request: ${constraints.exclude_handles.map(h=>'@'+h).join(', ')}.`);
 assumptions.push(...report.notes);
 o.push('','**Assumptions**',...assumptions.map(a=>`- ${a}`));
 const ranked=decision.ranked.map(h=>({d:dec.get(h),k:kol.get(h)}));
 const unrated=analyses.filter(k=>k.status!=='ok'&&!decision.excluded.some(e=>e.handle===k.handle));
 o.push('','## Summary','','| # | KOL | Verdict | Followers | Avg views | Bot-like replies (est.) | Est. real views | Median 30-day | Fair price (est.) |','|---|---|---|---|---|---|---|---|---|');
 ranked.forEach(({d,k},i)=>{
  if(k.status!=='ok')return;
  const link=k.profile.url,first=k.promos.find(p=>p.outcome?.pct30!==null&&p.outcome?.pct30!==undefined);
  o.push(`| ${i+1} | ${L('@'+k.handle,link)} | **${d.verdict.label}** | ${L(int(k.profile.followers),link)} | ${L(int(k.posts.avgViews),link)} | ${d.botShare===null||d.botShare===undefined?'could not verify':L(share(d.botShare),k.replies.sampledPosts?.[0]??link)} | ${d.estRealViews===null?'could not verify':L(int(d.estRealViews),link)} | ${d.outcomes.median30===null?'n/a':L(pct(d.outcomes.median30),cgPage(first)??link)} | ${d.fair?L(usd(d.fair.usd),link):'could not verify'} |`);
 });
 for(const k of unrated)o.push(`| – | ${k.status==='invalid'?k.handle:L('@'+k.handle,`https://x.com/${k.handle}`)} | Not rated | – | – | – | – | – | ${k.status==='not_found'?'not found':'could not verify'} |`);
 o.push('','## Key takeaways','');
 const top=ranked.find(r=>r.k.status==='ok');
 const counts=l=>ranked.filter(r=>r.d.verdict.label===l).length;
 o.push(top?`- Highest ranked: ${L('@'+top.k.handle,top.k.profile.url)} (${top.d.verdict.label}), about ${top.d.estRealViews===null?'an unverified number of':int(top.d.estRealViews)} estimated real views per post${top.d.fair?` and a fair price of ${usd(top.d.fair.usd)}`:''}.`:'- No handle could be rated from the available data.');
 const worst=ranked.find(r=>r.d.verdict.label==='Avoid');
 o.push(`- Verdict count: ${counts('Hire')} Hire, ${counts('Negotiate')} Negotiate, ${counts('Avoid')} Avoid, ${unrated.length} not rated.${worst?` Example: @${worst.k.handle}: ${worst.d.verdict.reason}.`:''}`);
 const b=decision.budget;
 if(b)o.push(`- Of ${usd(b.total)}, ${usd(b.allocated)} is allocated and ${usd(b.unallocated)} is unallocated, because spend per KOL is capped at its fair price.`);
 else{const sum=ranked.filter(r=>r.d.fair&&['Hire','Negotiate'].includes(r.d.verdict.label)).reduce((n,r)=>n+r.d.fair.usd,0);o.push(`- No budget was given. Fair prices for the Hire and Negotiate KOLs total ${usd(sum)}.`);}
 o.push('','## KOL details','');
 let rank=0;
 for(const {d,k} of ranked){if(k.status!=='ok')continue;rank++;o.push(...kolSection(k,d,rank,constraints))}
 o.push('## Budget split','');
 if(!b)o.push('Budget not given: fair prices only, no split.');
 else{
  o.push(`Budget ${usd(b.total)}. Hire KOLs are funded first, then Negotiate, pro rata to fair price and never above it${b.maxFee?` or the ${usd(b.maxFee)} fee cap`:''}.`,'','| KOL | Verdict | Fair price (est.) | Quoted fee | Allocation |','|---|---|---|---|---|');
  for(const {d,k} of ranked){if(k.status!=='ok')continue;const amt=b?decision.budget.allocations?.[d.handle]:undefined;const note=!['Hire','Negotiate'].includes(d.verdict.label)?'not funded (Avoid)':d.regionFit==='mismatch'?'not funded (outside region focus)':null;o.push(`| ${L('@'+k.handle,k.profile.url)} | ${d.verdict.label} | ${d.fair?usd(d.fair.usd):'could not verify'} | ${d.quotedFee?usd(d.quotedFee):'n/a'} | ${note??usd(amt??0)} |`)}
  o.push('',`**Unallocated: ${usd(b.unallocated)}**`);
 }
 if(decision.excluded.length)o.push('','Excluded from ranking and budget: '+decision.excluded.map(e=>`@${e.handle} (${e.reason})`).join('; ')+'.');
 o.push('','## Could not verify','');
 const cnv=[];
 for(const k of analyses){
  if(k.status==='not_found')cnv.push(`- @${k.handle}: not found on X.`);
  else if(k.status==='invalid')cnv.push(`- "${k.handle}": not a valid X handle.`);
  else if(k.status==='error')cnv.push(`- @${k.handle}: ${k.error}.`);
  for(const item of k.couldNotVerify)cnv.push(`- @${k.handle}: ${item}.`);
 }
 o.push(...(cnv.length?cnv:['- Nothing was left unverified.']));
 o.push('','## Sources and method','');
 const urls=new Set();
 for(const k of analyses){if(k.profile)urls.add(k.profile.url);for(const p of k.promos){urls.add(p.postUrl);if(p.coin?.url)urls.add(p.coin.url)}for(const u of k.replies?.sampledPosts??[])urls.add(u)}
 o.push('Price data by CoinGecko / DefiLlama. Posts and profiles from X.','',...[...urls].sort().map(u=>`- ${u}`),'');
 o.push(`Rules: bot-like reply = ${RULES.botSignalsNeeded}+ of: account under ${RULES.botAgeDays} days, default avatar, under ${RULES.botFollowers} followers, generic hype-only text, duplicate text. Fair price = est. real views ÷ 1000 × CPM × outcome multiplier (median 30-day change above −20%: 1.0; −20% to −50%: 0.75; −50% or lower: 0.5). Avoid: bot share ${RULES.avoidBotShare*100}% or more, or 2+ promoted tokens down more than 70% at 30 days, or median 30-day change −50% or lower with ${RULES.avoidMinPromos}+ priced promotions. Negotiate: bot share ${RULES.negotiateBotShare*100}-${RULES.avoidBotShare*100}%, engagement under ${RULES.lowEngagementRate*100}% of followers, a contract-address post without a disclosure word, median 30-day change −20% to −50%, or a quoted fee above ${RULES.negotiateFeeFactor}x fair price. Otherwise Hire. Promotion = a ticker, contract address or promo wording in an original post, major coins excluded, up to ${RULES.maxPromoCoins} coins per KOL.`);
 return o.join('\n')+'\n';
}
