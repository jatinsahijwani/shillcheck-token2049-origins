import { Client } from 'eve/client';
import { writeFileSync } from 'node:fs';
import { expandReportMarker } from './src/marker.mjs';
import { dataDir, turnTimeoutMs } from './src/config.mjs';
const MODEL_TURN_TIMEOUT_MS=turnTimeoutMs();
export const client=new Client({host:process.env.EVE_URL});
import { answerWithoutModel } from './src/fallback.mjs';
import { routeBrief } from './src/product/input.mjs';
import { planProduct, productModeEnabled } from './src/product/plan.mjs';
export async function answer(input,journal,deadline) {
 if(typeof input!=='string'||!input.trim()||input.length>16000) throw new Error('Input must contain 1 to 16000 characters');
 // BETA product campaign planner: only with PRODUCT_MODE_ENABLED=true and only for briefs without handles or token words.
 if(productModeEnabled()&&routeBrief(input)==='product'){
  try{const message=await planProduct(input);writeFileSync(journal,JSON.stringify({phase:'answered',result:message,product:true}),{mode:0o600});return message}
  catch(error){console.error('Product planner failed, using the standard path:',String(error?.message).slice(0,100))}
 }
 try{return await answerWithModel(input,journal,deadline)}
 catch(error){
  // The deadline guard must still fail loudly. Anything else is a model or eve problem: the analysis does not need the model.
  if(/deadline expired/.test(String(error?.message)))throw error;
  console.error('Model unavailable, answering with the deterministic fallback:',String(error?.message).slice(0,100));
  const message=await answerWithoutModel(input);
  writeFileSync(journal,JSON.stringify({phase:'answered',result:message,fallback:true}),{mode:0o600});
  return message;
 }
}
async function answerWithModel(input,journal,deadline) {
 const {session}=await client.sessions.create();
 writeFileSync(journal,JSON.stringify({sessionId:session.state.sessionId,phase:'sending'}),{mode:0o600});
 if(deadline!==undefined&&Date.now()>=deadline)throw new Error('Result deadline expired before model send');
 const startedAt=Date.now();
 // A stalled provider must not hold a paid Task past its deadline: give up on this turn and let the caller retry.
 const limitMs=Math.max(30000,Math.min(MODEL_TURN_TIMEOUT_MS,deadline===undefined?Infinity:deadline-Date.now()-60000));
 let timer;
 const result=await Promise.race([(async()=>(await session.send(input)).result())(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Model turn timed out')),limitMs)})]).finally(()=>clearTimeout(timer));
 if(result.status==='failed'||result.inputRequests.length||!result.message?.trim()) throw new Error('Turn did not return a final answer');
 // Expand the marker BEFORE the result is journaled, saved or hashed: the paid bytes are the full report.
 const message=expandReportMarker(result.message,{dir:dataDir(),sessionId:session.state.sessionId,sinceMs:startedAt});
 writeFileSync(journal,JSON.stringify({sessionId:session.state.sessionId,phase:'answered',result:message}),{mode:0o600});
 return message;
}
