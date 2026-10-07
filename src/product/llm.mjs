// One JSON answer from the same OpenAI-compatible Gemini config as the agent (ZAI_*), trying the fallback models in order.
export function modelNames(env=process.env){
 return [env.ZAI_MODEL,...(env.ZAI_FALLBACK_MODELS??'').split(',').map(s=>s.trim())].filter(Boolean);
}
export function createJsonLlm({env=process.env,fetchImpl=fetch,timeoutMs=60000}={}){
 return async function llm(messages){
  let last;
  for(const model of modelNames(env)){
   try{
    const r=await fetchImpl(`${env.ZAI_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${env.ZAI_API_KEY}`},body:JSON.stringify({model,messages,response_format:{type:'json_object'},temperature:0.3}),signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok)throw new Error(`model returned HTTP ${r.status}`);
    const text=(await r.json()).choices?.[0]?.message?.content;
    if(!text)throw new Error('model returned no text');
    return text;
   }catch(error){last=error}
  }
  throw new Error(`language model unavailable (${String(last?.message).slice(0,80)})`);
 };
}
// Parse model text as JSON (tolerating a code fence) and validate it; returns {ok,value|error}.
export function parseJson(text,validate){
 try{
  const raw=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const value=JSON.parse(raw);
  const error=validate(value);
  return error?{ok:false,error}:{ok:true,value};
 }catch{return {ok:false,error:'not valid JSON'}}
}
