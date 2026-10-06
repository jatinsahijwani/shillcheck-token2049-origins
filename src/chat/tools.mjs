import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createDeps,vetKols,cleanHandles} from '../pipeline.mjs';
import {createMockFetch} from '../mock-fetch.mjs';
import {createCache} from '../cache.mjs';
import {cacheDir,dataDir,isMock,RULES} from '../config.mjs';
import {ttlFromEnv,normalizeHandle} from '../x-client.mjs';
import {quickFacts} from './quick.mjs';
const DAY=86400000;
const dayStart=()=>{const d=new Date();d.setUTCHours(0,0,0,0);return d.getTime()};
// Estimated live X spend today by chat-made reports (users $0.01, posts $0.005). Used to cap live reads from chat.
export function chatSpendToday(dir,since=dayStart()){
 if(!existsSync(dir))return 0;
 let total=0;
 for(const f of readdirSync(dir).filter(f=>/^rpt_[0-9a-f]{12}\.json$/.test(f))){
  try{const r=JSON.parse(readFileSync(join(dir,f),'utf8'));if(String(r.sessionId??'').startsWith('chat:')&&Date.parse(r.createdAt)>=since)total+=r.usage?.estXCostUsd??0}catch{}
 }
 return total;
}
// Chat is cache-first. Live X reads happen only when CHAT_X_LIVE=true and today's chat spend is under CHAT_X_DAILY_USD.
export function chatEnv(env=process.env,dir=dataDir(env)){
 const dailyCap=Number(env.CHAT_X_DAILY_USD)>0?Number(env.CHAT_X_DAILY_USD):2;
 const live=env.CHAT_X_LIVE==='true'&&env.X_LIVE_ALLOWED!=='never'&&chatSpendToday(dir)<dailyCap;
 return {...env,X_LIVE_ALLOWED:live?'true':'false',SHILLCHECK_MAX_X_COST_USD:env.CHAT_X_REPORT_USD||'1'};
}
export async function quickCheck(input,sessionId,{env=process.env,fetchImpl,now=Date.now()}={}){
 const handle=normalizeHandle(input.handle);
 if(!handle)return {status:'invalid',handle:String(input.handle).slice(0,40),verdict:'Not rated',reason:'not a valid X handle'};
 const fee=Number(input.fee_usd)>0?Number(input.fee_usd):undefined;
 const dir=dataDir(env);
 const deps=createDeps({env:chatEnv(env,dir),now,fetchImpl:fetchImpl??(isMock(env)?createMockFetch({now}):fetch)});
 const report=await vetKols({handles:[handle],budget_usd:undefined,quoted_fees:fee?{[handle]:fee}:undefined,cpm_usd:input.cpm_usd},{deps,dir,sessionId:`chat:${sessionId}`});
 return {quick_id:report.id,asked_fee_usd:fee??null,...quickFacts(report,fee??null)};
}
// "Vet these 5" becomes a ready-to-paste Task text plus an honest cost note from the cache.
export function planTask(input,{env=process.env}={}){
 const {valid,invalid,dropped}=cleanHandles(input.handles);
 const cache=createCache({dir:isMock(env)?undefined:cacheDir(env)});
 const ttl=ttlFromEnv(env);
 const cached=[],uncached=[];
 for(const h of valid){
  const u=cache.get(`x:user:${h.toLowerCase()}`,ttl);
  const hit=u&&(u.found===false||(u.user&&cache.get(`x:tweets:${u.user.id}`,ttl)!==undefined));
  (hit?cached:uncached).push(h);
 }
 const parts=[`Vet ${valid.map(h=>'@'+h).join(' ')}`];
 if(input.goal)parts.push(`for ${String(input.goal).slice(0,120)}`);
 const tail=[];
 if(Number(input.budget_usd)>0)tail.push(`Budget $${Math.round(Number(input.budget_usd)).toLocaleString('en-US')}`);
 if(input.region)tail.push(String(input.region).slice(0,40));
 const task_text=`${parts.join(' ')}.${tail.length?` ${tail.join(', ')}.`:''}`;
 return {task_text,handles:valid,invalid_inputs:invalid,dropped_beyond_limit:dropped,cached_handles:cached,uncached_handles:uncached,
  live_x_enabled:env.X_LIVE_ALLOWED==='true',est_live_cost_usd_if_uncached:Math.round(uncached.length*0.7*100)/100,max_handles_per_task:RULES.maxHandles,
  how_to:['Create a Task for this Coworker in your workspace and paste the task text.','Approve the 1 tUSDM quote.','The report arrives in the Task, usually in under a minute for cached handles; you can reply with changes like "drop anyone above $5K".']};
}
