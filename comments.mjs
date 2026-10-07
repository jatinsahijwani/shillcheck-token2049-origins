import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {client} from './client.mjs';
import {loadSokosumiRuntime} from './sokosumi-runtime.mjs';
import {readCoworkerKey} from './src/coworker-key.mjs';
import {expandReportMarker} from './src/marker.mjs';
import {dataDir} from './src/config.mjs';
import {followUpWithoutModel,previousResultOf} from './src/fallback.mjs';
const {createCoworkerHttpClient,fetchTaskEvents,createTaskEvent}=await loadSokosumiRuntime();
const runtime=createCoworkerHttpClient({apiKey:await readCoworkerKey(process.env.COWORKER_ID)});
// Plain comment from the Coworker (no status change, no payment fields).
export const postComment=(taskId,comment)=>createTaskEvent(runtime,taskId,{comment},AbortSignal.timeout(30000));
export async function reply(taskId){
 const p=`.local/${taskId}-comments.json`;
 const state=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{};
 const {events}=await fetchTaskEvents(runtime,taskId,AbortSignal.timeout(30000));
 const sessionFile=`.local/${taskId}-session.json`;
 const sessionId=existsSync(sessionFile)?JSON.parse(readFileSync(sessionFile,'utf8')).sessionId:null;
 for(const event of events.filter(e=>e.actor?.type==='user'&&typeof e.comment==='string'&&e.comment.trim())){
 if(state[event.id])continue;
 state[event.id]='model-pending';writeFileSync(p,JSON.stringify(state),{mode:0o600});
 const startedAt=Date.now();
 const paid=Boolean(JSON.parse(readFileSync(`.local/${taskId}.json`,'utf8')).paid);
 let text;
 try{
  if(!sessionId)throw new Error('no model session for this Task');
  const response=await(await client.sessions.attach(sessionId).send(event.comment.slice(0,16000))).result();
  if(response.status==='failed'||response.inputRequests.length||!response.message?.trim())throw new Error('model did not answer');
  text=expandReportMarker(response.message,{dir:dataDir(),sessionId,sinceMs:startedAt,compact:true,paid});
 }catch(error){
  // Model unavailable: answer with simple rules from the stored report instead of leaving the comment unanswered.
  text=followUpWithoutModel({comment:event.comment,previousResult:previousResultOf(taskId),paid});
 }
 state[event.id]='post-pending';writeFileSync(p,JSON.stringify(state),{mode:0o600});
 await createTaskEvent(runtime,taskId,{comment:text},AbortSignal.timeout(30000));
 state[event.id]='posted';writeFileSync(p,JSON.stringify(state),{mode:0o600});
 }
}
