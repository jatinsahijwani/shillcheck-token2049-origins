// Per-post fee ranges by creator tier. The codebase has only a CPM rule (RULES.defaultCpmUsd), not tier rates, so these are
// conservative estimates, labelled as such in the report. All numbers in the budget table come from this file, not the model.
export const TIERS=[
 {name:'Micro',min:5000,max:50000,fee:[50,300],share:0.5},
 {name:'Mid',min:50000,max:250000,fee:[300,1500],share:0.35},
 {name:'Macro',min:250000,max:Infinity,fee:[1500,6000],share:0.15},
];
export const RESERVE_SHARE=0.1;
export const tierOf=followers=>TIERS.find(t=>followers>=t.min&&followers<t.max)??TIERS[0];
const rnd=n=>Math.round(n);
// Budget split across the tiers that actually have candidates; 10% held back for boosting the best-performing post.
export function splitBudget(total,creators){
 const present=TIERS.filter(t=>creators.some(c=>tierOf(c.followers).name===t.name));
 const usable=total*(1-RESERVE_SHARE);
 const useTiers=present.length?present:[TIERS[0]];
 const weight=useTiers.reduce((n,t)=>n+t.share,0);
 const rows=useTiers.map(t=>{
  const usd=usable*t.share/weight;
  const mid=(t.fee[0]+t.fee[1])/2;
  const n=creators.filter(c=>tierOf(c.followers).name===t.name).length;
  return {tier:t.name,followers:`${t.min.toLocaleString('en-US')}${Number.isFinite(t.max)?` to ${t.max.toLocaleString('en-US')}`:'+'}`,feeRange:t.fee,usd:rnd(usd),sharePct:rnd(100*usd/total),posts:Math.max(0,Math.floor(usd/mid)),shortlisted:n};
 });
 rows.push({tier:'Reserve (boost the best post, replace no-shows)',followers:'n/a',feeRange:null,usd:rnd(total*RESERVE_SHARE),sharePct:rnd(RESERVE_SHARE*100),posts:null,shortlisted:null});
 return rows;
}
