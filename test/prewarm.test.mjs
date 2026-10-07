import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run,plan,DEFAULT_HANDLES,EST_HIGH} from '../scripts/prewarm.mjs';
import {createCache} from '../src/cache.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const env=()=>({SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000',SHILLCHECK_DATA_DIR:join(mkdtempSync(join(tmpdir(),'pw-')),'reports')});
test('default list has 26 handles and the plan separates cached from fetch',()=>{
 assert.equal(DEFAULT_HANDLES.length,26);
 const cache=createCache({});cache.set('x:user:cobie',{found:false});
 const p=plan(['cobie','demo_alpha','bad handle!!'],cache,3600000);
 assert.deepEqual(p.cached,['cobie']);assert.deepEqual(p.todo,['demo_alpha']);assert.equal(p.low,0.16);
});
test('dry run makes no calls and no spend',async()=>{
 let calls=0;const logs=[];
 const r=await run({handles:['demo_alpha','demo_pumper'],maxUsd:12,dryRun:true,env:env(),fetchImpl:async()=>{calls++},log:m=>logs.push(m)});
 assert.equal(calls,0);assert.equal(r.spent,0);assert.match(logs.join('\n'),/estimated live X cost: \$0.32 to \$0.62; cap \$12/);
});
test('run fetches only what is not cached and respects the spend cap',async()=>{
 const logs=[];
 const r=await run({handles:['demo_alpha','demo_pumper','demo_ghost'],maxUsd:EST_HIGH*2+0.01,env:env(),fetchImpl:createMockFetch({now:NOW}),now:NOW,log:m=>logs.push(m)});
 assert.equal(r.done.length,2,'stopped before the third handle');assert.match(logs.join('\n'),/stopping before @demo_ghost/);
 assert.ok(r.spent>0&&r.spent<=EST_HIGH*2+0.01);assert.ok(r.done.every(d=>d.status==='ok'));
});
test('each handle gets its own per-report cap, so a long list is not cut off by the cap of a single report',async()=>{
 const e={...env(),SHILLCHECK_MAX_X_COST_USD:'1'};
 const r=await run({handles:['demo_alpha','demo_pumper','demo_ghost'],maxUsd:20,env:e,fetchImpl:createMockFetch({now:NOW}),now:NOW,log:()=>{}});
 assert.deepEqual(r.done.map(d=>d.status),['ok','ok','ok']);
});
test('an entry that would expire before the deadline is planned for a refresh',()=>{
 let t=0;const cache=createCache({now:()=>t});
 cache.set('x:user:old',{found:true,user:{id:'1'}});cache.set('x:tweets:1',[]);
 t=22*3600000;cache.set('x:user:new',{found:true,user:{id:'2'}});cache.set('x:tweets:2',[]);
 const real=Date.now;Date.now=()=>t;
 try{
  const ttl=48*3600000,validUntil=t+26*3600000;
  const p=plan(['old','new'],cache,ttl,validUntil);
  assert.deepEqual(p.todo,['old'],'22 hours old now means 48 hours old at the deadline');assert.deepEqual(p.cached,['new']);
  assert.equal(cache.age('x:user:old'),22*3600000);assert.equal(cache.age('x:user:missing'),undefined);
 }finally{Date.now=real}
});
