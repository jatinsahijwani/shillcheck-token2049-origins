import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ackText,receiptText,handlesIn,estimateMinutes,postOnce} from '../src/notices.mjs';
const tmp=()=>mkdtempSync(join(tmpdir(),'notice-'));
test('handles are read from the Task text, deduplicated and capped',()=>{
 assert.deepEqual(handlesIn('Vet @cobie, @0xngmi and @cobie for a launch. email me at a@b.com'),['cobie','0xngmi']);
 assert.deepEqual(handlesIn('no handles here'),[]);
 assert.equal(handlesIn(Array.from({length:14},(_,i)=>`@h${i}`).join(' ')).length,10);
});
test('timing estimate: escrow dominates paid Tasks, live reads and PriceProof add time',()=>{
 assert.equal(estimateMinutes({paid:true}),5);assert.equal(estimateMinutes({paid:false}),1);
 assert.equal(estimateMinutes({paid:true,uncached:4}),7);assert.equal(estimateMinutes({paid:true,priceProof:true}),10);
});
test('ack text names the handles, the steps and the expected time',()=>{
 const t=ackText({input:'Vet @cobie @0xngmi @jatinsahijwani1 for a DeFi launch in Asia. Budget $20K.',paid:true});
 assert.match(t,/^On it: vetting 3 handles \(@cobie, @0xngmi, @jatinsahijwani1\)\./);assert.match(t,/1 tUSDM quote/);assert.match(t,/about 5 minutes/);
 const live=ackText({input:'Vet @a @b',paid:true,uncached:['b']});assert.match(live,/1 handle is not cached and need a live X read/);assert.match(live,/about 6 minutes/);
 assert.match(ackText({input:'Vet @a',paid:false}),/Your report follows\..*about 1 minute\./);
 assert.match(ackText({input:'Vet @a',paid:true,priceProof:true}),/PriceProof/);
 assert.match(ackText({input:'hello'}),/reading your request/);
});
const journal={paid:{resultHash:'ab'.repeat(32),settlement:{verified:true,netAtomicUnits:'1000000'},observed:{CurrentTransaction:{status:'Confirmed',newOnChainState:'Withdrawn',txHash:'c'.repeat(64)},TransactionHistory:[{status:'Confirmed',newOnChainState:'ResultSubmitted',txHash:'b'.repeat(64)},{status:'Confirmed',newOnChainState:'FundsLocked',txHash:'a'.repeat(64)}]}}};
test('receipt lists escrow, result hash, result tx, payout and contract with cardanoscan links',()=>{
 const t=receiptText(journal);
 for(const h of ['a','b','c'])assert.match(t,new RegExp(`https://preprod.cardanoscan.io/transaction/${h.repeat(64)}`));
 assert.match(t,/Result hash submitted on chain: `abab/);assert.match(t,/Seller net: \+1 tUSDM/);assert.match(t,/cardanoscan.io\/address\/addr_test1wzs4e6/);
});
test('a notice is posted at most once; an unknown outcome is never repeated',async()=>{
 const dir=tmp();
 try{
  const path=join(dir,'t.json');writeFileSync(path,JSON.stringify({input:'Vet @a'}));
  const posts=[];
  const run=()=>postOnce({journalPath:path,flag:'ack',build:j=>`hi ${j.input}`,post:async t=>{posts.push(t)}});
  assert.equal((await run()).posted,true);assert.equal((await run()).posted,false);assert.deepEqual(posts,['hi Vet @a']);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).ack,'posted');
  // post throws: flag becomes uncertain and the next call skips
  writeFileSync(path,JSON.stringify({input:'x'}));
  const bad=()=>postOnce({journalPath:path,flag:'ack',build:()=>'t',post:async()=>{throw new Error('timeout')}});
  assert.equal((await bad()).posted,false);assert.equal(JSON.parse(readFileSync(path,'utf8')).ack,'uncertain');
  let calls=0;await postOnce({journalPath:path,flag:'ack',build:()=>'t',post:async()=>{calls++}});assert.equal(calls,0,'never retried');
  // a crash between the flag and the post leaves pending, which also blocks a repeat
  writeFileSync(path,JSON.stringify({ack:'pending'}));await postOnce({journalPath:path,flag:'ack',build:()=>'t',post:async()=>{calls++}});assert.equal(calls,0);
 }finally{rmSync(dir,{recursive:true})}
});
test('the journal keeps every other field when a flag is written (paid state is untouched)',async()=>{
 const dir=tmp();
 try{
  const path=join(dir,'t.json');writeFileSync(path,JSON.stringify({input:'Vet @a',paid:{stage:'awaiting-escrow',payment:{blockchainIdentifier:'bid'}}}));
  await postOnce({journalPath:path,flag:'ack',build:()=>'t',post:async()=>{}});
  const j=JSON.parse(readFileSync(path,'utf8'));assert.equal(j.paid.stage,'awaiting-escrow');assert.equal(j.paid.payment.blockchainIdentifier,'bid');assert.equal(j.ack,'posted');
 }finally{rmSync(dir,{recursive:true})}
});
