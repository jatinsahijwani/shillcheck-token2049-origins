import './src/refuse-mock.mjs';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {acquireWorkerLock} from './worker-lock.mjs';
import {answer,client} from './client.mjs';
import {reply,postComment} from './comments.mjs';
import {postOnce,ackText,receiptText,handlesIn} from './src/notices.mjs';
import {planTask} from './src/chat/tools.mjs';
import {routeBrief} from './src/product/input.mjs';
import {productModeEnabled} from './src/product/plan.mjs';
import {createPaidAdapter,isPaidReady} from './paid-task.mjs';
import {runtimeArgs,loadSokosumiRuntime} from './sokosumi-runtime.mjs';
import {runtimeCliAuth,usesKeyFile,readCoworkerKey} from './src/coworker-key.mjs';
const id=process.env.COWORKER_ID;
const releaseLock=acquireWorkerLock();
process.once('exit',releaseLock);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{releaseLock();process.exit(0)});
// Runtime commands take the Coworker key from stdin when it comes from a key file (headless host); otherwise from the OS vault.
function cli(args){const auth=args[0]==='runtime'?runtimeCliAuth():{args:[],input:undefined};return JSON.parse(execFileSync('sokosumi',['--preprod',...args,...auth.args,'--json'],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,...(auth.input!==undefined?{input:auth.input}:{})}));}
// Headless hosts have no user login, so tasks are listed with the Coworker key over HTTP (same Core endpoint the CLI uses).
let listClient;
async function listTasks(){
 if(!usesKeyFile())return cli(['tasks','list','--coworker-id',id]).tasks;
 const {createCoworkerHttpClient,fetchTasks}=await loadSokosumiRuntime();
 listClient??=createCoworkerHttpClient({apiKey:await readCoworkerKey(id)});
 return (await fetchTasks(listClient,{coworkerId:id},AbortSignal.timeout(30000))).tasks;
}
// eve restarts take 10 to 30 seconds (compile); wait for it instead of crashing.
for(let attempt=0;;attempt++){try{await client.health();break}catch(error){if(attempt>=100)throw error;await new Promise(r=>setTimeout(r,3000))}}
const paid=await createPaidAdapter({answer,save:async(taskId,state)=>writeFileSync(`.local/${taskId}.json`,JSON.stringify(state),{mode:0o600})});
console.log('Continuous worker running',process.pid,'paid tasks enabled:',process.env.PAID_TASKS_ENABLED==='true');
const beat=()=>{try{writeFileSync('.local/worker.heartbeat',String(Date.now()),{mode:0o600})}catch{}};
while(true){
 beat();
 try{
 const tasks=await listTasks();
 for(const t of tasks.filter(t=>t.coworkerId===id)){
 try{
 const journal=`.local/${t.id}.json`,resultFile=`.local/${t.id}.txt`;
 let state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{};
 if(t.status==='READY'&&!state.phase){writeFileSync(journal,JSON.stringify({phase:'starting'}),{mode:0o600});const started=cli(runtimeArgs('start',t,id));state={phase:'started',input:started.description};writeFileSync(journal,JSON.stringify(state),{mode:0o600});}
 // Two separate comments, neither touches the result or its hash: an immediate acknowledgement and, after settlement, a receipt.
 // Only for Tasks that just arrived: never acknowledge an old Task that is being resumed or has been abandoned.
 if(state.phase==='started'&&!state.ack&&Date.now()-Date.parse(t.createdAt)<15*60000){
 await postOnce({journalPath:journal,flag:'ack',post:text=>postComment(t.id,text),build:j=>ackText({input:j.input,product:productModeEnabled()&&routeBrief(j.input)==='product',paid:process.env.PAID_TASKS_ENABLED==='true'&&isPaidReady(),uncached:planTask({handles:handlesIn(j.input)}).uncached_handles,priceProof:process.env.PRICEPROOF_ENABLED==='true'})});
 state=JSON.parse(readFileSync(journal,'utf8'));
 }
 if(state.paid?.stage==='settled'&&state.paid.settlement?.verified&&!state.receipt){
 await postOnce({journalPath:journal,flag:'receipt',post:text=>postComment(t.id,text),build:receiptText});
 state=JSON.parse(readFileSync(journal,'utf8'));
 }
 if(state.paid&&process.env.PAID_TASKS_ENABLED!=='true')continue;
 if(state.paid||(state.phase==='started'&&process.env.PAID_TASKS_ENABLED==='true'&&isPaidReady())){state=await paid.advance(t,state);if(state.phase==='completed')await reply(t.id);continue;}
 if(state.phase==='started'){
 writeFileSync(journal,JSON.stringify({...state,phase:'model-pending'}),{mode:0o600});
 let result;
 try{result=await answer(state.input,`.local/${t.id}-session.json`)}
 catch(error){const attempts=(state.modelAttempts??0)+1;writeFileSync(journal,JSON.stringify({...state,phase:attempts<3?'started':'model-failed',modelAttempts:attempts}),{mode:0o600});throw error}
 writeFileSync(resultFile,result,{mode:0o600});state={...state,phase:'result-saved'};writeFileSync(journal,JSON.stringify(state),{mode:0o600});
 }
 if(state.phase==='result-saved'){
 writeFileSync(journal,JSON.stringify({...state,phase:'complete-pending'}),{mode:0o600});
 const completed=cli(runtimeArgs('complete',t,id,['--result-file',resultFile]));
 writeFileSync(journal,JSON.stringify({...state,phase:'completed',completion:completed}),{mode:0o600});console.log('Completed',t.id);
 }
 if(state.phase==='completed')await reply(t.id);
 }catch(e){console.error('Task blocked',t.id,e.message.slice(0,200))}
 }
 }catch(e){console.error('Polling read failed',e.message.slice(0,200))}
 await new Promise(r=>setTimeout(r,5000));
}
