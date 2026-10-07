import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {routeBrief,parseProductBrief} from '../src/product/input.mjs';
import {planProduct,planProductChat,NEED_DESCRIPTION} from '../src/product/plan.mjs';
import {buildQuery,rankCreators,discoverCreators} from '../src/product/discover.mjs';
import {splitBudget} from '../src/product/budget.mjs';
import {createLedger} from '../src/spend-ledger.mjs';
import {createCache} from '../src/cache.mjs';
import {answerWithoutModel} from '../src/fallback.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {fetchImageDataUrl} from '../src/product/image.mjs';

const PRODUCT={product_type:'Running shoes',category:'Footwear',price_tier_guess:'mid-range',visual_style:'Bold, colourful',target_audience:'Urban runners 18-35',search_keywords:['running shoes','#sneakerhead','new kicks','marathon training','#runnersofindia'],likely_competitors:['Nike','Adidas','Puma']};
const STRATEGY={campaign_goal:'Launch awareness',audience:'Urban runners',content_angles:[{title:'A',idea:'a'},{title:'B',idea:'b'},{title:'C',idea:'c'}],timeline:[1,2,3,4].map(week=>({week,focus:`f${week}`,actions:`a${week}`})),differentiate:['Cushioning']};
const smart=(overrides={})=>{
 const calls=[];
 const llm=async messages=>{calls.push(messages);const sys=messages[0].content;
  if(overrides.product&&sys.startsWith('You read a product'))return overrides.product(calls.filter(c=>c[0].content.startsWith('You read')).length);
  if(sys.startsWith('You read a product'))return JSON.stringify(PRODUCT);
  return overrides.strategy??JSON.stringify(STRATEGY)};
 llm.calls=calls;return llm;
};
const user=(id,username,followers,extra={})=>({id,username,name:username,public_metrics:{followers_count:followers},...extra});
const post=(id,author,likes)=>({id,author_id:author,public_metrics:{like_count:likes,retweet_count:1,reply_count:0,quote_count:0}});
const SEARCH={data:[post('1','u1',100),post('2','u2',50),post('3','u3',10),post('4','u4',500),post('5','u1',20)],includes:{users:[user('u1','runner_priya',120000),user('u2','tiny_fan',800),user('u3','nike_official_store',90000),user('u4','kickdaily',30000,{verified_type:'business'})]}};
const xFetch=(body,counter={n:0})=>async url=>{counter.n++;assert.match(String(url),/tweets\/search\/recent/);return {ok:true,status:200,json:async()=>body}};
const env=(extra={})=>({X_BEARER_TOKEN:'t',ZAI_BASE_URL:'http://x',ZAI_API_KEY:'k',ZAI_MODEL:'m',SHILLCHECK_MOCK:'true',...extra});
const common=(fetchImpl,extra={})=>({env:env(extra.env),fetchImpl,ledger:createLedger(),cache:createCache(),imageFetch:async()=>({ok:true,status:200,headers:{get:()=>'image/png'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}),resolve:async()=>[{address:'93.184.216.34'}],...extra});

test('happy path: product read, real creators, code-made budget, unvetted labels, honest limits',async()=>{
 const llm=smart(),c={n:0};
 const out=await planProduct('Make me an influencer plan for these shoes https://cdn.example.com/files/shoe.png budget $10K, India',{...common(xFetch(SEARCH,c)),llm});
 assert.equal(c.n,1);
 assert.match(out,/# ShillCheck product campaign plan ppl_[0-9a-f]{12}/);
 assert.match(out,/AI read of your photo/);
 assert.match(out,/\[@runner_priya\]\(https:\/\/x\.com\/runner_priya\)/);assert.match(out,/status\/1\)/);
 assert.doesNotMatch(out,/tiny_fan|nike_official_store|kickdaily/); // too small, brand by name, verified business
 assert.match(out,/Not yet vetted: run a full ShillCheck vet/);
 assert.match(out,/Competitors \(AI-suggested\)/);assert.match(out,/Instagram \| Coming soon/);
 assert.match(out,/\| Mid \|/); // only tiers with a shortlisted creator get budget
 assert.match(out,/Reserve/);assert.match(out,/## Could not verify/);assert.match(out,/## What ShillCheck will add next/);
 // an image_url part was really sent to the model
 assert.ok(llm.calls[0][1].content.some(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/png;base64,')));
 // budget numbers come from code: totals add up to the budget
 assert.match(out,/Totals: \$10,000 of \$10,000/);
});
test('no image: description only still works and says so',async()=>{
 const out=await planProduct('Influencer plan for my new stainless steel water bottle, budget $3K',{...common(xFetch(SEARCH)),llm:smart()});
 assert.match(out,/no photo was used/i);assert.match(out,/## Creator shortlist/);
});
test('too little to go on: asks for a description, no X call',async()=>{
 const c={n:0};
 assert.equal(await planProduct('shoes',{...common(xFetch(SEARCH,c)),llm:smart()}),NEED_DESCRIPTION);
 assert.equal(c.n,0);
});
test('bad JSON: retried once, then a description is requested; valid on retry is accepted',async()=>{
 let seen=0;
 const bad=smart({product:()=>{seen++;return 'not json {'}});
 assert.equal(await planProduct('Plan for my new running shoes launch',{...common(xFetch(SEARCH)),llm:bad}),NEED_DESCRIPTION);
 assert.equal(seen,2);
 const retry=smart({product:n=>n===1?JSON.stringify({...PRODUCT,search_keywords:['one']}):JSON.stringify(PRODUCT)});
 assert.match(await planProduct('Plan for my new running shoes launch',{...common(xFetch(SEARCH)),llm:retry}),/Running shoes/);
 const badStrategy=smart({strategy:'{"nope":1}'});
 const out=await planProduct('Plan for my new running shoes launch, budget $5K',{...common(xFetch(SEARCH)),llm:badStrategy});
 assert.match(out,/strategy section could not be generated/);assert.doesNotMatch(out,/## Strategy/);
});
test('empty search: says so and never invents a handle',async()=>{
 const out=await planProduct('Plan for my new running shoes launch, budget $5K',{...common(xFetch({meta:{result_count:0}})),llm:smart()});
 assert.match(out,/returned no creators/);assert.doesNotMatch(out,/https:\/\/x\.com\/[A-Za-z0-9_]+\)/);
});
test('cost: one search, capped at $1.50, recorded in the ledger, cached for 48h',async()=>{
 const ledger=createLedger(),cache=createCache(),c={n:0};let urlSeen;
 const f=async url=>{c.n++;urlSeen=String(url);return {ok:true,status:200,json:async()=>SEARCH}};
 const a=await discoverCreators({keywords:PRODUCT.search_keywords,region:'india',competitors:[]},{env:env(),fetchImpl:f,ledger,cache});
 assert.equal(a.status,'ok');assert.match(urlSeen,/max_results=100/);
 assert.equal(a.costUsd,Math.round((5*0.005+4*0.01)*1000)/1000);assert.equal(ledger.total('product'),a.costUsd);
 const b=await discoverCreators({keywords:PRODUCT.search_keywords,region:'india',competitors:[]},{env:env(),fetchImpl:f,ledger,cache});
 assert.equal(b.fromCache,true);assert.equal(c.n,1);
 // a lower cap lowers max_results; a cap below the smallest search refuses to call X; live reads off refuses too
 await discoverCreators({keywords:['a b','c'],region:null,competitors:[]},{env:env(),fetchImpl:f,ledger,cache,capUsd:0.3});
 assert.match(urlSeen,/max_results=20/);
 const refused=await discoverCreators({keywords:['zzz'],region:null,competitors:[]},{env:env(),fetchImpl:f,ledger,cache,capUsd:0.1});
 assert.equal(refused.status,'skipped');
 assert.equal((await discoverCreators({keywords:['yyy'],competitors:[]},{env:env({X_LIVE_ALLOWED:'false'}),fetchImpl:f,ledger,cache})).status,'skipped');
 assert.equal((await discoverCreators({keywords:['www'],competitors:[]},{env:env({X_DAILY_CAP_USD:'0.1'}),fetchImpl:f,ledger,cache})).status,'skipped');
 assert.equal(c.n,2);
});
test('query building: language by region, retweets excluded, phrases quoted',()=>{
 assert.equal(buildQuery(['running shoes','#kicks'],'india'),'("running shoes" OR #kicks) -is:retweet -is:reply (lang:en OR lang:hi)');
 assert.equal(buildQuery(['a'],undefined),'(a) -is:retweet -is:reply');
 const r=rankCreators(SEARCH);assert.deepEqual(r.creators.map(c=>c.handle),['runner_priya']);assert.deepEqual(r.dropped,{small:1,brand:2});
});
test('budget split is code: tiers present share the budget, 10% reserve, totals match',()=>{
 const rows=splitBudget(10000,[{followers:20000},{followers:100000}]);
 assert.deepEqual(rows.map(r=>r.tier.split(' ')[0]),['Micro','Mid','Reserve']);
 assert.equal(rows.reduce((n,r)=>n+r.usd,0),10000);assert.equal(rows.at(-1).usd,1000);
});
test('routing: handles or token words go to the token path; photo or product description to the planner',()=>{
 assert.equal(routeBrief('Vet @alice @bob budget $5K'),'token');
 assert.equal(routeBrief('Plan for shoes by @alice https://cdn.example.com/shoe.png'),'token');
 assert.equal(routeBrief('Influencer plan for my token launch'),'token');
 assert.equal(routeBrief('plan this $PEPE campaign'),'token');
 assert.equal(routeBrief('Make me an influencer plan for these shoes https://cdn.example.com/a.jpg budget $10K India'),'product');
 assert.equal(routeBrief('[shoe.png](https://blob.vercel-storage.com/files/abc)'),'product');
 assert.equal(routeBrief('Influencer marketing for my new running shoes, budget $10K'),'product');
 assert.equal(routeBrief('hello'),'none');
 assert.deepEqual(parseProductBrief('shoes https://x.co/a.png budget $10K India').budget_usd,10000);
 assert.equal(parseProductBrief('these shoes https://x.co/a.jpg, budget $5K').imageUrl,'https://x.co/a.jpg'); // trailing comma is not part of the link
});
test('image fetch refuses private hosts, non-https, non-images and oversize files',async()=>{
 const ok=async()=>[{address:'93.184.216.34'}];
 await assert.rejects(fetchImageDataUrl('http://example.com/a.png',{resolve:ok}),/https/);
 await assert.rejects(fetchImageDataUrl('https://internal.example/a.png',{resolve:async()=>[{address:'10.0.0.5'}]}),/not public/);
 await assert.rejects(fetchImageDataUrl('https://127.0.0.1/a.png'),/not public/);
 const f=(type,size)=>async()=>({ok:true,status:200,headers:{get:()=>type},arrayBuffer:async()=>new ArrayBuffer(size)});
 await assert.rejects(fetchImageDataUrl('https://e.com/a',{resolve:ok,fetchImpl:f('text/html',5)}),/not an image/);
 await assert.rejects(fetchImageDataUrl('https://e.com/a',{resolve:ok,fetchImpl:f('image/png',6*1024*1024)}),/larger than 5 MB/);
});
test('a bad photo link falls back to the description with a note',async()=>{
 const out=await planProduct('Plan for my running shoes https://127.0.0.1/a.png budget $5K',{...common(xFetch(SEARCH)),llm:smart(),resolve:undefined});
 assert.match(out,/photo could not be used/);assert.match(out,/no photo was used/i);
});
test('chat: short plan with an offer of the full Task, no X call',async()=>{
 const out=await planProductChat('Plan for my new running shoes, budget $10K India',{env:env(),llm:smart()});
 assert.match(out,/Quick read \(AI\)/);assert.match(out,/create a Task/);
});
test('regression: the token path output is unchanged (golden report, id normalised)',async()=>{
 const NOW=Date.parse('2026-10-06T07:00:00Z');
 const e={SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000',SHILLCHECK_DATA_DIR:join(mkdtempSync(join(tmpdir(),'gold-')),'reports'),PRODUCT_MODE_ENABLED:'true'};
 const out=(await answerWithoutModel('Vet @demo_alpha @demo_pumper @demo_ghost for a DeFi launch in Asia. Budget $20K.',{env:e,fetchImpl:createMockFetch({now:NOW}),now:NOW})).replace(/rpt_[0-9a-f]{12}/g,'rpt_X').replace(/Report created[^\n]*/g,'');
 const golden=new URL('./golden/token-report.txt',import.meta.url);
 if(!existsSync(golden))writeFileSync(golden,out);
 assert.equal(out,readFileSync(golden,'utf8'));
});
test('acknowledgement for a product brief does not mention a usage guide; token acks are unchanged',async()=>{
 const {ackText}=await import('../src/notices.mjs');
 assert.match(ackText({input:'plan for shoes',paid:true,product:true}),/product brief/);
 assert.doesNotMatch(ackText({input:'plan for shoes',paid:true,product:true}),/usage guide/);
 assert.match(ackText({input:'Vet @a',paid:false}),/vetting 1 handle/);
});
