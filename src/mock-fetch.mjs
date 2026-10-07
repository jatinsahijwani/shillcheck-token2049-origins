// Fixture server for SHILLCHECK_MOCK=true. It answers the same X, CoinGecko and DefiLlama URLs the real clients call,
// so the whole pipeline (parsing, caps, retries, pricing) runs unchanged on fake data.
const DAY=86400000;
const rng=seed=>{let a=[...seed].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}};
const EVM_CA='0x1234567890abcdef1234567890abcdef12345678';
const COINS={
 alphacoin:{symbol:'ALPHA',name:'Alpha Mock',rank:812,daysAgo:150,m7:0.12,m30:0.25,p0:0.42},
 betacoin:{symbol:'BETA',name:'Beta Mock',rank:1204,daysAgo:90,m7:0.05,m30:-0.1,p0:1.8},
 freshcoin:{symbol:'FRESH',name:'Fresh Mock',rank:2200,daysAgo:10,m7:0.03,m30:0,p0:0.09},
 rugone:{symbol:'RUGONE',name:'Rug One Mock',rank:3100,daysAgo:120,m7:-0.45,m30:-0.78,p0:0.031},
 dumptwo:{symbol:'DUMPTWO',name:'Dump Two Mock',rank:2800,daysAgo:80,m7:-0.6,m30:-0.85,p0:0.0074},
 pumpthree:{symbol:'PUMP3',name:'Pump Three Mock',rank:2500,daysAgo:55,m7:-0.3,m30:-0.72,p0:0.15},
 cacoin:{symbol:'CACOIN',name:'CA Mock',rank:4000,daysAgo:40,m7:-0.2,m30:-0.4,p0:0.5,address:EVM_CA,platform:'ethereum'},
 fluffy:{symbol:'FLUFFY',name:'Fluffy Mock',rank:1500,daysAgo:60,m7:0.0,m30:0.02,p0:0.2},
};
const SEARCH={ALPHA:[{id:'alphacoin',symbol:'ALPHA',name:'Alpha Mock',market_cap_rank:812},{id:'alphabet-x',symbol:'ABX',name:'Alphabet X',market_cap_rank:10}],BETA:['betacoin'],FRESH:['freshcoin'],RUGONE:['rugone'],DUMPTWO:['dumptwo'],PUMP3:['pumpthree'],FLUFFY:['fluffy'],
 TWIN:[{id:'twin-a',symbol:'TWIN',name:'Twin A',market_cap_rank:null},{id:'twin-b',symbol:'TWIN',name:'Twin B',market_cap_rank:null}]};
