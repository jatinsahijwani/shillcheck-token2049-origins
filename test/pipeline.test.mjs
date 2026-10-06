import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDeps,rerankReport,summarize,vetKols} from '../src/pipeline.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {loadReport} from '../src/store.mjs';
import {coinUrl,nearestPoint,pickByTicker,createLimiter} from '../src/coingecko.mjs';
import {createXClient} from '../src/x-client.mjs';
import {parseRequest} from '../src/parse-input.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const sleep=async()=>{};
const env={SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000'};
const tmp=()=>mkdtempSync(join(tmpdir(),'shillcheck-'));
const deps=(fetchImpl,over={})=>createDeps({env:{...env,...over},now:NOW,sleep,fetchImpl:fetchImpl??createMockFetch({now:NOW})});
const HANDLES=['demo_alpha','demo_pumper','demo_ghost','demo_nobody'];
function counting(inner){const calls=[];const f=async url=>{calls.push(String(url));return inner(url)};f.calls=calls;return f}
const failing=(inner,match,status=500)=>async url=>match(new URL(String(url)))?{status,ok:false,json:async()=>({detail:'secret-body-should-not-leak'})}:inner(url);

test('scenario 1, normal input: ranked verdicts, sources, estimate labels, mock banner',async()=>{
 const dir=tmp();
 try{
  const report=await vetKols({handles:HANDLES,budget_usd:20000},{deps:deps(),dir});
  const md=report.markdown;
  const verdicts=Object.fromEntries(report.decision.decisions.map(d=>[d.handle,d.verdict.label]));
  assert.deepEqual(verdicts,{demo_alpha:'Hire',demo_pumper:'Avoid',demo_ghost:'Negotiate',demo_nobody:'Not rated'});
  assert.deepEqual(report.decision.ranked.slice(0,3),['demo_alpha','demo_ghost','demo_pumper']);
  assert.match(md,/MOCK DATA/);
  const order=['## Summary','## Key takeaways','## KOL details','## Budget split','## Could not verify','## Sources and method'].map(h=>md.indexOf(h));
  assert.ok(order.every((n,i)=>n>=0&&(i===0||n>order[i-1])),'sections in spec order');
  assert.equal(md.split('## Key takeaways')[1].split('## KOL details')[0].trim().split('\n').filter(l=>l.startsWith('- ')).length,3);
  assert.match(md,/ESTIMATE/);assert.match(md,/Price data by CoinGecko \/ DefiLlama/);
  assert.match(md,/https:\/\/x\.com\/demo_pumper\/status\/\d+/);assert.match(md,/https:\/\/www\.coingecko\.com\/en\/coins\/rugone/);
  assert.match(md,/fell 78% within 30 days of the post/);
  assert.doesNotMatch(md,/scam|fraud|rug pull|liar/i,'facts only');
  assert.match(md,/Unallocated: \$/);
  assert.match(md,/@demo_nobody: not found on X/);
  assert.match(md,/est\. real views \(median views × \(1 − bot share\)\) ÷ 1000 × \$15 CPM/);
  const disk=loadReport(dir,report.id);
  assert.equal(disk.markdown,md);assert.ok(disk.params&&disk.constraints&&disk.analyses.length===4);
  assert.deepEqual(readdirSync(dir).sort(),[`${report.id}.json`,`${report.id}.md`]);
 }finally{rmSync(dir,{recursive:true})}
});
test('scenario 1b: the same inputs and data give byte-identical decisions',async()=>{
 const a=await vetKols({handles:HANDLES,budget_usd:20000},{deps:deps(),dir:tmp()});
 const b=await vetKols({handles:HANDLES,budget_usd:20000},{deps:deps(),dir:tmp()});
 assert.equal(a.markdown,b.markdown.replace(b.id,a.id));
});
test('promo outcomes: priced, pending, unlisted and ambiguous tickers, contract address preferred',async()=>{
 const report=await vetKols({handles:['demo_alpha','demo_pumper']},{deps:deps(),dir:tmp()});
 const rows=Object.fromEntries(report.analyses.flatMap(k=>k.promos.map(p=>[p.ref.value,p.outcome])));
 assert.equal(rows.FRESH.status,'pending');assert.equal(rows.FRESH.pct30,null);
 assert.equal(rows.RUGONE.status,'ok');assert.ok(Math.abs(rows.RUGONE.pct30+78)<1,`rugone ${rows.RUGONE.pct30}`);
 assert.match(rows.TWIN.reason,/matches 2 CoinGecko listings/);assert.equal(rows.TWIN.status,'unverified');
 assert.match(rows.NOPE.reason,/not listed on CoinGecko/);
 const ca=report.analyses.find(k=>k.handle==='demo_pumper').promos.find(p=>p.via==='contract');
 assert.equal(ca.outcome.status,'ok');assert.equal(ca.coin.id,'cacoin');
});
test('one market_chart call per coin, even when several posts promote it',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 await vetKols({handles:['demo_alpha','demo_pumper']},{deps:deps(f),dir:tmp()});
 const ranges=f.calls.filter(u=>u.includes('market_chart/range'));
 assert.equal(new Set(ranges.map(u=>u.split('?')[0])).size,ranges.length);
});
test('scenario 2, missing information: no budget, no goal, one handle still yields a report',async()=>{
 const report=await vetKols({handles:['@demo_alpha']},{deps:deps(),dir:tmp()});
 assert.match(report.markdown,/Budget not given: fair prices only, no split/);
 assert.match(report.markdown,/CPM \$15 per 1,000 real views \(default\)/);
 assert.equal(report.decision.budget,null);
 await assert.rejects(()=>vetKols({handles:[]},{deps:deps(),dir:tmp()}),/At least one X handle/);
 const bad=await vetKols({handles:['not a handle!!','demo_alpha']},{deps:deps(),dir:tmp()});
 assert.match(bad.markdown,/not a valid X handle/);
});
test('scenario 3a, tool failure: CoinGecko down gives a partial, labeled report after exactly one retry',async()=>{
 const f=counting(failing(createMockFetch({now:NOW}),u=>u.hostname==='api.coingecko.com'));
 const report=await vetKols({handles:['demo_alpha']},{deps:deps(f),dir:tmp()});
 assert.match(report.markdown,/## Could not verify/);
 assert.match(report.markdown,/price source error: CoinGecko search returned HTTP 500/);
 assert.doesNotMatch(report.markdown,/secret-body-should-not-leak/);
 assert.equal(report.decision.decisions[0].verdict.label,'Hire','reach analysis is still reported');
 const alphaSearches=f.calls.filter(u=>u.includes('/search?query=ALPHA'));
 assert.equal(alphaSearches.length,2,'one retry, then stop');
});
test('scenario 3b, tool failure: X timeline error marks one KOL and keeps the rest',async()=>{
 const f=failing(createMockFetch({now:NOW}),u=>u.hostname==='api.x.com'&&/\/users\/9002\/tweets/.test(u.pathname),503);
 const report=await vetKols({handles:['demo_alpha','demo_pumper']},{deps:deps(f),dir:tmp()});
 const by=Object.fromEntries(report.analyses.map(k=>[k.handle,k.status]));
 assert.deepEqual(by,{demo_alpha:'ok',demo_pumper:'error'});
 assert.match(report.markdown,/@demo_pumper: posts: X timeline returned HTTP 503/);
});
test('scenario 3c: failed reply search leaves reach intact and labels reply quality',async()=>{
 const f=failing(createMockFetch({now:NOW}),u=>u.pathname==='/2/tweets/search/recent',429);
 const report=await vetKols({handles:['demo_alpha']},{deps:deps(f),dir:tmp()});
 assert.match(report.markdown,/reply quality: reply search failed/);
 assert.match(report.markdown,/not adjusted for bot share/);
});
test('call caps are enforced and labeled',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const report=await vetKols({handles:HANDLES},{deps:deps(f,{SHILLCHECK_MAX_X_CALLS:'3'}),dir:tmp()});
 assert.ok(f.calls.filter(u=>u.includes('api.x.com')).length<=3);
 assert.match(report.markdown,/X API call cap reached \(3\)/);
});
test('estimated X spend cap stops further X reads and is labeled',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const report=await vetKols({handles:HANDLES},{deps:deps(f,{SHILLCHECK_MAX_X_COST_USD:'1'}),dir:tmp()});
 assert.ok(report.usage.estXCostUsd<=1.01,`${report.usage.estXCostUsd}`);
 assert.match(report.markdown,/estimated X spend cap of \$1 reached/);
});
test('recent-search window: when no post is under 7 days old, replies are not searched and the gap is labeled',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const later=createDeps({env,now:NOW+30*86400000,sleep,fetchImpl:f});
 const report=await vetKols({handles:['demo_alpha']},{deps:later,dir:tmp()});
 assert.equal(f.calls.filter(u=>u.includes('/search/recent')).length,0);
 assert.match(report.markdown,/no original posts within the 7-day search window/);
});
test('X results are cached for 6 hours, CoinGecko permanently',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const shared=deps(f);
 await vetKols({handles:['demo_alpha']},{deps:shared,dir:tmp()});
 const first=f.calls.length;
 await vetKols({handles:['demo_alpha']},{deps:shared,dir:tmp()});
 assert.equal(f.calls.length,first,'second run is served from cache');
});
test('rerank keeps earlier constraints, merges new ones, and makes no network calls',async()=>{
 const dir=tmp();
 const r1=await vetKols({handles:HANDLES,budget_usd:20000,quoted_fees:{demo_alpha:9000,demo_ghost:2000}},{deps:deps(),dir,sessionId:'s1'});
 const hash=id=>createHash('sha256').update(readFileSync(join(dir,`${id}.md`))).digest('hex');
 const before=hash(r1.id);
 const r2=rerankReport({reportId:r1.id,update:{max_fee_usd:5000,region:'asia'},dir,sessionId:'s1'});
 assert.equal(r2.constraints.budget_usd,20000,'budget kept');assert.equal(r2.constraints.quoted_fees.demo_alpha,9000);
 assert.equal(r2.constraints.max_fee_usd,5000);assert.equal(r2.constraints.region,'asia');
 assert.deepEqual(r2.decision.excluded.map(e=>e.handle),['demo_alpha'],'quoted $9000 is above the $5000 cap');
 assert.ok(!r2.decision.ranked.includes('demo_alpha'));
 const r3=rerankReport({reportId:r2.id,update:{exclude_handles:['demo_ghost']},dir});
 assert.equal(r3.constraints.max_fee_usd,5000,'earlier follow-up kept');assert.equal(r3.constraints.region,'asia');assert.equal(r3.constraints.budget_usd,20000);
 assert.deepEqual(r3.constraints.exclude_handles,['demo_ghost']);
 assert.deepEqual(r3.decision.excluded.map(e=>e.handle).sort(),['demo_alpha','demo_ghost']);
 assert.equal(r3.parentId,r2.id);assert.equal(r3.usage.xCalls,0);
 assert.equal(hash(r1.id),before,'the first report is never rewritten');
 assert.match(r3.markdown,/Re-ranked from report/);
 assert.throws(()=>rerankReport({reportId:'rpt_000000000000',update:{},dir}),/not found/);
});
test('region focus: mismatch gets no budget, unknown location is not penalised',async()=>{
 const r=await vetKols({handles:['demo_alpha','demo_ghost'],budget_usd:50000,region:'asia'},{deps:deps(),dir:tmp()});
 const by=Object.fromEntries(r.decision.decisions.map(d=>[d.handle,d.regionFit]));
 assert.deepEqual(by,{demo_alpha:'match',demo_ghost:'mismatch'});
 assert.equal(r.decision.budget.allocations.demo_ghost,0);
});
test('summary for the model has numbers and ids only, never post text',async()=>{
 const r=await vetKols({handles:HANDLES,budget_usd:20000},{deps:deps(),dir:tmp()});
 const text=JSON.stringify(summarize(r));
 assert.match(text,/rpt_[0-9a-f]{12}/);
 assert.doesNotMatch(text,/Partnered|gem|LFG|gm builders|CA 0x/);
});
test('X client never leaks the bearer or response bodies in errors',async()=>{
 const x=createXClient({bearer:'TOPSECRET',fetchImpl:async()=>({status:500,ok:false,json:async()=>({detail:'TOPSECRET'})}),sleep});
 await assert.rejects(()=>x.getUser('abc'),e=>!/TOPSECRET/.test(e.message)&&/HTTP 500/.test(e.message));
});
test('CoinGecko helpers: exact symbol, market-cap rank, ambiguity, nearest point, throttle',async()=>{
 assert.equal(pickByTicker('ABC',[{symbol:'abcd',id:'x'}]).status,'not_found');
 assert.equal(pickByTicker('ABC',[{symbol:'abc',id:'x',market_cap_rank:null}]).coin.id,'x');
 assert.equal(pickByTicker('ABC',[{symbol:'abc',id:'x',market_cap_rank:900},{symbol:'ABC',id:'y',market_cap_rank:40}]).coin.id,'y');
 assert.equal(pickByTicker('ABC',[{symbol:'abc',id:'x',market_cap_rank:null},{symbol:'abc',id:'y',market_cap_rank:null}]).status,'ambiguous');
 assert.deepEqual(nearestPoint([[0,1],[100,2],[200,3]],120,50),{t:100,price:2});assert.equal(nearestPoint([[0,1]],500,50),null);
 assert.equal(coinUrl('a b'),'https://www.coingecko.com/en/coins/a%20b');
 let t=0;const waits=[];const limit=createLimiter(60,{now:()=>t,sleep:async ms=>{waits.push(ms);t+=ms}});
 await limit();await limit();await limit();assert.deepEqual(waits,[1000,1000]);
});
test('CLI request parser',()=>{
 assert.deepEqual(parseRequest('@a @b budget $10k asia'),{handles:['a','b'],budget_usd:10000,cpm_usd:undefined,region:'asia'});
 assert.equal(parseRequest('@a $2.5m').budget_usd,2500000);
});
