import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStandardApi} from '../../src/standard-api.mjs';
import {SCHEMA,validate} from '../../priceproof/compute.mjs';
import {USDM} from '../../paid-task.mjs';
export const AGENT='a'.repeat(80);
export const tmp=()=>mkdtempSync(join(tmpdir(),'pp-'));
const tx=(hash,state)=>({id:'t'+hash,status:'Confirmed',txHash:hash,newOnChainState:state,confirmations:1});
// One fake ledger that plays MPS for both the seller (/payment...) and the buyer (/purchase...).
export function createFakeMps({tamperHash=false,neverLock=false,failPurchase=false}={}){
 const calls=[];const ledger=new Map();let n=0;
 const view=(e,buyer)=>{const txs=e.txs;return {blockchainIdentifier:e.bid,onChainState:e.state,resultHash:e.resultHash?(tamperHash&&buyer?'0'.repeat(64):e.resultHash):null,submitResultTime:e.submitResultTime,CurrentTransaction:txs.at(-1)??null,TransactionHistory:txs.slice(0,-1).reverse()}};
 const mps=async(path,body)=>{
  calls.push(path);
  if(path==='/payment'){
   const bid=`bid${++n}`;const t=Date.now();
   const e={bid,state:null,txs:[],resultHash:null,submitResultTime:String(Date.parse(body.submitResultTime)),inputHash:body.inputHash,funds:body.RequestedFunds};
   ledger.set(bid,e);
   return {blockchainIdentifier:bid,payByTime:String(Date.parse(body.payByTime)),submitResultTime:e.submitResultTime,unlockTime:String(Date.parse(body.unlockTime)),externalDisputeUnlockTime:String(Date.parse(body.externalDisputeUnlockTime))};
  }
  if(path==='/purchase'){
   if(failPurchase)throw new Error('socket hang up');
   const e=ledger.get(body.blockchainIdentifier);if(!e)throw new Error('unknown identifier');
   if(!neverLock){e.state='FundsLocked';e.txs.push(tx('escrow'+e.bid,'FundsLocked'))}
   e.purchased=true;e.purchaseBody=body;return {id:'purchase-'+e.bid};
  }
  if(path==='/payment/resolve-blockchain-identifier')return view(ledger.get(body.blockchainIdentifier),false);
  if(path==='/purchase/resolve-blockchain-identifier')return view(ledger.get(body.blockchainIdentifier),true);
  if(path==='/payment/submit-result'){const e=ledger.get(body.blockchainIdentifier);e.resultHash=body.submitResultHash;e.state='ResultSubmitted';e.txs.push(tx('result'+e.bid,'ResultSubmitted'));return {};}
  throw new Error('unexpected MPS path '+path);
 };
 return {mps,calls,ledger};
}
export function startSeller({mps,execute,dir=tmp(),priceAtomic='250000'}){
 const api=createStandardApi({name:'PriceProof',jobsDir:dir,schema:SCHEMA,validate,execute,registration:()=>({registrationState:'RegistrationConfirmed',agentIdentifier:AGENT,supportedPaymentSourceIndex:0,sellerVkey:'b'.repeat(56)}),mps,priceAtomic});
 const {server,close}=api.listen({port:0,pollMs:1e9});
 return new Promise(resolve=>server.on('listening',()=>resolve({api,url:`http://127.0.0.1:${server.address().port}`,close})));
}
export const fakeRows=(count,over={})=>JSON.stringify({version:'priceproof/1',as_of:'2026-10-06',results:Array.from({length:count},(_,i)=>({index:i,input:{},status:'ok',price_at:1,price_7d:1.1,price_30d:0.5,pct_7d:10,pct_30d:-50,source:'coingecko',coin_id:'x',reason:null,sources:['https://www.coingecko.com/en/coins/x','https://evil.example/x'],...over}))});
export {USDM};
