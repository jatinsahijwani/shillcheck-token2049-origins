import {getJson,SourceError,createBudget} from './http.mjs';
import {RULES} from './config.mjs';
const BASE='https://api.x.com/2';
const HOUR=3600*1000;
export const X_TTL_MS=6*HOUR;
export const POST_COST=0.005,USER_COST=0.01;
// Worst-case cost of one handle: user lookup + the timeline read + up to RULES.replyPosts reply searches.
export const handleCost=()=>USER_COST+RULES.postsRead*POST_COST+RULES.replyPosts*RULES.repliesPerPost*POST_COST;
export const ttlFromEnv=(env=process.env)=>(Number(env.X_CACHE_TTL_HOURS)>0?Number(env.X_CACHE_TTL_HOURS):6)*HOUR;
export const normalizeHandle=input=>{
 const text=String(input??'').trim().replace(/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i,'').replace(/^@/,'').split(/[/?#]/)[0];
 return /^[A-Za-z0-9_]{1,15}$/.test(text)?text:null;
};
// X API v2 with an app-only bearer. Cached per handle for 6 hours. Never returns the bearer or raw error bodies.
// maxCostUsd bounds estimated spend per run ($0.01 per user, $0.005 per post read); cached reads cost nothing.
export function createXClient({bearer,fetchImpl=fetch,cache,budget=createBudget({max:60,label:'X'}),sleep,now=Date.now,maxCostUsd=Infinity,ttlMs=X_TTL_MS,liveAllowed=true,ledger,dailyCapUsd=Infinity,source='task'}){
 const stats={users:0,posts:0};
 // Reserve the worst-case cost of a call before making it, so concurrent calls cannot overshoot the cap.
 let reserved=0,inflight=0;
 const guard=(next,label)=>{
  if(!liveAllowed)throw new SourceError(`${label} skipped: not in cache and live X reads are disabled (X_LIVE_ALLOWED=false)`,{kind:'cap'});
  if(reserved+next>maxCostUsd+1e-9)throw new SourceError(`${label} skipped: estimated X spend cap of $${maxCostUsd} reached`,{kind:'cap'});
  // Daily cap across every report and chat on the host: past it, only cached data is served.
  if(ledger&&ledger.total()+inflight+next>dailyCapUsd+1e-9)throw new SourceError(`${label} skipped: daily X spend cap of $${dailyCapUsd} reached`,{kind:'cap'});
  reserved+=next;
 };
 // Runs a live call with its worst-case cost held in flight, then records what it actually cost.
 const spend=async(next,label,run)=>{guard(next,label);inflight+=next;let cost=0;try{const out=await run();cost=out.cost;return out.value}finally{inflight-=next;ledger?.add(cost,source)}};
 const call=(path,params,label)=>getJson({fetchImpl,budget,sleep,label,url:`${BASE}${path}?${new URLSearchParams(params)}`,headers:{authorization:`Bearer ${bearer}`}});
 const cached=async(key,load)=>{const hit=cache?.get(key,ttlMs);if(hit!==undefined)return hit;return cache?cache.set(key,await load()):load()};
 return {
  budget,stats,
  async getUser(handle){
   const h=handle.toLowerCase();
   return cached(`x:user:${h}`,async()=>{
    return spend(0.01,'X user lookup',async()=>{
     try{
      const body=await call(`/users/by/username/${encodeURIComponent(handle)}`,{'user.fields':'created_at,location,public_metrics,profile_image_url,description,verified'},'X user lookup');
      if(!body.data?.id)return {value:{found:false},cost:0};
      stats.users++;
      return {value:{found:true,user:body.data},cost:0.01};
     }catch(error){if(error.kind==='not_found')return {value:{found:false},cost:0};throw error}
    });
   });
  },
  async getTweets(userId){
   return cached(`x:tweets:${userId}`,async()=>{
    return spend(RULES.postsRead*POST_COST,'X timeline',async()=>{
     const body=await call(`/users/${encodeURIComponent(userId)}/tweets`,{max_results:String(RULES.postsRead),exclude:'retweets,replies','tweet.fields':'created_at,public_metrics,entities,note_tweet'},'X timeline');
     stats.posts+=(body.data??[]).length;
     return {value:(body.data??[]).map(t=>({id:t.id,created_at:t.created_at,text:t.note_tweet?.text??t.text??'',entities:t.entities??{},noteEntities:t.note_tweet?.entities??{},metrics:t.public_metrics??{}})),cost:(body.data??[]).length*POST_COST};
    });
   });
  },
  // Recent search only reaches back 7 days; callers must check the post's age first.
  async getReplies(tweetId,handle){
   return cached(`x:replies:${tweetId}`,async()=>{
    return spend(RULES.repliesPerPost*POST_COST,'X reply search',async()=>{
     const body=await call('/tweets/search/recent',{query:`conversation_id:${tweetId} is:reply -from:${handle}`,max_results:String(RULES.repliesPerPost),'tweet.fields':'author_id,created_at','expansions':'author_id','user.fields':'created_at,public_metrics,profile_image_url'},'X reply search');
     stats.posts+=(body.data??[]).length;
     const users=new Map((body.includes?.users??[]).map(u=>[u.id,u]));
     return {value:(body.data??[]).map(t=>({id:t.id,text:t.text??'',author:users.get(t.author_id)??null})),cost:(body.data??[]).length*POST_COST};
    });
   });
  },
 };
}
export {SourceError};
