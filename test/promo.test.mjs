import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectPromos,extractRefs} from '../src/promo.mjs';
const post=(id,text,extra={})=>({id,created_at:'2026-08-01T00:00:00.000Z',text,entities:{},...extra});
const EVM='0xAbCdEf1234567890abcdef1234567890ABCDEF12';
const SOL='7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
test('cashtags from entities and regex are found, majors are excluded',()=>{
 const refs=extractRefs(post('1','Big day for $ALPHA and $btc and $ETH, also $5000 gains',{entities:{cashtags:[{tag:'BONK'}]}}));
 assert.deepEqual(refs.map(r=>r.value).sort(),['ALPHA','BONK']);
});
test('EVM and Solana addresses are detected, URLs are ignored',()=>{
 const refs=extractRefs(post('1',`CA ${EVM} or ${SOL} see https://x.com/i/status/${'1'.repeat(30)}`));
 assert.deepEqual(refs.map(r=>r.kind).sort(),['evm','solana']);
 assert.equal(extractRefs(post('2','plainwordlonglonglonglonglonglonglonglonglong')).length,0);
});
test('note_tweet entities are used for long posts',()=>{
 assert.deepEqual(extractRefs(post('1','long',{noteEntities:{cashtags:[{tag:'LONGX'}]}})).map(r=>r.value),['LONGX']);
});
test('disclosure and hype words are flagged per post',()=>{
 const {promos}=detectPromos([post('1','Sponsored: $AAA is live #ad'),post('2','$BBB is an early gem nfa'),post('3','$CCC the roadmap')],'k');
 const by=Object.fromEntries(promos.map(p=>[p.ref.value,p]));
 assert.equal(by.AAA.disclosed,true);assert.equal(by.AAA.hype,false);
 assert.equal(by.BBB.disclosed,false);assert.equal(by.BBB.hype,true);
 assert.equal(by.CCC.disclosed,false);assert.equal(by.CCC.hype,false);
});
test('"ad" inside other words is not a disclosure',()=>{
 const {promos}=detectPromos([post('1','Reading the $AAA whitepaper made me glad and ready')],'k');
 assert.equal(promos[0].disclosed,false);
});
test('one row per coin uses the earliest post and counts repeats',()=>{
 const {promos}=detectPromos([post('9','$AAA again',{created_at:'2026-09-01T00:00:00.000Z'}),post('3','$AAA first',{created_at:'2026-07-01T00:00:00.000Z'})],'k');
 assert.equal(promos.length,1);assert.equal(promos[0].firstPost.id,'3');assert.equal(promos[0].postCount,2);
 assert.equal(promos[0].firstPost.url,'https://x.com/k/status/3');
});
test('capped at 8 unique coins, newest first, and deterministic',()=>{
 const posts=Array.from({length:11},(_,i)=>post(String(i),`$COIN${String.fromCharCode(65+i)}`,{created_at:`2026-08-${String(10+i).padStart(2,'0')}T00:00:00.000Z`}));
 const a=detectPromos(posts,'k'),b=detectPromos([...posts].reverse(),'k');
 assert.equal(a.promos.length,8);assert.equal(a.omitted,3);
 assert.deepEqual(a,b);
});
