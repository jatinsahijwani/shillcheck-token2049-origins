// Shared fetch helpers: call caps, one retry, and labeled failures. Errors never include URLs with keys or response bodies.
export class SourceError extends Error{
 constructor(message,{status,kind}={}){super(message);this.name='SourceError';this.status=status;this.kind=kind??'error'}
}
export function createBudget({max,label}){
 let used=0;
 return {take(){if(used>=max)throw new SourceError(`${label} call cap reached (${max})`,{kind:'cap'});used++},get used(){return used},max};
}
export async function getJson({fetchImpl,url,headers,budget,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000,retryDelayMs=800,label}){
 let lastError;
 for(let attempt=0;attempt<2;attempt++){
  budget?.take();
  try{
   const response=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   if(response.status===404)throw new SourceError(`${label} not found`,{status:404,kind:'not_found'});
   if(!response.ok)throw new SourceError(`${label} returned HTTP ${response.status}`,{status:response.status});
   return await response.json();
  }catch(error){
   if(error.kind==='not_found'||error.kind==='cap')throw error;
   lastError=error instanceof SourceError?error:new SourceError(`${label} request failed (${error.name==='TimeoutError'?'timeout':'network error'})`);
   if(attempt===0)await sleep(retryDelayMs);
  }
 }
 throw lastError;
}
