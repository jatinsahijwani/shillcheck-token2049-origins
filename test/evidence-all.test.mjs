import {test} from 'node:test';
import assert from 'node:assert/strict';
import {txsFromPayment,link,row} from '../scripts/evidence-all.mjs';
test('transactions are picked by confirmed on-chain state, ignoring unconfirmed ones',()=>{
 const p={CurrentTransaction:{status:'Confirmed',newOnChainState:'Withdrawn',txHash:'c'},TransactionHistory:[{status:'Confirmed',newOnChainState:'ResultSubmitted',txHash:'b'},{status:'Pending',newOnChainState:'FundsLocked',txHash:'x'},{status:'Confirmed',newOnChainState:'FundsLocked',txHash:'a'}]};
 assert.deepEqual(txsFromPayment(p),{escrow:'a',result:'b',collection:'c'});
 assert.deepEqual(txsFromPayment({CurrentTransaction:{status:'Pending',newOnChainState:'Withdrawn',txHash:'z'}}),{escrow:null,result:null,collection:null});
});
test('links and rows render for the README',()=>{
 assert.equal(link('0123456789abcdef'),'[0123456789ab…](https://preprod.cardanoscan.io/transaction/0123456789abcdef)');
 assert.equal(link(null),'pending');assert.equal(row(['a','b']),'| a | b |');
});