const KOLS={
 demo_alpha:{id:'9001',followers:800000,location:'Singapore',created:'2018-03-02T00:00:00.000Z',avg:{v:300000,l:4000,r:500,re:250,q:80},gap:7,botShare:0.05,recent:[['freshcoin','Paid partnership update on $FRESH #ad']],promos:[['alphacoin','#ad Partnered with $ALPHA. Details in the thread.'],['betacoin','Sponsored: $BETA is building payments. #ad'],['freshcoin','Paid partnership with $FRESH, see what they ship.']]},
 demo_pumper:{id:'9002',followers:900000,location:'Dubai',created:'2021-06-10T00:00:00.000Z',avg:{v:250000,l:2500,r:400,re:150,q:50},gap:5.5,botShare:0.6,recent:[['TWIN','$TWIN again, early gem nfa']],promos:[['rugone','$RUGONE is an early gem, 100x easy 🚀 nfa'],['dumptwo','Ape $DUMPTWO before it moons, early. nfa'],['pumpthree','$PUMP3 100x gem, early ape'],['cacoin',`CA ${EVM_CA} gem, this will moon`],['TWIN',"$TWIN looks early, nfa"],['NOPE','$NOPE gem 100x']]},
 demo_ghost:{id:'9003',followers:2000000,location:'London',created:'2020-01-15T00:00:00.000Z',avg:{v:12000,l:20,r:3,re:2,q:0.5},gap:5,botShare:0.3,recent:[['fluffy','$FLUFFY roadmap update, partnered #ad']],promos:[['fluffy','$FLUFFY update: ads are live, partnered #ad']]},
};
const iso=ms=>new Date(ms).toISOString();
function coinPrice(c,ms,now){
 const t0=now-c.daysAgo*DAY,d=(ms-t0)/DAY;
 if(d<=0)return c.p0*0.97;
 if(d<=7)return c.p0*(1+c.m7*d/7);
 if(d<=30)return c.p0*((1+c.m7)+((1+c.m30)-(1+c.m7))*(d-7)/23);
 return c.p0*(1+c.m30);
}
function tweetsFor(handle,k,now){
 const r=rng(handle),jitter=()=>0.7+r()*0.6;
 const posts=[];
 for(let i=0;i<100;i++){
  const age=0.7+i*k.gap;
  posts.push({id:String(5000000+i*10+k.id.slice(-1)*1),created_at:iso(now-age*DAY),text:['gm builders, shipping day','Thoughts on L2 fees this week','New thread on onchain data','Weekend reading list','Market structure notes'][i%5],public_metrics:{impression_count:Math.round(k.avg.v*jitter()),like_count:Math.round(k.avg.l*jitter()),retweet_count:Math.round(k.avg.r*jitter()),reply_count:Math.round(k.avg.re*jitter()),quote_count:Math.round(k.avg.q*jitter())}});
 }
 k.promos.forEach(([coin,text],i)=>{
  const key=COINS[coin]?coin:coin;
  const daysAgo=COINS[coin]?.daysAgo??({TWIN:20,NOPE:100})[coin]??30;
  const id=String(7000000+i*7+Number(k.id.slice(-1)));
  const post={id,created_at:iso(now-daysAgo*DAY),text,public_metrics:{impression_count:Math.round(k.avg.v*jitter()),like_count:Math.round(k.avg.l*jitter()),retweet_count:Math.round(k.avg.r*jitter()),reply_count:Math.round(k.avg.re*jitter()),quote_count:Math.round(k.avg.q*jitter())}};
  const tag=/\$([A-Za-z0-9]+)/.exec(text);
  if(tag)post.entities={cashtags:[{start:0,end:1,tag:tag[1]}]};
  posts.push(post);
 });
 // One recent promo post per KOL: reply sampling is limited to recent promo posts.
 (k.recent??[]).forEach(([coin,text],i)=>{
  const post={id:String(7500000+i*7+Number(k.id.slice(-1))),created_at:iso(now-2*DAY),text,public_metrics:{impression_count:Math.round(k.avg.v*jitter()),like_count:Math.round(k.avg.l*jitter()),retweet_count:Math.round(k.avg.r*jitter()),reply_count:Math.round(k.avg.re*jitter()),quote_count:Math.round(k.avg.q*jitter())}};
  const tag=/\$([A-Za-z0-9]+)/.exec(text);if(tag)post.entities={cashtags:[{start:0,end:1,tag:tag[1]}]};
  posts.push(post);
 });
 posts.sort((a,b)=>a.created_at<b.created_at?1:-1);
 return posts.slice(0,100);
}
function repliesFor(tweetId,handle,k,now){
 const r=rng(`${handle}:${tweetId}`),out=[],users=[];
 const real=['Interesting take, curious how this holds up on mainnet.','Agree on the fee point but bridging is still painful.','Can you share the dashboard link for this?','We measured something similar last quarter, around 12%.','Good thread. What data source did you use?'];
 for(let i=0;i<25;i++){
  const isBot=Math.floor((i+1)*k.botShare)>Math.floor(i*k.botShare),id=`${tweetId}${i}`;
  users.push(isBot?{id:`u${id}`,created_at:iso(now-20*DAY),public_metrics:{followers_count:3},profile_image_url:'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}
   :{id:`u${id}`,created_at:iso(now-(400+Math.floor(r()*1000))*DAY),public_metrics:{followers_count:50+Math.floor(r()*5000)},profile_image_url:`https://pbs.twimg.com/profile_images/${id}/a.jpg`});
  out.push({id:`rep${id}`,author_id:`u${id}`,text:isBot?'🔥🚀 LFG':`${real[i%real.length]} (${Math.floor(r()*1000)})`});
 }
 return {data:out,includes:{users}};
}
export function createMockFetch({now=Date.now()}={}){
 const json=(body,status=200)=>({status,ok:status>=200&&status<300,json:async()=>body});
 return async function mockFetch(input){
  const url=new URL(String(input));
  const p=url.pathname;
  if(url.hostname==='api.x.com'){
   let m;
   if((m=p.match(/^\/2\/users\/by\/username\/(.+)$/))){
    const handle=decodeURIComponent(m[1]).toLowerCase(),k=KOLS[handle];
    if(!k)return json({errors:[{title:'Not Found Error',detail:'Could not find user'}]});
    return json({data:{id:k.id,name:handle.replace('_',' '),username:handle,created_at:k.created,location:k.location,public_metrics:{followers_count:k.followers,following_count:300,tweet_count:9000},profile_image_url:`https://pbs.twimg.com/profile_images/${k.id}/a.jpg`}});
   }
   if((m=p.match(/^\/2\/users\/(\d+)\/tweets$/))){
    const entry=Object.entries(KOLS).find(([,k])=>k.id===m[1]);
    return entry?json({data:tweetsFor(entry[0],entry[1],now).slice(0,Number(url.searchParams.get('max_results')||100))}):json({data:[]});
   }
   if(p==='/2/tweets/search/recent'){
    const q=url.searchParams.get('query'),id=/conversation_id:(\d+)/.exec(q)?.[1],handle=/-from:(\w+)/.exec(q)?.[1]?.toLowerCase();
    const k=KOLS[handle];
    if(!(k&&id))return json({});const full=repliesFor(id,handle,k,now),max=Number(url.searchParams.get('max_results')||25);return json({data:full.data.slice(0,max),includes:full.includes});
   }
   return json({},404);
  }
  if(url.hostname==='api.coingecko.com'){
   let m;
   if(p==='/api/v3/search'){
    const sym=url.searchParams.get('query').toUpperCase();
    const hits=(SEARCH[sym]??[]).map(x=>typeof x==='string'?{id:x,symbol:COINS[x].symbol,name:COINS[x].name,market_cap_rank:COINS[x].rank}:x);
    return json({coins:hits});
   }
   if((m=p.match(/^\/api\/v3\/coins\/([^/]+)\/contract\/(.+)$/))){
    const c=Object.entries(COINS).find(([,v])=>v.address&&v.address.toLowerCase()===m[2].toLowerCase()&&v.platform===m[1]);
    return c?json({id:c[0],symbol:c[1].symbol.toLowerCase(),name:c[1].name}):json({error:'coin not found'},404);
   }
   if((m=p.match(/^\/api\/v3\/coins\/([^/]+)\/market_chart\/range$/))){
    const c=COINS[m[1]];if(!c)return json({error:'coin not found'},404);
    const from=Number(url.searchParams.get('from'))*1000,to=Number(url.searchParams.get('to'))*1000,prices=[];
    for(let t=Math.floor(from/DAY)*DAY+DAY/2;t<=to;t+=DAY)prices.push([t,coinPrice(c,t,now)]);
    return json({prices});
   }
  }
  if(url.hostname==='coins.llama.fi')return json({coins:{}});
  return json({},404);
 };
}
export const MOCK_HANDLES=Object.keys(KOLS);
