import {test} from 'node:test';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPaidAdapter,taskHash,USDM} from '../paid-task.mjs';
mkdirSync('.local',{recursive:true,mode:0o700}); // the adapter saves the result file under .local
const registration={walletId:'w',agentIdentifier:'a'.repeat(80),supportedPaymentSourceIndex:0};
const locked=(submit)=>({sellerReturnAddress:null,PaymentSource:{network:'Preprod',paymentSourceType:'Web3CardanoV2'},SmartContractWallet:{id:'w',walletVkey:'b'.repeat(56)},RequestedFunds:[{amount:'1000000',unit:USDM}],blockchainIdentifier:'bid',submitResultTime:String(submit),onChainState:'FundsLocked',CurrentTransaction:{status:'Confirmed',newOnChainState:'FundsLocked'}});
const run=async({answer,submit})=>{
 const saved=[];
 const adapter=await createPaidAdapter({registration,save:async(_,s)=>saved.push(s),answer,mps:async()=>locked(submit)});
 return {adapter,saved};
};
test('a failed model call is retried on the next poll while there is time, then succeeds',async()=>{
 let calls=0;
 const {adapter}=await run({submit:Date.now()+15*60000,answer:async()=>{calls++;if(calls===1)throw new Error('503');return 'RESULT'}});
 const task={id:'t'};
 let state=await adapter.advance(task,{input:'abc',paid:{stage:'awaiting-escrow',payment:locked(Date.now()+15*60000)}});
 assert.equal(state.paid.stage,'awaiting-escrow');assert.equal(state.paid.modelAttempts,1);assert.match(state.paid.modelError,/503/);
 state=await adapter.advance(task,state);
 assert.equal(state.paid.stage,'result-saved');assert.equal(state.paid.resultHash,taskHash('RESULT'));assert.equal(calls,2);
});
test('gives up after 3 attempts or when the deadline is near, instead of looping',async()=>{
 let calls=0;
 const fail=async()=>{calls++;throw new Error('down')};
 const {adapter}=await run({submit:Date.now()+15*60000,answer:fail});
 let state={input:'abc',paid:{stage:'awaiting-escrow',payment:locked(Date.now()+15*60000)}};
 state=await adapter.advance({id:'t'},state);state=await adapter.advance({id:'t'},state);
 await assert.rejects(()=>adapter.advance({id:'t'},state),/down/);assert.equal(calls,3);
 const near=await run({submit:Date.now()+2*60000,answer:fail});
 await assert.rejects(()=>near.adapter.advance({id:'t'},{input:'abc',paid:{stage:'awaiting-escrow',payment:locked(Date.now()+2*60000)}}),/down/);
});
