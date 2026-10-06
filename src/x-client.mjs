import {getJson,SourceError,createBudget} from './http.mjs';
const BASE='https://api.x.com/2';
const HOUR=3600*1000;
export const X_TTL_MS=6*HOUR;
export const normalizeHandle=input=>{
 const text=String(input??'').trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i,'').replace(/^@/,'').split(/[/?#]/)[0];
 return /^[A-Za-z0-9_]{1,15}$/.test(text)?text:null;
};
// X API v2 with an app-only bearer. Cached per handle for 6 hours. Never returns the bearer or raw error bodies.
export function createXClient({bearer,fetchImpl=fetch,cache,budget=createBudget({max:60,label:'X'}),sleep,now=Date.now}){
 const call=(path,params,label)=>getJson({fetchImpl,budget,sleep,label,url:`${BASE}${path}?${new URLSearchParams(params)}`,headers:{authorization:`Bearer ${bearer}`}});
 const cached=async(key,load)=>{const hit=cache?.get(key,X_TTL_MS);if(hit!==undefined)return hit;return cache?cache.set(key,await load()):load()};
 return {
  budget,
  async getUser(handle){
   const h=handle.toLowerCase();
   return cached(`x:user:${h}`,async()=>{
    try{
     const body=await call(`/users/by/username/${encodeURIComponent(handle)}`,{'user.fields':'created_at,location,public_metrics,profile_image_url,description,verified'},'X user lookup');
     if(!body.data?.id)return {found:false};
     return {found:true,user:body.data};
    }catch(error){if(error.kind==='not_found')return {found:false};throw error}
   });
  },
  async getTweets(userId){
   return cached(`x:tweets:${userId}`,async()=>{
    const body=await call(`/users/${encodeURIComponent(userId)}/tweets`,{max_results:'100',exclude:'retweets,replies','tweet.fields':'created_at,public_metrics,entities,note_tweet'},'X timeline');
    return (body.data??[]).map(t=>({id:t.id,created_at:t.created_at,text:t.note_tweet?.text??t.text??'',entities:t.entities??{},noteEntities:t.note_tweet?.entities??{},metrics:t.public_metrics??{}}));
   });
  },
  // Recent search only reaches back 7 days; callers must check the post's age first.
  async getReplies(tweetId,handle){
   return cached(`x:replies:${tweetId}`,async()=>{
    const body=await call('/tweets/search/recent',{query:`conversation_id:${tweetId} is:reply -from:${handle}`,max_results:'25','tweet.fields':'author_id,created_at','expansions':'author_id','user.fields':'created_at,public_metrics,profile_image_url'},'X reply search');
    const users=new Map((body.includes?.users??[]).map(u=>[u.id,u]));
    return (body.data??[]).map(t=>({id:t.id,text:t.text??'',author:users.get(t.author_id)??null}));
   });
  },
 };
}
export {SourceError};
