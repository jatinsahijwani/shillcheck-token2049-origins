import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botSignals,estimateRealViews,fairPrice,isGenericHype,median,outcomeMultiplier,postStats,rankKols,replyQuality,splitBudget,summarizeOutcomes,verdict} from '../src/analysis.mjs';
import {mergeConstraints,decide} from '../src/decide.mjs';
import {regionFit,regionsOf} from '../src/region.mjs';
const NOW=Date.parse('2026-10-06T00:00:00Z');
const iso=daysAgo=>new Date(NOW-daysAgo*86400000).toISOString();
const user=(over={})=>({id:'u'+Math.random(),created_at:iso(900),public_metrics:{followers_count:500},profile_image_url:'https://pbs.twimg.com/profile_images/1/a.jpg',...over});
test('bot signals: each rule fires alone, 2+ makes bot-like',()=>{
 const none=new Set();
 assert.deepEqual(botSignals({text:'Detailed thoughts on fees',author:user({created_at:iso(10)})},none,NOW).signals,['account age under 90 days']);
 assert.deepEqual(botSignals({text:'Detailed thoughts on fees',author:user({profile_image_url:'x/default_profile_images/d.png'})},none,NOW).signals,['default avatar']);
 assert.deepEqual(botSignals({text:'Detailed thoughts on fees',author:user({public_metrics:{followers_count:3}})},none,NOW).signals,['fewer than 10 followers']);
 assert.deepEqual(botSignals({text:'🔥 LFG 🚀',author:user()},none,NOW).signals,['generic hype-only text']);
 assert.deepEqual(botSignals({text:'same words here',author:user()},new Set(['same words here']),NOW).signals,['duplicate reply text']);
 assert.equal(botSignals({text:'🔥 LFG 🚀',author:user({created_at:iso(5)})},none,NOW).signals.length,2);
});
test('generic hype text detection',()=>{
 for(const t of ['🔥🔥🔥','LFG','gm','to the moon!!','Wow nice gem 🚀'])assert.equal(isGenericHype(t),true,t);
 for(const t of ['Can you share the dashboard link?','LFG but what is the unlock schedule for the team allocation'])assert.equal(isGenericHype(t),false,t);
});
test('reply quality share, uniqueness and minimum sample',()=>{
 const bot=i=>({id:'r'+i,text:'🔥 LFG',author:user({id:'b'+i,created_at:iso(3),public_metrics:{followers_count:2},profile_image_url:'default_profile_images/x'})});
 const real=i=>({id:'q'+i,text:`A considered reply number ${i}`,author:user({id:'h'+i})});
 const replies=[...Array.from({length:6},(_,i)=>bot(i)),...Array.from({length:14},(_,i)=>real(i)),bot(0)];
 const q=replyQuality(replies,NOW);
 assert.equal(q.checked,20);assert.equal(q.botLike,6);assert.equal(q.share,0.3);assert.equal(q.sufficient,true);
 const few=replyQuality(replies.slice(0,5),NOW);assert.equal(few.share,null);assert.equal(few.sufficient,false);
});
test('post averages use the latest 30 originals; rates against followers',()=>{
 const posts=Array.from({length:60},(_,i)=>({created_at:iso(i),metrics:{impression_count:i<30?1000:999999,like_count:10,retweet_count:4,reply_count:3,quote_count:1}}));
 const s=postStats(posts,10000);
 assert.equal(s.n,30);assert.equal(s.avgViews,1000);assert.equal(s.engagementRate,18/10000);assert.equal(s.viewRate,0.1);
});
test('fair price uses median views, so viral outliers do not inflate it',()=>{
 const posts=[...Array.from({length:9},(_,i)=>({created_at:iso(i),metrics:{impression_count:1000}})),{created_at:iso(20),metrics:{impression_count:1000000}}];
 const s=postStats(posts,10000);
 assert.equal(s.medianViews,1000);assert.equal(s.avgViews,100900);
 const kol={handle:'v',status:'ok',profile:{location:''},posts:s,replies:{share:0},promos:[]};
 const out=decide([kol],mergeConstraints({}, {}));
 assert.equal(out.decisions[0].estRealViews,1000);assert.equal(out.decisions[0].fair.usd,15);
});
test('estimated real views and fair price formula',()=>{
 assert.equal(estimateRealViews(100000,0.25),75000);
 assert.deepEqual({u:fairPrice({estRealViews:75000,cpmUsd:15,median30:12}).usd,m:fairPrice({estRealViews:75000,cpmUsd:15,median30:12}).multiplier},{u:1125,m:1});
 assert.equal(fairPrice({estRealViews:100000,cpmUsd:20,median30:-30}).usd,1500);
 assert.equal(fairPrice({estRealViews:100000,cpmUsd:10,median30:-60}).usd,500);
 assert.equal(fairPrice({estRealViews:100000,cpmUsd:10,median30:null}).usd,1000);
});
test('outcome multiplier thresholds',()=>{
 assert.deepEqual([5,0,-19.9,-20,-49.9,-50,-80].map(outcomeMultiplier),[1,1,1,0.75,0.75,0.5,0.5]);
});
const base={botShare:0.05,outcomes:{priced30:0,median30:null,dumped:0,worst30:null},engagementRate:0.01,undisclosedContractPromos:0,quotedFee:null,fairUsd:1000};
test('verdict: Avoid rules',()=>{
 assert.equal(verdict({...base,botShare:0.4}).label,'Avoid');
 assert.equal(verdict({...base,outcomes:{priced30:2,median30:-10,dumped:2}}).label,'Avoid');
 assert.equal(verdict({...base,outcomes:{priced30:3,median30:-55,dumped:1}}).label,'Avoid');
 assert.equal(verdict({...base,outcomes:{priced30:2,median30:-55,dumped:1}}).label,'Negotiate','median -55 with only 2 promos is not Avoid');
});
test('verdict: Negotiate rules',()=>{
 assert.equal(verdict({...base,botShare:0.2}).label,'Negotiate');
 assert.equal(verdict({...base,botShare:0.39}).label,'Negotiate');
 assert.equal(verdict({...base,engagementRate:0.0019}).label,'Negotiate');
 assert.equal(verdict({...base,undisclosedContractPromos:1}).label,'Negotiate');
 assert.equal(verdict({...base,outcomes:{priced30:3,median30:-30,dumped:0}}).label,'Negotiate');
 assert.equal(verdict({...base,quotedFee:1600}).label,'Negotiate');
 assert.equal(verdict({...base,quotedFee:1500}).label,'Hire','exactly 1.5x is allowed');
});
test('verdict: Hire otherwise, with unverifiable bot share not penalised',()=>{
 assert.equal(verdict(base).label,'Hire');
 assert.equal(verdict({...base,botShare:null}).label,'Hire');
});
test('ranking: tier, then estimated real views, then handle',()=>{
 const k=(handle,label,v,regionOrder)=>({handle,verdict:{label},estRealViews:v,regionOrder});
 assert.deepEqual(rankKols([k('c','Avoid',900),k('b','Hire',10),k('a','Negotiate',500),k('d','Hire',50),k('e','Hire',50)]).map(x=>x.handle),['d','e','b','a','c']);
 assert.deepEqual(rankKols([k('x','Hire',100,2),k('y','Hire',10,0)]).map(x=>x.handle),['y','x']);
});
test('median',()=>{assert.equal(median([3,1,2]),2);assert.equal(median([1,2,3,4]),2.5);assert.equal(median([]),null);});
test('budget: Hire first, capped at fair price, leftover reported',()=>{
 const c=[{handle:'h1',verdict:'Hire',weight:1000,cap:1000},{handle:'h2',verdict:'Hire',weight:3000,cap:3000},{handle:'n1',verdict:'Negotiate',weight:2000,cap:2000}];
 assert.deepEqual(splitBudget({budget:2000,candidates:c}),{allocations:{h1:500,h2:1500,n1:0},unallocated:0});
 assert.deepEqual(splitBudget({budget:5000,candidates:c}),{allocations:{h1:1000,h2:3000,n1:1000},unallocated:0});
 assert.deepEqual(splitBudget({budget:10000,candidates:c}),{allocations:{h1:1000,h2:3000,n1:2000},unallocated:4000});
 const capped=[{handle:'a',verdict:'Hire',weight:1000,cap:100},{handle:'b',verdict:'Hire',weight:1000,cap:5000}];
 assert.deepEqual(splitBudget({budget:1000,candidates:capped}),{allocations:{a:100,b:900},unallocated:0});
});
test('summarizeOutcomes ignores pending and unverified',()=>{
 const o=summarizeOutcomes([{outcome:{status:'ok',pct30:-80}},{outcome:{status:'ok',pct30:20}},{outcome:{status:'pending',pct30:null}},{outcome:{status:'unverified'}}]);
 assert.deepEqual(o,{priced30:2,median30:-30,worst30:-80,dumped:1});
});
test('mergeConstraints keeps earlier values and unions exclusions',()=>{
 const a=mergeConstraints({}, {budget_usd:20000,region:'asia',quoted_fees:{'@Alice':4000}});
 const b=mergeConstraints(a,{max_fee_usd:5000,exclude_handles:['@Bob']});
 const c=mergeConstraints(b,{exclude_handles:['carol'],region:'europe'});
 assert.deepEqual(b,{budget_usd:20000,goal:undefined,niche:undefined,region:'asia',cpm_usd:undefined,max_fee_usd:5000,quoted_fees:{alice:4000},exclude_handles:['bob']});
 assert.equal(c.budget_usd,20000);assert.equal(c.max_fee_usd,5000);assert.equal(c.region,'europe');assert.deepEqual(c.exclude_handles,['bob','carol']);
});
test('decide: quoted fee above cap drops the KOL from ranking and budget',()=>{
 const kol=(handle,views)=>({handle,status:'ok',profile:{location:''},posts:{viewsAvailable:true,avgViews:views,engagementRate:0.01},replies:{share:0.05},promos:[]});
 const out=decide([kol('a',100000),kol('b',100000)],mergeConstraints({}, {budget_usd:5000,max_fee_usd:2000,quoted_fees:{b:3000}}));
 assert.deepEqual(out.ranked,['a']);assert.deepEqual(out.excluded.map(e=>e.handle),['b']);
 assert.equal(out.budget.allocations.a,1425);assert.equal(out.budget.unallocated,3575);
});
test('fee cap drops on estimated fair price when no fee was quoted',()=>{
 const kol=(handle,views)=>({handle,status:'ok',profile:{location:''},posts:{viewsAvailable:true,avgViews:views,engagementRate:0.01},replies:{share:0},promos:[]});
 const out=decide([kol('big',1000000),kol('small',100000)],mergeConstraints({}, {budget_usd:20000,max_fee_usd:5000}));
 assert.deepEqual(out.ranked,['small']);
 assert.deepEqual(out.excluded,[{handle:'big',reason:'est. fair price $15,000 > $5K cap'}]);
 assert.equal(out.budget.allocations.big,undefined);
 const quoted=decide([kol('big',1000000)],mergeConstraints({}, {max_fee_usd:5000,quoted_fees:{big:4000}}));
 assert.deepEqual(quoted.ranked,['big'],'a quote under the cap keeps them even if fair price is higher');
 assert.equal(decide([kol('x',100000)],mergeConstraints({}, {max_fee_usd:5000,quoted_fees:{x:6000}})).excluded[0].reason,'quoted fee $6,000 > $5K cap');
});
test('regions: countries and cities map to regions',()=>{
 assert.equal(regionFit('asia','Ujjain, India'),'match');
 assert.equal(regionFit('Asia','Dubai'),'mismatch');
 assert.equal(regionFit('mena','Dubai'),'match');
 for(const [loc,region] of [['London, UK','europe'],['Lagos, Nigeria','africa'],['Sydney','oceania'],['São Paulo','latam'],['NYC','north america'],['Zug','europe'],['Tokyo','asia'],['Istanbul','mena']])assert.deepEqual(regionsOf(loc),[region],loc);
 assert.deepEqual(regionsOf('Singapore / Dubai').sort(),['asia','mena']);
 assert.equal(regionFit('asia','Singapore / Dubai'),'match');
 assert.equal(regionFit('southeast asia','Jakarta'),'match');
 assert.equal(regionFit('sea','Berlin'),'mismatch');
});
test('regions: blank or unrecognised location is unknown, never a mismatch',()=>{
 for(const loc of ['','Travelling','the internet','Earth'])assert.equal(regionFit('asia',loc),'unknown',loc);
 assert.equal(regionFit(undefined,'Dubai'),'n/a');
});
