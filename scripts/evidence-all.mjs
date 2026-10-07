// Prints two markdown tables for the README, from the worker journals and the MPS records on the host:
//   1. every ShillCheck paid Task (escrow, result, collection transactions and the seller's measured net)
//   2. every PriceProof purchase made by ShillCheck (same columns, seen from PriceProof's side)
// Run on the server: node --env-file=.env --env-file=.local/priceproof-runtime.env scripts/evidence-all.mjs
// Nothing secret is printed; transaction hashes and identifiers are public chain data.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {sellerTokenNet} from '../settlement.mjs';
import {USDM} from '../paid-task.mjs';
export const link=h=>h?`[${h.slice(0,12)}…](https://preprod.cardanoscan.io/transaction/${h})`:'pending';
export function txsFromPayment(p){
 const all=[p.CurrentTransaction,...(p.TransactionHistory??[])].filter(t=>t?.status==='Confirmed'&&t.txHash);
 const find=state=>all.find(t=>t.newOnChainState===state)?.txHash??null;
 return {escrow:find('FundsLocked'),result:find('ResultSubmitted'),collection:find('Withdrawn')??find('DisputedWithdrawn')};
}
export const row=cells=>`| ${cells.join(' | ')} |`;
async function net(tx,address){
 if(!tx)return 'pending';
 const r=await fetch(`https://cardano-preprod.blockfrost.io/api/v0/txs/${tx}/utxos`,{headers:{project_id:process.env.BLOCKFROST_API_KEY_PREPROD}});
 if(!r.ok)return 'unknown';
 return `+${Number(sellerTokenNet(await r.json(),address,USDM))/1e6} tUSDM`;
}
async function resolve(token,blockchainIdentifier){
 const r=await fetch(`${process.env.MPS_URL}/api/v1/payment/resolve-blockchain-identifier`,{method:'POST',headers:{token,'content-type':'application/json'},body:JSON.stringify({network:'Preprod',blockchainIdentifier,includeHistory:'true'})});
 return (await r.json()).data;
}
async function main(){
 const dir='.local';
 const tasks=readdirSync(dir).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f)).map(f=>({id:f.slice(0,-5),s:JSON.parse(readFileSync(join(dir,f),'utf8'))})).filter(t=>t.s.paid?.payment?.blockchainIdentifier);
 tasks.sort((a,b)=>Number(a.s.paid.payment.payByTime)-Number(b.s.paid.payment.payByTime));
 console.log('| Task | Result | Escrow tx | Result tx | Collection tx | Seller net |\n|---|---|---|---|---|---|');
 for(const {id,s} of tasks){
  const p=s.paid,t=txsFromPayment(p.observed??{});
  const status=p.stage==='settled'?'settled and verified':p.stage==='deadline-missed'?'not delivered (result deadline missed, no payout)':p.stage;
  console.log(row([`\`${id}\``,status,link(t.escrow),link(t.result),link(t.collection),p.stage==='settled'?`+${Number(p.settlement.netAtomicUnits)/1e6} tUSDM`:'n/a']));
 }
 const dirPP=join(dir,'priceproof-purchases');
 if(!existsSync(dirPP)||!process.env.PRICEPROOF_MPS_TOKEN)return;
 const ppAddress=JSON.parse(readFileSync('docs/priceproof-registration-state.json','utf8')).registration.SmartContractWallet.walletAddress;
 const purchases=readdirSync(dirPP).map(f=>JSON.parse(readFileSync(join(dirPP,f),'utf8'))).filter(j=>j.stage==='result-verified'&&j.evidence?.blockchainIdentifier).sort((a,b)=>a.startedAt-b.startedAt);
 const seen=new Set();
 console.log('\n| PriceProof purchase (UTC start) | Escrow tx | Result tx | Collection tx (PriceProof) | PriceProof net |\n|---|---|---|---|---|');
 for(const j of purchases){
  if(seen.has(j.evidence.blockchainIdentifier))continue;
  seen.add(j.evidence.blockchainIdentifier);
  const t=txsFromPayment(await resolve(process.env.PRICEPROOF_MPS_TOKEN,j.evidence.blockchainIdentifier));
  console.log(row([new Date(j.startedAt).toISOString().slice(0,19).replace('T',' '),link(t.escrow??j.evidence.escrowTx),link(t.result??j.evidence.resultTx),link(t.collection),await net(t.collection,ppAddress)]));
 }
}
if(import.meta.url===`file://${process.argv[1]}`)await main();
