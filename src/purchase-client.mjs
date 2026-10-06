import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {inputHashFor,resultHash} from '../standard-hash.mjs';
import {confirmedState,USDM} from '../paid-task.mjs';
const SOURCE_HOSTS=new Set(['www.coingecko.com','coins.llama.fi','defillama.com']);
const STATUSES=new Set(['ok','pending','unverified','out_of_range']);
export class PriceProofError extends Error{
 // kind: unavailable | rejected | uncertain | timeout | hash-mismatch | bad-result
 constructor(message,{stage,kind}={}){super(message);this.name='PriceProofError';this.stage=stage;this.kind=kind}
}
const num=v=>Number.isFinite(v)?v:null;
const text=(v,max)=>typeof v==='string'?v.slice(0,max):null;
// The sub-agent's answer is untrusted: rebuild each row from known fields only, with bounded strings and allowlisted URLs.
export function parseResult(raw,count){
 let data;try{data=JSON.parse(raw)}catch{throw new PriceProofError('result is not JSON',{stage:'verify',kind:'bad-result'})}
 if(data?.version!=='priceproof/1'||!Array.isArray(data.results)||data.results.length!==count)throw new PriceProofError('result shape does not match the request',{stage:'verify',kind:'bad-result'});
 return data.results.map((r,i)=>{
  if(!r||r.index!==i||!STATUSES.has(r.status))throw new PriceProofError(`result row ${i} is invalid`,{stage:'verify',kind:'bad-result'});
  const sources=(Array.isArray(r.sources)?r.sources:[]).filter(u=>{try{const x=new URL(u);return x.protocol==='https:'&&SOURCE_HOSTS.has(x.hostname)}catch{return false}}).slice(0,4);
  return {index:i,status:r.status,p0:num(r.price_at),p7:num(r.price_7d),p30:num(r.price_30d),pct7:num(r.pct_7d),pct30:num(r.pct_30d),source:r.source==='defillama'?'defillama':'coingecko',coinId:text(r.coin_id,100),reason:text(r.reason,200),sources};
 });
}
// Hires PriceProof once: start_job at the seller, purchase from the MPS purchasing wallet, wait for escrow and the result,
// verify the on-chain result hash, then return sanitized rows. Every stage is journaled before and after its write.
// A write whose outcome is unknown halts with kind "uncertain" and is never retried.
export async function buyPriceProof({lookups,config,deps}){
 const {url,agentIdentifier,maxPriceAtomic='500000',timeoutMs=360000,pollMs=5000,journalDir}=config;
 const {mps,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}=deps;
 mkdirSync(journalDir,{recursive:true,mode:0o700});
 const id=randomUUID();
 const j={id,stage:'init',startedAt:now()};
 const write=patch=>{Object.assign(j,patch,{updatedAt:now()});writeFileSync(join(journalDir,`${id}.json`),JSON.stringify(j),{mode:0o600})};
 const deadline=j.startedAt+timeoutMs;
 const nonce=randomBytes(10).toString('hex');
 const inputData={lookups:JSON.stringify(lookups)};
 const inputHash=inputHashFor(inputData,nonce);
 write({stage:'start-job-pending',nonce,inputHash,count:lookups.length});
 let job;
 try{
  const res=await fetchImpl(`${url}/start_job`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier_from_purchaser:nonce,input_data:inputData}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(res.status>=400&&res.status<500){write({stage:'start-job-rejected',httpStatus:res.status});throw new PriceProofError(`PriceProof rejected the job (HTTP ${res.status})`,{stage:'start-job',kind:'rejected'})}
  if(!res.ok){write({stage:'start-job-uncertain'});throw new PriceProofError('PriceProof start_job outcome unknown',{stage:'start-job',kind:'uncertain'})}
  job=await res.json();
 }catch(error){
  if(error instanceof PriceProofError)throw error;
  write({stage:'start-job-uncertain'});
  throw new PriceProofError('PriceProof start_job outcome unknown',{stage:'start-job',kind:'uncertain'});
 }
 // Nothing is spent until the signed terms match what we asked for.
 const amount=job.amounts?.length===1&&job.amounts[0].unit===USDM&&/^\d+$/.test(job.amounts[0].amount)?BigInt(job.amounts[0].amount):null;
 const bad=!job.blockchainIdentifier||job.agentIdentifier!==agentIdentifier||job.input_hash!==inputHash||amount===null||amount>BigInt(maxPriceAtomic)||!job.sellerVKey||!job.id||Number(job.payByTime)<=now()+60000||Number(job.submitResultTime)<deadline+60000;
 if(bad){write({stage:'terms-rejected'});throw new PriceProofError('PriceProof terms do not match the request (agent, input hash, price or deadlines)',{stage:'terms',kind:'rejected'})}
 write({stage:'job-started',sellerJobId:job.id,blockchainIdentifier:job.blockchainIdentifier,amountAtomic:amount.toString()});
 write({stage:'purchase-pending'});
 let purchase;
 try{
  purchase=await mps('/purchase',{blockchainIdentifier:job.blockchainIdentifier,network:'Preprod',paymentSourceType:job.paymentSourceType??'Web3CardanoV2',supportedPaymentSourceIndex:job.supportedPaymentSourceIndex,inputHash,sellerVkey:job.sellerVKey,agentIdentifier,Amounts:job.amounts,unlockTime:String(job.unlockTime),externalDisputeUnlockTime:String(job.externalDisputeUnlockTime),submitResultTime:String(job.submitResultTime),payByTime:String(job.payByTime),identifierFromPurchaser:nonce,metadata:JSON.stringify({purpose:'shillcheck-price-lookups'})});
 }catch{
  write({stage:'purchase-uncertain'});
  throw new PriceProofError('purchase outcome unknown; inspect the journal and the purchasing wallet before any retry',{stage:'purchase',kind:'uncertain'});
 }
 write({stage:'awaiting-escrow',purchaseId:purchase?.id??null});
 let escrowTx=null,transient=0;
 while(now()<deadline){
  await sleep(pollMs);
  let state;
  try{state=await mps('/purchase/resolve-blockchain-identifier',{network:'Preprod',blockchainIdentifier:job.blockchainIdentifier,includeHistory:'true'})}
  catch{if(++transient>20)break;continue}
  const history=[state.CurrentTransaction,...(state.TransactionHistory||[])].filter(Boolean);
  const locked=history.find(t=>t.status==='Confirmed'&&t.newOnChainState==='FundsLocked');
  if(locked&&!escrowTx){escrowTx=locked.txHash;write({stage:'awaiting-result',escrowTx})}
  if(state.onChainState!=='ResultSubmitted'||!confirmedState(state,'ResultSubmitted')||!state.resultHash)continue;
  const submitted=history.find(t=>t.status==='Confirmed'&&t.newOnChainState==='ResultSubmitted');
  let status;
  try{const r=await fetchImpl(`${url}/status?job_id=${encodeURIComponent(job.id)}`,{redirect:'error',signal:AbortSignal.timeout(15000)});status=r.ok?await r.json():null}catch{status=null}
  if(status?.status!=='completed'||typeof status.result!=='string')continue;
  // Verify before use: the result bytes must hash to what the seller committed on chain.
  if(resultHash(status.result,nonce)!==state.resultHash){write({stage:'hash-mismatch'});throw new PriceProofError('result hash does not match the on-chain commitment',{stage:'verify',kind:'hash-mismatch'})}
  const rows=parseResult(status.result,lookups.length);
  const evidence={agentIdentifier,blockchainIdentifier:job.blockchainIdentifier,escrowTx,resultTx:submitted?.txHash??null,amountAtomic:amount.toString(),resultHash:state.resultHash,purchaseId:purchase?.id??null,journalId:id};
  write({stage:'result-verified',evidence});
  return {rows,evidence};
 }
 write({stage:'timed-out'});
 throw new PriceProofError(`no verified result within ${Math.round(timeoutMs/1000)}s; escrowed funds, if any, are recoverable via the purchase refund flow`,{stage:escrowTx?'awaiting-result':'awaiting-escrow',kind:'timeout'});
}
