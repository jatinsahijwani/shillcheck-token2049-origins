import {parseJson} from './llm.mjs';
const text=(v,max=300)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateStrategy(v){
 if(!v||typeof v!=='object')return 'not an object';
 if(!text(v.campaign_goal)||!text(v.audience))return 'campaign_goal and audience are required';
 if(!Array.isArray(v.content_angles)||v.content_angles.length!==3||!v.content_angles.every(a=>text(a?.title,80)&&text(a?.idea)))return 'content_angles needs exactly 3 {title,idea}';
 if(!Array.isArray(v.timeline)||v.timeline.length!==4||!v.timeline.every((w,i)=>w?.week===i+1&&text(w.focus,120)&&text(w.actions)))return 'timeline needs 4 weeks {week,focus,actions}';
 if(!Array.isArray(v.differentiate)||v.differentiate.length<1||v.differentiate.length>4||!v.differentiate.every(s=>text(s)))return 'differentiate needs 1 to 4 strings';
 return null;
}
const SYSTEM=`You write the strategy section of an influencer marketing plan. Ground it ONLY in the product read and creator list you are given. Do not invent creators, handles, prices, followers or statistics. Reply with ONE JSON object:
{"campaign_goal":string,"audience":string,"content_angles":[exactly 3 {"title":string,"idea":string}],"timeline":[exactly 4 {"week":1..4,"focus":string,"actions":string}],"differentiate":[1 to 4 strings: what the product should differentiate on versus the AI-suggested competitors]}
No budget numbers. X (Twitter) is the only live platform; do not plan other platforms.`;
export async function planStrategy({product,creators,budgetUsd,region},{llm}){
 const facts={product,region:region??null,budget_usd:budgetUsd??null,creators:creators.map(c=>({handle:c.handle,followers:c.followers}))};
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(facts)}];
 let hint='';
 for(let attempt=0;attempt<2;attempt++){
  const out=await llm(hint?[...messages,{role:'user',content:`Your last reply was rejected: ${hint}. Reply again with only the JSON object.`}]:messages);
  const parsed=parseJson(out,validateStrategy);
  if(parsed.ok)return parsed.value;
  hint=parsed.error;
 }
 return null;
}
