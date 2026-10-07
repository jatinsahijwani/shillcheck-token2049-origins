import {parseJson} from './llm.mjs';
const strings=(v,min,max)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(s=>typeof s==='string'&&s.trim()&&s.length<=80);
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const TIERS=['budget','mid-range','premium','luxury'];
export function validateProduct(v){
 if(!v||typeof v!=='object')return 'not an object';
 for(const k of ['product_type','category','visual_style','target_audience'])if(!text(v[k]))return `${k} missing`;
 if(!TIERS.includes(v.price_tier_guess))return 'price_tier_guess must be one of '+TIERS.join(', ');
 if(!strings(v.search_keywords,5,8))return 'search_keywords needs 5 to 8 short strings';
 if(!strings(v.likely_competitors,1,6))return 'likely_competitors needs 1 to 6 brand names';
 return null;
}
const SYSTEM=`You read a product for an influencer marketing planner. Reply with ONE JSON object and nothing else:
{"product_type":string,"category":string,"price_tier_guess":"budget"|"mid-range"|"premium"|"luxury","visual_style":string,"target_audience":string,"search_keywords":[5 to 8 short words or hashtags real people use when posting about this kind of product, no brand names of the product itself],"likely_competitors":[1 to 6 well-known brands that sell similar products]}
Describe only what is visible or stated. If you are unsure, say so inside the strings. Never invent facts about the exact brand.`;
// Image (data URL) and/or description -> validated product read. Retries once on invalid output; null when still invalid.
export async function understandProduct({imageDataUrl,description,region},{llm}){
 const content=[{type:'text',text:`Product description from the user: ${description||'(none, use the photo)'}${region?`\nTarget region: ${region}`:''}`}];
 if(imageDataUrl)content.push({type:'image_url',image_url:{url:imageDataUrl}});
 const messages=[{role:'system',content:SYSTEM},{role:'user',content}];
 let hint='';
 for(let attempt=0;attempt<2;attempt++){
  const out=await llm(hint?[...messages,{role:'user',content:`Your last reply was rejected: ${hint}. Reply again with only the JSON object.`}]:messages);
  const parsed=parseJson(out,validateProduct);
  if(parsed.ok){const v=parsed.value;return {...v,search_keywords:v.search_keywords.map(s=>s.trim()),likely_competitors:v.likely_competitors.map(s=>s.trim())}}
  hint=parsed.error;
 }
 return null;
}
