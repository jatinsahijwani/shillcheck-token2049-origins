import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runtimeArgs,workspaceArgs,runtimeReceipt} from '../sokosumi-runtime.mjs';
import {verifySettlement} from '../settlement.mjs';
import {normalizeRegistration,loadRegistration} from '../src/registration.mjs';
import {expandReportMarker} from '../src/marker.mjs';
import {saveReport} from '../src/store.mjs';
import {USDM} from '../paid-task.mjs';
const TOKEN2049='01a109d1-32a9-71a3-a0e3-658b2a7987cd';
test('Task from the Personal Workspace starts and completes with --personal only',()=>{
 const task={id:'t1',organizationId:null};
 assert.deepEqual(runtimeArgs('start',task,'cw'),['runtime','start','t1','--personal','--coworker-id','cw']);
 assert.deepEqual(runtimeArgs('complete',task,'cw',['--result-file','r.txt']),['runtime','complete','t1','--personal','--coworker-id','cw','--result-file','r.txt']);
});
test('Task from the TOKEN2049 org workspace uses --organization-id and never --personal',()=>{
 const task={id:'t2',organizationId:TOKEN2049};
 const start=runtimeArgs('start',task,'cw');
 assert.deepEqual(start,['runtime','start','t2','--organization-id',TOKEN2049,'--coworker-id','cw']);
 assert.ok(!runtimeArgs('complete',task,'cw',['--result-file','r.txt']).includes('--personal'));
 assert.deepEqual(workspaceArgs({workspace:{organizationId:TOKEN2049}}),['--organization-id',TOKEN2049]);
});
test('workspace selector is chosen per Task, in one worker run',()=>{
 const picks=[{id:'a',organizationId:null},{id:'b',organizationId:TOKEN2049},{id:'c'}].map(t=>runtimeArgs('start',t,'cw')[3]);
 assert.deepEqual(picks,['--personal','--organization-id','--personal']);
});
test('hostile organization id is rejected, not passed to the CLI',()=>{
 assert.throws(()=>workspaceArgs({organizationId:'x; rm -rf /'}),/unsupported organization id/);
 assert.throws(()=>workspaceArgs({organizationId:'--personal'}),/unsupported organization id/);
});
test('runtime receipt command shape: no workspace flag',()=>{
 let seen;const out=runtimeReceipt('t1','cw',(cmd,args)=>{seen=[cmd,args];return '{"settled":true,"txHash":"abc"}'});
 assert.deepEqual(seen[1],['--preprod','runtime','receipt','t1','--coworker-id','cw','--json']);assert.equal(out.settled,true);
});
const SELLER='addr_test1seller';
const payment={blockchainIdentifier:'bid',CurrentTransaction:{status:'Confirmed',newOnChainState:'Withdrawn',txHash:'tx1'},TransactionHistory:[]};
const utxos={inputs:[{address:SELLER,amount:[{unit:USDM,quantity:'100000000'}]}],outputs:[{address:SELLER,amount:[{unit:USDM,quantity:'101000000'}]},{address:'other',amount:[{unit:USDM,quantity:'5'}]}]};
const core=receipt=>({get:async()=>({data:receipt})});
const chain=async()=>({ok:true,json:async()=>utxos});
const run=(cli,receipt={settled:true,txHash:'tx1',blockchainIdentifier:'bid'})=>verifySettlement({core:core(receipt),taskId:'t',payment,sellerAddress:SELLER,unit:USDM,cliReceipt:cli,fetchImpl:chain});
test('settlement: per-transaction net delta (not the 100 tUSDM balance) and CLI receipt must agree',async()=>{
 const ok=await run(async()=>({settled:true,txHash:'tx1'}));
 assert.equal(ok.verified,true);assert.equal(ok.netAtomicUnits,'1000000');assert.equal(ok.cliReceipt.status,'match');
});
test('settlement: CLI receipt with a different tx hash or unsettled blocks verification',async()=>{
 assert.equal((await run(async()=>({settled:true,txHash:'other'}))).verified,false);
 assert.equal((await run(async()=>({settled:false,txHash:null}))).cliReceipt.status,'mismatch');
});
test('settlement: CLI failure is recorded as unavailable, Blockfrost and Core still decide',async()=>{
 const r=await run(async()=>{throw new Error('cli down')});
 assert.equal(r.cliReceipt.status,'unavailable');assert.equal(r.verified,true);
});
test('settlement: zero or negative net receipt is never verified',async()=>{
 const flat={inputs:utxos.outputs.slice(0,1),outputs:utxos.outputs.slice(0,1)};
 const r=await verifySettlement({core:core({settled:true,txHash:'tx1',blockchainIdentifier:'bid'}),taskId:'t',payment,sellerAddress:SELLER,unit:USDM,cliReceipt:async()=>({settled:true,txHash:'tx1'}),fetchImpl:async()=>({ok:true,json:async()=>flat})});
 assert.equal(r.verified,false);assert.equal(r.netAtomicUnits,'0');
});
test('registration: derives source index and seller vkey from the infra state file',()=>{
 const raw={registrationState:'RegistrationConfirmed',agentIdentifier:'a'.repeat(80),walletId:'w',request:{supportedPaymentSources:[{}],sellingWalletVkey:'vk1'},registration:{supportedPaymentSources:[{}],SmartContractWallet:{walletVkey:'vk2'}}};
 const r=normalizeRegistration(raw);
 assert.equal(r.supportedPaymentSourceIndex,0);assert.equal(r.sellerVkey,'vk2');assert.equal(r.agentIdentifier,'a'.repeat(80));
 assert.equal(normalizeRegistration({...raw,supportedPaymentSourceIndex:2,sellerVkey:'own'}).supportedPaymentSourceIndex,2);
 assert.equal(normalizeRegistration({}).supportedPaymentSourceIndex,undefined);
});
test('registration: the real state file (read-only) yields a usable identifier',()=>{
 let r;try{r=loadRegistration()}catch{return}
 assert.match(r.agentIdentifier,/^[0-9a-f]{64,}$/);assert.equal(r.supportedPaymentSourceIndex,0);
});
test('mock mode refuses to start the worker or the Standard API',()=>{
 for(const entry of ['worker.mjs','agent-api.mjs']){
  const r=spawnSync(process.execPath,[entry],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,SHILLCHECK_MOCK:'true',COWORKER_ID:'x'},encoding:'utf8',timeout:20000});
  assert.notEqual(r.status,0,entry);assert.match(r.stderr,/Refusing to start a paid-task process with mock data/,entry);
 }
});
// ---- marker expansion --------------------------------------------------------
const make=(dir,id,sessionId,markdown,createdAt=new Date().toISOString())=>saveReport(dir,{id,createdAt,sessionId,markdown,analyses:[]});
test('marker is replaced by the stored markdown, byte for byte',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marker-'));
 try{
  make(dir,'rpt_aaaaaaaaaaaa','s1','# Report\n\n| a | b |\n');
  const out=expandReportMarker('Assumption: default CPM.\n[[SHILLCHECK_REPORT:rpt_aaaaaaaaaaaa]]',{dir,sessionId:'s1',sinceMs:0});
  assert.equal(out,'Assumption: default CPM.\n# Report\n\n| a | b |');
  assert.doesNotMatch(out,/SHILLCHECK_REPORT/);
 }finally{rmSync(dir,{recursive:true})}
});
test('missing marker: exactly one report created in this session during the call is appended',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marker-'));
 try{
  const since=Date.now()-1000;
  make(dir,'rpt_bbbbbbbbbbbb','s1','# One\n');
  make(dir,'rpt_cccccccccccc','other-session','# Not mine\n');
  make(dir,'rpt_dddddddddddd','s1','# Old\n',new Date(since-60000).toISOString());
  assert.equal(expandReportMarker('Assumptions only.',{dir,sessionId:'s1',sinceMs:since}),'Assumptions only.\n\n# One\n');
  make(dir,'rpt_eeeeeeeeeeee','s1','# Two\n');
  assert.equal(expandReportMarker('Assumptions only.',{dir,sessionId:'s1',sinceMs:since}),'Assumptions only.','two reports: no guessing');
  assert.equal(expandReportMarker('No reports here.',{dir,sessionId:'nobody',sinceMs:since}),'No reports here.');
 }finally{rmSync(dir,{recursive:true})}
});
test('unknown or malicious marker ids never read arbitrary files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marker-'));
 try{
  writeFileSync(join(dir,'secret.json'),'{}');
  assert.match(expandReportMarker('[[SHILLCHECK_REPORT:rpt_000000000000]]',{dir,sessionId:'s',sinceMs:0}),/could not be loaded/);
  assert.match(expandReportMarker('[[SHILLCHECK_REPORT:../secret]]',{dir,sessionId:'s',sinceMs:0}),/could not be loaded/);
 }finally{rmSync(dir,{recursive:true})}
});
test('usage guide replies (no marker, no report) pass through unchanged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marker-'));
 try{assert.equal(expandReportMarker('Send up to 10 X handles.',{dir,sessionId:'s',sinceMs:Date.now()}),'Send up to 10 X handles.')}finally{rmSync(dir,{recursive:true})}
});
