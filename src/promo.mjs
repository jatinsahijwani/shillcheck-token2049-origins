import {MAJORS,RULES} from './config.mjs';
const URL_RE=/https?:\/\/\S+/g;
const CASHTAG_RE=/(?<![\w$])\$([A-Za-z][A-Za-z0-9]{1,9})\b/g;
const EVM_RE=/\b0x[a-fA-F0-9]{40}\b/g;
const SOL_RE=/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const DISCLOSURE_RE=/(?<![\w])(#ad|ad|sponsored|paid|partner(?:ed|ship|s)?)(?![\w])/i;
export const HYPE_RE=/(?<![\w])(gem|100x|moon(?:ing)?|ape|apes|aping|early|nfa)(?![\w])/i;
const looksLikeSolana=s=>/[0-9]/.test(s)&&/[a-z]/.test(s)&&/[A-Z]/.test(s);
export const postUrl=(handle,id)=>`https://x.com/${handle}/status/${id}`;
// Pure and deterministic: the same posts always yield the same promotions, so the report hash is stable.
export function extractRefs(post){
 const text=String(post.text??'').replace(URL_RE,' ');
 const refs=new Map();
 const add=(kind,value)=>{const key=kind==='cashtag'?`t:${value.toUpperCase()}`:`a:${value.toLowerCase()}`;if(!refs.has(key))refs.set(key,{kind,value:kind==='cashtag'?value.toUpperCase():value})};
 for(const entity of [...(post.entities?.cashtags??[]),...(post.noteEntities?.cashtags??[])])if(entity.tag)add('cashtag',entity.tag);
 for(const m of text.matchAll(CASHTAG_RE))add('cashtag',m[1]);
 for(const m of text.matchAll(EVM_RE))add('evm',m[0]);
 for(const m of text.matchAll(SOL_RE))if(looksLikeSolana(m[0]))add('solana',m[0]);
 return [...refs.values()].filter(r=>r.kind!=='cashtag'||!MAJORS.has(r.value));
}
// One row per coin: the earliest fetched post that references it. Contract address wins over ticker for resolution.
export function detectPromos(posts,handle){
 const byCoin=new Map();
 for(const post of posts){
  const refs=extractRefs(post);
  if(!refs.length)continue;
  const text=String(post.text??'').replace(URL_RE,' ');
  const disclosed=DISCLOSURE_RE.test(text),hype=HYPE_RE.test(text);
  for(const ref of refs){
   const key=ref.kind==='cashtag'?`t:${ref.value}`:`a:${ref.value.toLowerCase()}`;
   const row=byCoin.get(key)??{key,ref,posts:[]};
   row.posts.push({id:post.id,url:postUrl(handle,post.id),createdAt:post.created_at,disclosed,hype});
   byCoin.set(key,row);
  }
 }
 const rows=[...byCoin.values()].map(row=>{
  row.posts.sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:1);
  const first=row.posts[0];
  return {key:row.key,ref:row.ref,via:row.ref.kind==='cashtag'?'ticker':'contract',postCount:row.posts.length,firstPost:first,lastCreatedAt:row.posts.at(-1).createdAt,
   disclosed:row.posts.some(p=>p.disclosed),firstPostDisclosed:first.disclosed,hype:row.posts.some(p=>p.hype)};
 });
 rows.sort((a,b)=>a.lastCreatedAt<b.lastCreatedAt?1:a.lastCreatedAt>b.lastCreatedAt?-1:a.key<b.key?-1:1);
 return {promos:rows.slice(0,RULES.maxPromoCoins),omitted:Math.max(0,rows.length-RULES.maxPromoCoins)};
}
