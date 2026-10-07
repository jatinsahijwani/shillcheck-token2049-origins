import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {inputHashFor,resultHash,sha256} from '../standard-hash.mjs';
import {confirmedState,USDM} from '../paid-task.mjs';
const MIN=60000;
// MPS rules found against the real service: the result deadline must be at least 15 minutes ahead, and the external dispute
// unlock at least 15 minutes after the unlock time. These are the same windows agent-api.mjs uses.
export const DEFAULT_WINDOWS={pay:10,submit:20,unlock:36,dispute:52};
const NONCE_RE=/^[a-fA-F0-9]{14,26}$/;
const JOB_RE=/^[0-9a-f-]{36}$/;
// Parametrised MIP-004 Standard API (availability, input_schema, start_job, status) with the same payment, escrow and
// hash handling as agent-api.mjs. agent-api.mjs is left untouched so ShillCheck's own paid path behaves exactly as in v1.
// Uncertain writes are never retried: every write is preceded by a *-pending phase that the poll loop never replays.
export function createStandardApi({name,jobsDir,schema,validate,execute,registration,mps,priceAtomic='250000',windows=DEFAULT_WINDOWS,now=()=>Date.now(),maxBody=20000,minMarginMs=60000,log=console}){
 mkdirSync(jobsDir,{recursive:true,mode:0o700});
 const fields=schema.input_data.map(f=>f.id);
 const save=job=>writeFileSync(join(jobsDir,`${job.id}.json`),JSON.stringify(job),{mode:0o600});
 const load=id=>JSON.parse(readFileSync(join(jobsDir,`${id}.json`),'utf8'));
 const ids=()=>readdirSync(jobsDir).filter(x=>/^[0-9a-f-]{36}\.json$/.test(x)).map(x=>x.replace('.json',''));
 const respond=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))};
 async function handler(req,res){
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/availability')return respond(res,200,{status:'available',type:'masumi-agent',name});
   if(req.method==='GET'&&url.pathname==='/input_schema')return respond(res,200,schema);
   if(req.method==='GET'&&url.pathname==='/status'){
    const id=url.searchParams.get('job_id');
    if(!JOB_RE.test(id||''))return respond(res,400,{error:'Invalid job_id'});
    if(!existsSync(join(jobsDir,`${id}.json`)))return respond(res,404,{error:'Job not found'});
    const job=load(id);
    return respond(res,200,{id,status:job.status,result:job.status==='completed'?job.result:undefined});
   }
   if(req.method!=='POST'||url.pathname!=='/start_job')return respond(res,404,{error:'Route not found'});
   let bytes=0,body='';
   for await(const part of req){bytes+=part.length;if(bytes>maxBody)return respond(res,413,{error:'Request too large'});body+=part}
   let input;try{input=JSON.parse(body)}catch{return respond(res,400,{error:'Body must be JSON'})}
   const nonce=input.identifier_from_purchaser??input.identifierFromPurchaser;
   const data=input.input_data;
   if(!NONCE_RE.test(nonce||'')||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k)))return respond(res,400,{error:'Expected hex purchaser nonce and input_data matching /input_schema'});
   const problem=validate(data);
   if(problem)return respond(res,400,{error:problem});
   const reg=registration();
   if(reg.registrationState!=='RegistrationConfirmed'&&reg.registration?.state!=='RegistrationConfirmed')return respond(res,503,{error:'Registration not confirmed'});
   // Persist before the payment write. An unknown outcome needs inspection, never an automatic replay.
   const key=sha256(nonce);
   const hash=inputHashFor(data,nonce);
   let job=ids().map(load).find(j=>j.nonceKey===key);
   if(job){
    if(job.inputHash!==hash)return respond(res,409,{error:'Nonce already used with another input'});
    return respond(res,job.response?200:409,job.response||{error:'Payment outcome requires inspection'});
   }
   const t=now();
   job={id:randomUUID(),nonceKey:key,nonce,input:data,inputHash:hash,status:'awaiting_payment',phase:'payment-pending'};
   save(job);
   const at=m=>new Date(t+m*MIN).toISOString();
   const payment=await mps('/payment',{network:'Preprod',paymentSourceType:'Web3CardanoV2',supportedPaymentSourceIndex:reg.supportedPaymentSourceIndex,inputHash:hash,agentIdentifier:reg.agentIdentifier,identifierFromPurchaser:nonce,RequestedFunds:[{unit:USDM,amount:priceAtomic}],payByTime:at(windows.pay),submitResultTime:at(windows.submit),unlockTime:at(windows.unlock),externalDisputeUnlockTime:at(windows.dispute)});
   job.payment=payment;job.phase='waiting-payment';
   job.response={id:job.id,input_hash:hash,identifierFromPurchaser:nonce,blockchainIdentifier:payment.blockchainIdentifier,agentIdentifier:reg.agentIdentifier,sellerVKey:reg.sellerVkey,paymentSourceType:'Web3CardanoV2',supportedPaymentSourceIndex:reg.supportedPaymentSourceIndex,amounts:[{unit:USDM,amount:priceAtomic}],payByTime:Number(payment.payByTime),submitResultTime:Number(payment.submitResultTime),unlockTime:Number(payment.unlockTime),externalDisputeUnlockTime:Number(payment.externalDisputeUnlockTime)};
   save(job);
   return respond(res,200,job.response);
  }catch{respond(res,500,{error:'Request failed. Inspect the saved job state before retrying.'})}
 }
 let busy=false;
 // One pass over all jobs. Exported so tests (and the interval below) share the same state machine.
 async function tick(){
  if(busy)return;busy=true;
  try{
   for(const id of ids()){
    const job=load(id);
    try{
     if(!['waiting-payment','awaiting-result'].includes(job.phase))continue;
     const payment=await mps('/payment/resolve-blockchain-identifier',{network:'Preprod',blockchainIdentifier:job.payment.blockchainIdentifier,includeHistory:'true'});
     if(job.phase==='awaiting-result'){
      if(payment.onChainState==='ResultSubmitted'&&payment.resultHash===job.resultHash&&confirmedState(payment,'ResultSubmitted')){job.phase='result-confirmed';job.status='completed';save(job)}
      continue;
     }
     if(payment.onChainState!=='FundsLocked'||!confirmedState(payment,'FundsLocked'))continue;
     if(Number(payment.submitResultTime)<=now()+minMarginMs){job.phase='deadline-blocked';job.status='failed';save(job);continue}
     job.phase='compute-pending';job.status='running';save(job);
     job.result=await execute(job.input,{job});
     if(typeof job.result!=='string'||!job.result)throw new Error('empty result');
     job.resultHash=resultHash(job.result,job.nonce);job.phase='submit-pending';save(job);
     if(Number(payment.submitResultTime)<=now()){job.phase='deadline-blocked';job.status='failed';save(job);continue}
     await mps('/payment/submit-result',{network:'Preprod',blockchainIdentifier:payment.blockchainIdentifier,submitResultHash:job.resultHash});
     job.phase='awaiting-result';save(job);
    }catch(error){
     // compute-pending / submit-pending are not in the replay list above: the job halts here for inspection.
     log.error(`${name} job needs inspection`,job.id,String(error.message).slice(0,120));
    }
   }
  }finally{busy=false}
 }
 function listen({port,host='127.0.0.1',pollMs=5000}){
  const server=createServer(handler);
  server.listen(port,host,()=>log.log(`${name} API running`,port));
  const timer=setInterval(tick,pollMs);
  return {server,close:()=>{clearInterval(timer);server.close()}};
 }
 return {handler,tick,listen,jobsDir};
}
