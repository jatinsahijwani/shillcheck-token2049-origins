// Prints the README "Evidence" rows for a settled paid Task from its worker journal. No secrets are read or printed.
//   node scripts/evidence.mjs <taskId> [journalPath]
import {readFileSync} from 'node:fs';
const [taskId,path=`.local/${process.argv[2]}.json`]=process.argv.slice(2);
if(!taskId){console.error('Usage: node scripts/evidence.mjs <taskId> [journalPath]');process.exit(1)}
const s=JSON.parse(readFileSync(path,'utf8'));
const reg=JSON.parse(readFileSync('docs/registration-state.json','utf8'));
const p=s.paid;
if(p?.stage!=='settled'||!p.settlement?.verified)throw new Error(`Task ${taskId} is not settled and verified (stage ${p?.stage})`);
const hist=p.observed.TransactionHistory??[];
const tx=state=>(hist.find(h=>h.newOnChainState===state)??p.observed.CurrentTransaction).txHash;
const link=h=>`[${h.slice(0,16)}…](https://preprod.cardanoscan.io/transaction/${h})`;
const seller=reg.registration.SmartContractWallet.walletAddress;
const withdraw=p.observed.CurrentTransaction.txHash;
console.log(`| Paid Task ID | \`${taskId}\` |
| Payment event IDs | purchase: \`${p.eventId}\`; completion with result: \`${p.completionEventId}\` |
| MPS payment request ID | \`${p.payment.id}\` |
| Escrow transaction (FundsLocked) | ${link(tx('FundsLocked'))} |
| Result submission transaction | ${link(tx('ResultSubmitted'))} |
| Collection / withdrawal transaction | ${link(withdraw)} |
| Seller address | \`${seller}\` |
| Net tUSDM received (this transaction's seller output minus input) | **${Number(p.settlement.netAtomicUnits)/1e6} tUSDM (${p.settlement.netAtomicUnits} atomic units)** |
| Core receipt vs \`sokosumi runtime receipt\` | ${p.settlement.cliReceipt?.status??'n/a'} |
| Result hash | \`${p.resultHash}\` |
| Blockchain identifier | \`${p.payment.blockchainIdentifier}\` |`);
