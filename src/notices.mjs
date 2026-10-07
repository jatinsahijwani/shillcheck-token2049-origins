import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {cleanHandles} from './pipeline.mjs';
const cardanoscan=h=>`https://preprod.cardanoscan.io/transaction/${h}`;
const ESCROW_ADDRESS='addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g';
export function handlesIn(text){
 const found=[...String(text??'').matchAll(/(?:^|[\s,;(])@([A-Za-z0-9_]{1,15})\b/g)].map(m=>m[1]);
 return cleanHandles(found).valid;
}
// Rough, honest timing: escrow confirmation on Preprod takes 3 to 4 minutes, the report about a minute, each uncached handle
// adds a live X read, and the PriceProof sub-purchase (when enabled) adds up to 7 minutes.
export function estimateMinutes({paid,uncached=0,priceProof=false}){
 const m=(paid?5:1)+Math.ceil(uncached*0.5)+(priceProof?5:0);
 return Math.max(1,m);
}
// Posted once, right after the Task starts. Plain facts about what happens next; no model involved.
export function ackText({input,paid,uncached=[],priceProof=false,product=false}){
 const handles=handlesIn(input);
 if(product)return `On it (beta): reading your product brief, then one live X search for creators${paid?' after the 1 tUSDM escrow is confirmed on Cardano (about 3 to 4 minutes)':''}. Expect the plan in about ${paid?6:2} minutes.`;
 if(!handles.length)return 'On it: reading your request. If it contains no X handles you will get a short usage guide.';
 const minutes=estimateMinutes({paid,uncached:uncached.length,priceProof});
 const steps=paid?'Next: the 1 tUSDM quote, then the escrow is confirmed on Cardano (about 3 to 4 minutes), then your report.':'Your report follows.';
 const live=uncached.length?` ${uncached.length} handle${uncached.length===1?' is':'s are'} not cached and need a live X read (up to about 30 seconds each, within the report cap).`:'';
 const pp=priceProof?' Token prices are bought from a second Masumi agent, PriceProof, which can add a few minutes.':'';
 return `On it: vetting ${handles.length} handle${handles.length===1?'':'s'} (${handles.map(h=>'@'+h).join(', ')}). ${steps}${live}${pp} Expect the result in about ${minutes} minute${minutes===1?'':'s'}.`;
}
// Posted once after settlement is verified. Separate from the result comment, so the paid result and its hash are untouched.
export function receiptText(journal){
 const p=journal.paid;
 const all=[p.observed?.CurrentTransaction,...(p.observed?.TransactionHistory??[])].filter(t=>t?.status==='Confirmed'&&t.txHash);
 const tx=state=>all.find(t=>t.newOnChainState===state)?.txHash;
 const row=(label,hash)=>hash?`- ${label}: [${hash.slice(0,16)}…](${cardanoscan(hash)})`:null;
 const net=Number(p.settlement.netAtomicUnits)/1e6;
 return ['Receipt for this Task (Cardano Preprod, Masumi escrow).',
  row('Escrow locked (1 tUSDM)',tx('FundsLocked')),
  `- Escrow contract: [${ESCROW_ADDRESS.slice(0,24)}…](https://preprod.cardanoscan.io/address/${ESCROW_ADDRESS})`,
  `- Result hash submitted on chain: \`${p.resultHash}\` (SHA-256 of the report posted above)`,
  row('Result submitted',tx('ResultSubmitted')),
  row('Payout collected by the seller',tx('Withdrawn')??tx('DisputedWithdrawn')),
  `- Seller net: +${net} tUSDM, checked against the Core receipt, \`sokosumi runtime receipt\` and the transaction's inputs and outputs on Blockfrost.`].filter(Boolean).join('\n');
}
const writeJournal=(path,data)=>{writeFileSync(`${path}.tmp`,JSON.stringify(data),{mode:0o600});renameSync(`${path}.tmp`,path)};
export const mergeJournal=(path,patch)=>{const j=JSON.parse(readFileSync(path,'utf8'));const next={...j,...patch};writeJournal(path,next);return next};
// Posts a notice at most once. The flag is written BEFORE the post: if the outcome is unknown the notice is skipped, never repeated.
export async function postOnce({journalPath,flag,build,post}){
 const j=JSON.parse(readFileSync(journalPath,'utf8'));
 if(j[flag])return {posted:false,reason:`${flag} already ${j[flag]}`};
 const text=build(j);
 if(!text)return {posted:false,reason:'nothing to post'};
 mergeJournal(journalPath,{[flag]:'pending'});
 try{await post(text);mergeJournal(journalPath,{[flag]:'posted'});return {posted:true,text}}
 catch(error){mergeJournal(journalPath,{[flag]:'uncertain'});return {posted:false,reason:`post failed: ${String(error.message).slice(0,80)}`}}
}
