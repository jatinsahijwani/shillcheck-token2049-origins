import {quickCheck,planTask} from './tools.mjs';
import {expandChatMarkers} from './markers.mjs';
import {handlesIn} from '../notices.mjs';
import {dataDir} from '../config.mjs';
const HELP='Hi! I can check whether a crypto KOL on X is worth paying. Try "is @name worth $3K?" for a quick verdict, or "vet these 3: @a @b @c, budget $20K, Asia" and I will prepare the Task for you. (My language model is unavailable at the moment, so I am answering with fixed rules.)';
// Rule-based chat answers for when the language model is down: one handle gets the quick verdict, several get the Task text.
export async function chatFallback(text,{env=process.env,sessionId='fallback'}={}){
 const handles=handlesIn(text);
 if(!handles.length)return HELP;
 if(handles.length>1){
  const budget=/\$\s*([\d,.]+)\s*([km])?/i.exec(text);
  const region=/\b(asia|europe|latam|africa|mena|oceania|north america|usa)\b/i.exec(text)?.[1];
  const plan=planTask({handles,region,budget_usd:budget?Number(budget[1].replace(/,/g,''))*({k:1e3,m:1e6}[(budget[2]||'').toLowerCase()]??1):undefined},{env});
  return `Here is the Task text:\n\n\`\`\`\n${plan.task_text}\n\`\`\`\n\n${plan.how_to.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nCached (instant): ${plan.cached_handles.map(h=>'@'+h).join(', ')||'none'}. ${plan.uncached_handles.length?`Needs a live X read: ${plan.uncached_handles.map(h=>'@'+h).join(', ')}.`:''}`;
 }
 const fee=/\$\s*([\d,.]+)\s*([km])?/i.exec(text);
 const feeUsd=fee?Number(fee[1].replace(/,/g,''))*({k:1e3,m:1e6}[(fee[2]||'').toLowerCase()]??1):undefined;
 const q=await quickCheck({handle:handles[0],fee_usd:feeUsd},sessionId,{env});
 if(!q.quick_id)return `That is not a valid X handle. ${HELP}`;
 return expandChatMarkers(`[[SHILLCHECK_QUICK:${q.quick_id}${feeUsd?`:fee=${feeUsd}`:''}]]`,{dir:dataDir(env)});
}
