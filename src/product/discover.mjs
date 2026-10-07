import {getJson,createBudget} from '../http.mjs';
import {POST_COST,USER_COST} from '../x-client.mjs';
export const PRODUCT = {minFollowers:5000,top:8,capUsd:1.5,ttlMs:48*3600*1000};
const LANG={india:['en','hi'],usa:['en'],uk:['en'],uae:['en','ar'],mena:['ar','en'],japan:['ja'],brazil:['pt'],latam:['es','pt'],europe:null,asia:null,africa:null,oceania:['en'],'north america':['en']};
const BRAND_WORDS=/official|store|shop|outlet|deals?|sale|coupons?|promo|news|bot|sneakerbot|restock|alerts?|wholesale|merch|retail|\bltd\b|\binc\b/i;
// Recent search query from the model's keywords: quoted phrases, hashtags as they are, no retweets, optional language filter.
export function buildQuery(keywords,region){
 const terms=keywords.map(k=>k.replace(/["()]/g,'').trim()).filter(Boolean).map(k=>/\s/.test(k)?`"${k}"`:k);
 let q=`(${terms.join(' OR ')}) -is:retweet -is:reply`;
 const langs=LANG[String(region??'').toLowerCase()];
 if(langs)q+=langs.length>1?` (${langs.map(l=>`lang:${l}`).join(' OR ')})`:` lang:${langs[0]}`;
 return q.slice(0,500);
}
const engagement=m=>(m.like_count??0)+2*(m.retweet_count??0)+(m.reply_count??0)+(m.quote_count??0);
export function isBrandAccount(user,competitors=[]){
 if(user.verified_type==='business'||user.verified_type==='government')return true;
 const hay=`${user.username} ${user.name}`;
 if(BRAND_WORDS.test(hay)||BRAND_WORDS.test(user.description??''))return true;
 const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 return competitors.some(c=>norm(c).length>=3&&norm(hay).includes(norm(c)));
}
// Rank: log10(followers) + log10(1 + total engagement on matching posts). Handles come only from the API response.
export function rankCreators(body,{competitors=[],minFollowers=PRODUCT.minFollowers,top=PRODUCT.top}={}){
 const users=new Map((body.includes?.users??[]).map(u=>[u.id,u]));
 const byAuthor=new Map();
 for(const t of body.data??[]){
  const u=users.get(t.author_id);if(!u)continue;
  const e=engagement(t.public_metrics??{});
  const rec=byAuthor.get(u.id)??{user:u,posts:0,engagement:0,best:null};
  rec.posts++;rec.engagement+=e;
  if(!rec.best||e>rec.best.e)rec.best={id:t.id,e};
  byAuthor.set(u.id,rec);
 }
 let dropped={small:0,brand:0};
 const out=[];
 for(const {user,posts,engagement:eng,best} of byAuthor.values()){
  const followers=user.public_metrics?.followers_count??0;
  if(followers<minFollowers){dropped.small++;continue}
  if(isBrandAccount(user,competitors)){dropped.brand++;continue}
  out.push({handle:user.username,name:user.name,url:`https://x.com/${user.username}`,followers,matchingPosts:posts,engagement:eng,postUrl:`https://x.com/${user.username}/status/${best.id}`,score:Math.log10(Math.max(followers,1))+Math.log10(1+eng)});
 }
 out.sort((a,b)=>b.score-a.score||(a.handle<b.handle?-1:1));
 return {creators:out.slice(0,top),dropped,authors:byAuthor.size};
}
// ONE recent-search call, cached 48h, capped at PRODUCT.capUsd and counted in the shared daily ledger.
export async function discoverCreators({keywords,region,competitors},{env=process.env,fetchImpl=fetch,cache,ledger,sleep,capUsd=Number(env.PRODUCT_X_CAP_USD)>0?Number(env.PRODUCT_X_CAP_USD):PRODUCT.capUsd,dailyCapUsd=Number(env.X_DAILY_CAP_USD)>0?Number(env.X_DAILY_CAP_USD):25}={}){
 const query=buildQuery(keywords,region);
 const key=`x:product-search:${query}`;
 const hit=cache?.get(key,PRODUCT.ttlMs);
 let body=hit,fromCache=Boolean(hit),cost=0;
 if(!body){
  if(env.X_LIVE_ALLOWED==='false')return {status:'skipped',reason:'not in cache and live X reads are disabled',query};
  const maxResults=Math.min(100,Math.floor(capUsd/(POST_COST+USER_COST)));
  if(maxResults<10)return {status:'skipped',reason:`estimated X spend cap of $${capUsd} is below the smallest search`,query};
  const worst=maxResults*(POST_COST+USER_COST);
  if(ledger&&ledger.total()+worst>dailyCapUsd+1e-9)return {status:'skipped',reason:`daily X spend cap of $${dailyCapUsd} reached`,query};
  try{
   body=await getJson({fetchImpl,sleep,budget:createBudget({max:1,label:'X'}),label:'X recent search',url:`https://api.x.com/2/tweets/search/recent?${new URLSearchParams({query,max_results:String(maxResults),'tweet.fields':'author_id,created_at,public_metrics',expansions:'author_id','user.fields':'public_metrics,verified_type,description'})}`,headers:{authorization:`Bearer ${env.X_BEARER_TOKEN}`}});
  }catch(error){return {status:'error',reason:String(error.message).slice(0,100),query}}
  cost=(body.data??[]).length*POST_COST+(body.includes?.users??[]).length*USER_COST;
  ledger?.add(cost,'product');
  cache?.set(key,body);
 }
 const ranked=rankCreators(body,{competitors});
 return {status:ranked.creators.length?'ok':'empty',query,fromCache,costUsd:Math.round(cost*1000)/1000,postsRead:(body.data??[]).length,...ranked};
}
