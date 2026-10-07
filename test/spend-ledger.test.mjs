import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLedger} from '../src/spend-ledger.mjs';
import {createDeps,vetKols} from '../src/pipeline.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {limits} from '../src/config.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const env={SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000',X_DAILY_CAP_USD:'25'};
test('ledger: sums today only, per source, and survives a new instance (shared file)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-'));
 try{
  let t=NOW;const path=join(dir,'x.jsonl');
  const a=createLedger({path,now:()=>t});
  a.add(1.5,'task');a.add(0.5,'chat');a.add(0,'task');a.add(-3,'task');
  assert.equal(a.total(),2);assert.equal(a.total('chat'),0.5);
  assert.equal(createLedger({path,now:()=>t}).total(),2,'another process sees the same spend');
  t=NOW+86400000;assert.equal(createLedger({path,now:()=>t}).total(),0,'a new UTC day starts at zero');
  const m=createLedger({now:()=>NOW});m.add(1);assert.equal(m.total(),1);
 }finally{rmSync(dir,{recursive:true})}
});
test('daily cap default is $25 and configurable',()=>{
 assert.equal(limits({}).xDailyCapUsd,25);assert.equal(limits({X_DAILY_CAP_USD:'40'}).xDailyCapUsd,40);assert.equal(limits({X_DAILY_CAP_USD:'x'}).xDailyCapUsd,25);
});
test('live reads are recorded, and past the daily cap only cached data is served and the rest is labeled',async()=>{
 const ledger=createLedger({now:()=>NOW});
 const first=createDeps({env,now:NOW,sleep:async()=>{},fetchImpl:createMockFetch({now:NOW}),ledger});
 await vetKols({handles:['demo_alpha']},{deps:first,dir:mkdtempSync(join(tmpdir(),'cap-'))});
 const spent=ledger.total();
 assert.ok(spent>0.5&&spent<1.5,`recorded ${spent}`);
 // Same cache, ledger now at the cap: demo_alpha is cached and still works, demo_pumper needs live reads and is refused.
 ledger.add(25-spent,'task');
 const capped=createDeps({env,now:NOW,sleep:async()=>{},fetchImpl:createMockFetch({now:NOW}),ledger,cache:first.cache});
 const report=await vetKols({handles:['demo_alpha','demo_pumper']},{deps:capped,dir:mkdtempSync(join(tmpdir(),'cap-'))});
 const by=Object.fromEntries(report.analyses.map(k=>[k.handle,k.status]));
 assert.deepEqual(by,{demo_alpha:'ok',demo_pumper:'error'});
 assert.match(report.markdown,/daily X spend cap of \$25 reached/);assert.match(report.markdown,/## Could not verify/);
 assert.ok(ledger.total()<=25+1e-6,'nothing more was spent');
});
test('chat spend is tracked separately and also counts toward the global cap',async()=>{
 const ledger=createLedger({now:()=>NOW});
 const chat=createDeps({env:{...env,X_SPEND_SOURCE:'chat'},now:NOW,sleep:async()=>{},fetchImpl:createMockFetch({now:NOW}),ledger});
 await vetKols({handles:['demo_ghost']},{deps:chat,dir:mkdtempSync(join(tmpdir(),'cap-'))});
 assert.ok(ledger.total('chat')>0);assert.equal(ledger.total('task'),0);assert.equal(ledger.total(),ledger.total('chat'));
});
