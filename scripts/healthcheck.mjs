// Run by cron every 5 minutes on the server: node --env-file=.env scripts/healthcheck.mjs
// Checks every process, restarts a dead or unhealthy one (pm2), logs JSON lines to .local/health/health.log and keeps the
// latest result in .local/health/status.json. Gemini reachability is reported only (restarting does not fix it).
import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from 'eve/client';
import {decide,summarize} from '../src/health.mjs';
import {repoRoot} from '../src/config.mjs';
const dir=join(repoRoot,'.local','health');mkdirSync(dir,{recursive:true,mode:0o700});
const statePath=join(dir,'state.json'),statusPath=join(dir,'status.json'),logPath=join(dir,'health.log');
const env=process.env;
const timeout=ms=>AbortSignal.timeout(ms);
const wrap=async fn=>{try{return await fn()}catch(error){return {ok:false,detail:String(error?.message??error).slice(0,120)}}};
function pm2(){return Object.fromEntries(JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',timeout:20000})).map(p=>[p.name,p.pm2_env.status]))}
let procs={};try{procs=pm2()}catch{}
const online=name=>procs[name]==='online';
const processCheck=name=>({ok:online(name),detail:online(name)?'online':`pm2 status ${procs[name]??'missing'}`,restart:name,immediate:true});
const http=async(url,okFn)=>{const r=await fetch(url,{signal:timeout(8000)});return okFn(r)};
const results={
 'process:mps':processCheck('shillcheck-mps'),'process:eve':processCheck('shillcheck-eve'),'process:api':processCheck('shillcheck-api'),
 'process:worker':processCheck('shillcheck-worker'),'process:chat-eve':processCheck('shillcheck-chat-eve'),'process:chat':processCheck('shillcheck-chat'),
};
const add=async(name,restart,fn)=>{const r=await wrap(fn);results[name]={...r,restart:r.ok?undefined:restart}};
await add('mps-health','shillcheck-mps',()=>http(`${env.MPS_URL||'http://127.0.0.1:38127'}/api/v1/health`,async r=>{const j=await r.json();return {ok:r.ok&&j?.data?.status==='ok',detail:`HTTP ${r.status}`}}));
await add('api','shillcheck-api',()=>http(`http://127.0.0.1:${env.AGENT_API_PORT||21950}/availability`,async r=>({ok:r.ok,detail:`HTTP ${r.status}`})));
await add('eve','shillcheck-eve',async()=>{await new Client({host:env.EVE_URL||'http://127.0.0.1:21949'}).health();return {ok:true,detail:'health ok'}});
await add('chat-eve','shillcheck-chat-eve',async()=>{await new Client({host:env.CHAT_EVE_URL||'http://127.0.0.1:21971'}).health();return {ok:true,detail:'health ok'}});
await add('chat','shillcheck-chat',()=>http(`http://127.0.0.1:${env.CHAT_PORT||21970}/c/${env.CHAT_PATH_SECRET}/health`,async r=>({ok:r.ok,detail:`HTTP ${r.status}`})));
await add('worker-heartbeat','shillcheck-worker',async()=>{
 const f=join(repoRoot,'.local','worker.heartbeat');
 if(!existsSync(f))return {ok:false,detail:'no heartbeat file yet'};
 const age=Date.now()-statSync(f).mtimeMs;
 // The loop sleeps 5 s but a model turn can hold it for a few minutes, so the allowance is generous.
 return {ok:age<12*60000,detail:`last beat ${Math.round(age/1000)}s ago`};
});
// Reported only: restarting a process does not fix an upstream outage. A 429 still proves the API is reachable.
results.gemini=await wrap(async()=>{const r=await fetch(`${env.ZAI_BASE_URL}/models`,{headers:{authorization:`Bearer ${env.ZAI_API_KEY}`},signal:timeout(10000)});return {ok:r.ok||r.status===429,detail:r.status===429?'reachable (rate limited)':`HTTP ${r.status}`}});
const prev=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):undefined;
const {state,actions,ok}=decide({results,prev});
for(const a of actions.filter(a=>a.action==='restart')){
 try{execFileSync('pm2',['restart',a.restart],{timeout:60000,stdio:'ignore'});a.done=true}catch(error){a.done=false;a.error=String(error.message).slice(0,100)}
}
const summary=summarize({results,actions,ok});
writeFileSync(`${statePath}.tmp`,JSON.stringify(state),{mode:0o600});renameSync(`${statePath}.tmp`,statePath);
writeFileSync(`${statusPath}.tmp`,JSON.stringify(summary,null,1),{mode:0o600});renameSync(`${statusPath}.tmp`,statusPath);
appendFileSync(logPath,JSON.stringify({...summary,checks:Object.fromEntries(Object.entries(summary.checks).filter(([,c])=>!c.ok))})+'\n',{mode:0o600});
// Keep the log bounded.
if(statSync(logPath).size>2_000_000){const lines=readFileSync(logPath,'utf8').split('\n');writeFileSync(logPath,lines.slice(-2000).join('\n'),{mode:0o600})}
console.log(summary.overall,actions.map(a=>`${a.action} ${a.restart}`).join(', '));
